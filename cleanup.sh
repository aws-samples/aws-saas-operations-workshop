#!/bin/bash
##
## This script aims to clean up resources created for the
## SaaS Operations Workshop. This script is based on the guidance
## provided here: 
## https://catalog.us-east-1.prod.workshops.aws/workshops/b0c6ad36-0a4b-45d8-856b-8a64f0ac76bb/en-US/cleanup
##
## Note that this script can also be used to clean up resources for the
## SaaS Operations Reference Solution as outlined here:
## https://github.com/aws-samples/aws-saas-factory-ref-solution-saas-operations#steps-to-clean-up
##
##

# helper function
delete_stack_after_confirming() {
    if [[ -z "${1}" ]]; then
        echo "$(date) stack name missing..."
        return
    fi

    stack=$(aws cloudformation describe-stacks --stack-name "$1")
    if [[ -z "${stack}" ]]; then
        echo "$(date) stack ${1} does not exist..."
        return
    fi

    if [[ -z "${skip_flag}" ]]; then
        read -p "Delete stack with name $1 [Y/n] " -n 1 -r
    fi

    if [[ $REPLY =~ ^[n]$ ]]; then
        echo "$(date) NOT deleting stack $1."
    else
        echo "$(date) deleting stack $1..."
        aws cloudformation delete-stack --stack-name "$1"

        echo "$(date) waiting for stack delete operation to complete..."
        aws cloudformation wait stack-delete-complete --stack-name "$1"
    fi
}

# helper function
delete_codecommit_repo_after_confirming() {
    REPO_NAME="$1"
    repo=$(aws codecommit get-repository --repository-name "$REPO_NAME")
    if [[ -n "${repo}" ]]; then

        if [[ -z "${skip_flag}" ]]; then
            read -p "Delete codecommit repo with name \"$REPO_NAME\" [Y/n] " -n 1 -r
        fi

        if [[ $REPLY =~ ^[n]$ ]]; then
            echo "$(date) NOT deleting $REPO_NAME."
        else
            echo "$(date) deleting codecommit repo \"$REPO_NAME\"..."
            aws codecommit delete-repository --repository-name "$REPO_NAME"
        fi
    else
        echo "$(date) repo \"$REPO_NAME\" does not exist..."
    fi
}

skip_flag=''
while getopts 's' flag; do
  case "${flag}" in
    s) skip_flag='true' ;;
    *) error "Unexpected option ${flag}!" && exit 1 ;;
  esac
done

echo "$(date) Cleaning up resources..."
if [[ -n "${skip_flag}" ]]; then
    echo "skip_flag enabled. Script will not pause for confirmation before deleting resources!"
else
    echo "skip_flag disabled. Script will pause for confirmation before deleting resources."
fi

echo "$(date) Stopping workshop trails in CloudTrails..."
if [[ -z "${skip_flag}" ]]; then
    read -p "Stop CloudTrail logging for the workshop? [Y/n] " -n 1 -r
fi

if [[ $REPLY =~ ^[n]$ ]]; then
    echo "$(date) NOT stopping CloudTrail logs"
else
    echo "$(date) stopping CloudTrail logs..."
    aws cloudtrail stop-logging --name "saas-ops-ddb-access-trails"
    aws cloudtrail stop-logging --name "saas-ops-management-trails"
fi

delete_stack_after_confirming "stack-pooled"

echo "$(date) cleaning up platinum tenants..."
next_token=""
STACK_STATUS_FILTER="CREATE_COMPLETE ROLLBACK_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE"
while true; do
    if [[ "${next_token}" == "" ]]; then
        echo "$(date) making api call to search for platinum tenants..."
        # shellcheck disable=SC2086
        # ignore shellcheck error for adding a quote as that causes the api call to fail
        response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER | sed 's/\\n//')
    else
        echo "$(date) making api call to search for platinum tenants..."
        # shellcheck disable=SC2086
        # ignore shellcheck error for adding a quote as that causes the api call to fail
        response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER --starting-token "$next_token"| sed 's/\\n//')
    fi

    tenant_stacks=$(echo "$response" | jq -r '.StackSummaries[].StackName | select(. | test("^stack-*"))')
    for i in $tenant_stacks; do
        delete_stack_after_confirming "$i"
    done

    next_token=$(echo "$response" | jq '.NextToken')
    if [[ "${next_token}" == "null" ]]; then
        echo "$(date) no more platinum tenants left."
        # no more results left. Exit loop...
        break
    fi
done

echo "$(date) cleaning up buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^saas-operations-*|^sam-bootstrap-*"); do

    if [[ -z "${skip_flag}" ]]; then
        read -p "Delete bucket with name s3://${i} [Y/n] " -n 1 -r
    fi

    if [[ $REPLY =~ ^[n]$ ]]; then
        echo "$(date) NOT deleting bucket s3://${i}."
    else
        echo "$(date) emptying out s3 bucket with name s3://${i}..."
        aws s3api delete-objects --bucket ${i} --delete "$(aws s3api list-object-versions --bucket ${i} --output=json --query='{Objects: Versions[].{Key:Key,VersionId:VersionId}}')" --no-cli-pager
        aws s3api delete-objects --bucket ${i} --delete "$(aws s3api list-object-versions --bucket ${i} --output=json --query='{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')" --no-cli-pager
        echo "$(date) deleting s3 bucket with name s3://${i}..."
        aws s3 rb "s3://${i}"
    fi
done

delete_stack_after_confirming "saas-operations-controlplane"
delete_stack_after_confirming "saas-operations-pipeline"

delete_codecommit_repo_after_confirming "aws-saas-factory-saas-operations"
# delete_codecommit_repo_after_confirming "aws-saas-operations-workshop"

echo "$(date) cleaning up log groups..."
next_token=""
while true; do
    if [[ "${next_token}" == "" ]]; then
        response=$(aws logs describe-log-groups)
    else
        response=$(aws logs describe-log-groups --starting-token "$next_token")
    fi

    log_groups=$(echo "$response" | jq -r '.logGroups[].logGroupName | select(. | test("^/aws/lambda/stack-*|^/aws/lambda/saas-operations-*|^/aws/api-gateway/access-logs-saas-operations-*|^/aws/lambda/saasOpsWorkshop-*|^saas-operations-pipeline-*|/aws/codebuild/Build45A36621-*|API-Gateway-Execution-Logs_*"))')
    for i in $log_groups; do
        if [[ -z "${skip_flag}" ]]; then
            read -p "Delete log group with name $i [Y/n] " -n 1 -r
        fi

        if [[ $REPLY =~ ^[n]$ ]]; then
            echo "$(date) NOT deleting log group $i."
        else
            echo "$(date) deleting log group with name $i..."
            aws logs delete-log-group --log-group-name "$i"
        fi
    done

    next_token=$(echo "$response" | jq '.NextToken')
    if [[ "${next_token}" == "null" ]]; then
        # no more results left. Exit loop...
        break
    fi
done

echo "$(date) cleaning up user pools..."
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
        if [[ -z "${skip_flag}" ]]; then
            read -p "Delete user pool with name $i [Y/n] " -n 1 -r
        fi

        if [[ $REPLY =~ ^[n]$ ]]; then
            echo "$(date) NOT deleting user pool $i."
        else
            echo "$(date) deleting user pool with name $i..."
            echo "getting pool domain..."
            pool_domain=$(aws cognito-idp describe-user-pool --user-pool-id "$i" | jq -r '.UserPool.Domain')

            echo "deleting pool domain $pool_domain..."
            aws cognito-idp delete-user-pool-domain \
                --user-pool-id "$i" \
                --domain "$pool_domain"

            echo "deleting pool $i..."
            aws cognito-idp delete-user-pool --user-pool-id "$i"
        fi
    done

    next_token=$(echo "$response" | jq -r '.NextToken')
    if [[ "${next_token}" == "null" ]]; then
        # no more results left. Exit loop...
        break
    fi
done

echo "$(date) cleaning up buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "saasoperationsworkshopc9*"); do

    if [[ -z "${skip_flag}" ]]; then
        read -p "Delete bucket with name s3://${i} [Y/n] " -n 1 -r
    fi

    if [[ $REPLY =~ ^[n]$ ]]; then
        echo "$(date) NOT deleting bucket s3://${i}."
    else
        echo "$(date) emptying out s3 bucket with name s3://${i}..."
        aws s3api delete-objects --bucket ${i} --delete "$(aws s3api list-object-versions --bucket ${i} --output=json --query='{Objects: Versions[].{Key:Key,VersionId:VersionId}}')"
        aws s3api delete-objects --bucket ${i} --delete "$(aws s3api list-object-versions --bucket ${i} --output=json --query='{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}')"
        
        echo "$(date) deleting s3 bucket with name s3://${i}..."
        aws s3 rb "s3://${i}"
    fi
done

echo "$(date) Cleaning up workshop stacks"
for i in $(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE --query "StackSummaries[?contains(StackName,'saasOpsWorkshop')].StackName" --output text); do
    delete_stack_after_confirming ${i}
done
delete_stack_after_confirming "saasOpsWorkshop-tierPerformance"
delete_stack_after_confirming "saasOpsWorkshop-applicationSummary"

echo "$(date) Cleaning up API keys"
for i in $(aws apigateway get-api-keys --query "items[?contains(name,'saasOpsWorkshop')].id" --output text); do
    aws apigateway delete-api-key --api-key ${i}
done

echo "$(date) Done cleaning up resources!"
