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
    wait_for_stack_deleted "$1"
}

# Poll until the stack is gone; fail on DELETE_FAILED
wait_for_stack_deleted() {
    local stack_name="$1" status
    while true; do
        status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>&1)
        if [[ "$status" == *"does not exist"* || "$status" == "DELETE_COMPLETE" ]]; then
            echo "Stack $stack_name deleted."
            return 0
        fi
        if [[ "$status" == "DELETE_FAILED" ]]; then
            echo "Error! Stack $stack_name is DELETE_FAILED"
            exit 1
        fi
        sleep $DELAY
    done
}

# List the CloudFront distribution ids a stack owns, including through nested stacks
stack_cloudfront_distributions() {
    local stack_name="$1" resources
    resources=$(aws cloudformation list-stack-resources --stack-name "$stack_name" --output json 2>/dev/null) || return 0
    jq -r '.StackResourceSummaries[] | select(.ResourceType == "AWS::CloudFront::Distribution" and .PhysicalResourceId != null) | .PhysicalResourceId' <<<"$resources"
    local nested
    for nested in $(jq -r '.StackResourceSummaries[] | select(.ResourceType == "AWS::CloudFormation::Stack") | .PhysicalResourceId' <<<"$resources"); do
        stack_cloudfront_distributions "$nested"
    done
}

# Disable the CloudFront distributions of the given stacks so their deletion does not have
# to wait for the disable to propagate. Only distributions found through the stacks are
# touched. The update returns at once; propagation runs while other resources are deleted.
disable_cloudfront_distributions() {
    echo "Disabling CloudFront distributions..."
    local stack dist config etag enabled
    for stack in "$@"; do
        for dist in $(stack_cloudfront_distributions "$stack"); do
            config=$(aws cloudfront get-distribution-config --id "$dist" --output json 2>/dev/null) || continue
            etag=$(jq -r '.ETag' <<<"$config")
            enabled=$(jq -r '.DistributionConfig.Enabled' <<<"$config")
            if [[ "$enabled" != "true" ]]; then
                echo "Distribution $dist ($stack) already disabled"
                continue
            fi
            jq '.DistributionConfig | .Enabled = false' <<<"$config" > "/tmp/cf-${dist}.json"
            if aws cloudfront update-distribution --id "$dist" --if-match "$etag" --distribution-config "file:///tmp/cf-${dist}.json" --no-cli-pager > /dev/null; then
                echo "Distribution $dist ($stack) disabling"
            else
                echo "Could not disable distribution $dist ($stack); CloudFormation will do it"
            fi
            rm -f "/tmp/cf-${dist}.json"
        done
    done
    echo "CloudFront distributions disabled."
}

delete_tenant_stacks() {
    echo "Deleting tenant stacks..."
    local tenant_jobs=()
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
            tenant_jobs+=("$i:$!")
        done

        next_token=$(echo "$response" | jq '.NextToken')
        if [[ "${next_token}" == "null" ]]; then
            echo "No more tenants left."
            # no more results left. Exit loop...
            break
        fi
    done
    if [[ ${#tenant_jobs[@]} -gt 0 ]]; then
        wait_for_jobs "${tenant_jobs[@]}"
    fi
    echo "Tenant stacks deleted."
}

empty_bucket() {
    local -r bucket="${1:?}"
    echo "Emptying s3://${bucket}..."
    for object_type in Versions DeleteMarkers; do
        local opt=() next_token=""
        while [[ "$next_token" != null ]]; do
            # A failed listing (bucket already gone, access denied) must end the loop,
            # otherwise next_token stays empty and this loops forever.
            if ! page="$(aws s3api list-object-versions --bucket "$bucket" --output json --max-items 400 "${opt[@]}" \
                        --query="[{Objects: ${object_type}[].{Key:Key, VersionId:VersionId}}, NextToken]")"; then
                echo "Could not list s3://${bucket}, skipping."
                return
            fi
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
    if ! aws s3api head-bucket --bucket "${bucket}" 2>/dev/null; then
        echo "Bucket ${bucket} does not exist, skipping."
        return
    fi
    empty_bucket ${bucket}
    aws s3 rb "s3://${bucket}"
    echo "Bucket deleted."
}

workshop_buckets() {
    aws s3 ls | awk '{print $3}' | grep -E "^saas-operations-*|^sam-bootstrap-*"
}

# Empty and delete all workshop buckets, one job per bucket
delete_buckets_once() {
    local jobs=() i
    for i in $(workshop_buckets); do
        delete_bucket "${i}" &
        jobs+=("${i}:$!")
    done
    if [[ ${#jobs[@]} -gt 0 ]]; then
        wait_for_jobs "${jobs[@]}"
    fi
}

delete_buckets() {
    echo "Deleting buckets..."
    delete_buckets_once
    # Try a second run, in case there was still data put into one of the buckets
    if [[ -n "$(workshop_buckets)" ]]; then
        echo "Sleeping for 60s to wait for bucket"
        sleep 60
        delete_buckets_once
    fi
    echo "Buckets deleted."
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
