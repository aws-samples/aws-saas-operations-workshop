#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

stop_cloudtrail() {
    echo "Stopping CloudTrail ${1}"
    if [[ -z "${1}" ]]; then
        echo "Cloudtrail missing..."
        return
    fi
    aws cloudtrail stop-logging --name "${1}"
    echo "CloudTrail ${1} stopped."
}

delete_stack() {
    echo "deleting stack $1..."
    if [[ -z "${1}" ]]; then
        echo "Stack name missing..."
        return
    fi
    stack=$(aws cloudformation describe-stacks --stack-name "$1")
    if [[ -z "${stack}" ]]; then
        echo "Stack ${1} does not exist..."
        return
    fi
    aws cloudformation delete-stack --stack-name "$1"
    aws cloudformation wait stack-delete-complete --stack-name "$1"
    echo "Stack $1 deleted."
}

delete_tenant_stacks() {
    echo "Deleting tenant stacks..."
    next_token=""
    STACK_STATUS_FILTER="CREATE_COMPLETE ROLLBACK_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE"
    while true; do
        if [[ "${next_token}" == "" ]]; then
            # shellcheck disable=SC2086
            # ignore shellcheck error for adding a quote as that causes the api call to fail
            response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER | sed 's/\\n//')
        else
            # shellcheck disable=SC2086
            # ignore shellcheck error for adding a quote as that causes the api call to fail
            response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER --starting-token "$next_token"| sed 's/\\n//')
        fi

        tenant_stacks=$(echo "$response" | jq -r '.StackSummaries[].StackName | select(. | test("^stack-*"))')
        for i in $tenant_stacks; do
            delete_stack "$i" &
        done

        next_token=$(echo "$response" | jq '.NextToken')
        if [[ "${next_token}" == "null" ]]; then
            echo "No more tenants left."
            # no more results left. Exit loop...
            break
        fi
    done
    wait_for_background_jobs
    echo "Tenant stacks deleted."
}

empty_bucket() {
    local -r bucket="${1:?}"
    echo "Emptying s3://${bucket}..."
    for object_type in Versions DeleteMarkers; do
        local opt=() next_token=""
        while [[ "$next_token" != null ]]; do
            page="$(aws s3api list-object-versions --bucket "$bucket" --output json --max-items 400 "${opt[@]}" \
                        --query="[{Objects: ${object_type}[].{Key:Key, VersionId:VersionId}}, NextToken]")"
            objects="$(jq -r '.[0]' <<<"$page")"
            next_token="$(jq -r '.[1]' <<<"$page")"
            case "$(jq -r .Objects <<<"$objects")" in
                '[]'|null) break;;
                *) opt=(--starting-token "$next_token")
                   aws s3api delete-objects --bucket "$bucket" --delete "$objects" --no-cli-pager;;
            esac
        done
    done
}

delete_bucket() {
    bucket=$1
    echo "Deleting bucket ${bucket}"
    empty_bucket ${bucket}
    aws s3 rb "s3://${bucket}"
    echo "Bucket deleted."
}

delete_buckets() {
    echo "Deleting buckets..."
    for i in $(aws s3 ls | awk '{print $3}' | grep -E "^saas-operations-*|^sam-bootstrap-*"); do
        delete_bucket ${i}
    done
    # Try a second run, in case there was still data put into one of the buckets
    buckets=$(aws s3 ls | awk '{print $3}' | grep -E "^saas-operations-*|^sam-bootstrap-*")
    if [[ -n "${buckets}" ]]; then
        echo "Sleeping for 60s to wait for bucket"
        sleep 60
        for i in $(aws s3 ls | awk '{print $3}' | grep -E "^saas-operations-*|^sam-bootstrap-*"); do
            delete_bucket ${i}
        done
    fi
    echo "Buckets deleted."
}

delete_codecommit_repo() {
    REPO_NAME="$1"
    echo "Deleting codecommit repo \"$REPO_NAME\"..."
    repo=$(aws codecommit get-repository --repository-name "$REPO_NAME")
    if [[ -n "${repo}" ]]; then
        aws codecommit delete-repository --repository-name "$REPO_NAME"
    else
        echo "Repo \"$REPO_NAME\" does not exist..."
    fi
    echo "Repo \"$REPO_NAME\" deleted."
}

delete_log_groups() {
    echo "Cleaning up log groups..."
    next_token=""
    while true; do
        if [[ "${next_token}" == "" ]]; then
            response=$(aws logs describe-log-groups)
        else
            response=$(aws logs describe-log-groups --starting-token "$next_token")
        fi

        log_groups=$(echo "$response" | jq -r '.logGroups[].logGroupName | select(. | test("^/aws/lambda/stack-*|^/aws/lambda/saas-operations-*|^/aws/api-gateway/access-logs-saas-operations-*|^/aws/lambda/saasOpsWorkshop-*|^saas-operations-pipeline-*|/aws/codebuild/Build45A36621-*|API-Gateway-Execution-Logs_*"))')
        for i in $log_groups; do
            echo "Deleting log group $i..."
            aws logs delete-log-group --log-group-name "$i"
        done

        next_token=$(echo "$response" | jq '.NextToken')
        if [[ "${next_token}" == "null" ]]; then
            # no more results left. Exit loop...
            break
        fi
    done
}

delete_user_pools() {
    echo "cleaning up user pools..."
    next_token=""
    while true; do
        if [[ "${next_token}" == "" ]]; then
            response=$( aws cognito-idp list-user-pools --max-results 1)
        else
            # using next-token instead of starting-token. See: https://github.com/aws/aws-cli/issues/7661
            response=$( aws cognito-idp list-user-pools --max-results 1 --next-token "$next_token")
        fi

        pool_ids=$(echo "$response" | jq -r '.UserPools[] | select(.Name | test("^.*-SaaSOperationsUserPool$")) |.Id')
        for i in $pool_ids; do
            echo "deleting user pool with name $i..."
            echo "getting pool domain..."
            pool_domain=$(aws cognito-idp describe-user-pool --user-pool-id "$i" | jq -r '.UserPool.Domain')

            echo "deleting pool domain $pool_domain..."
            aws cognito-idp delete-user-pool-domain \
                --user-pool-id "$i" \
                --domain "$pool_domain"

            echo "deleting pool $i..."
            aws cognito-idp delete-user-pool --user-pool-id "$i"
        done

        next_token=$(echo "$response" | jq -r '.NextToken')
        if [[ "${next_token}" == "null" ]]; then
            # no more results left. Exit loop...
            break
        fi
    done
}

delete_api_keys() {
    echo "Deleting api keys..."
    for i in $(aws apigateway get-api-keys --query "items[?contains(name,'saasOpsWorkshop')].id" --output text); do
        aws apigateway delete-api-key --api-key ${i}
    done
    echo "Api keys deleted."
}

delete_c9() {
    aws ec2 create-tags --resources $C9_ID --tags "Key=Workshop,Value=${WORKSHOP_NAME}Old"
    delete_stack "$WORKSHOP_NAME-C9"
}