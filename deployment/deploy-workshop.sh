#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Deploying workshop resources..."

alias saasops_logs="aws logs tail --follow /aws/codebuild/install-workshop-stack-codebuild"

STACK_NAME="SaaSOps"
REPO_URL="https://github.com/aws-samples/aws-saas-operations-workshop.git"
REPO_BRANCH_NAME="main"
PARTICIPANT_ASSUMED_ROLE_ARN="$(aws sts get-caller-identity --query 'Arn' --output text)"
IGNORE_AUDITING_LAB="False"

while getopts "xh" flag; do
    case $flag in
        x) # Handle the -x flag
            echo "-x flag specified"
            echo "Ignoreing Auditing tenant isolation lab resources"
            IGNORE_AUDITING_LAB="True"
        ;;
        h) # Handle the -h flag
            echo "Initiates the workshop deployment process"
            echo "Optional flags:"
            echo "-h (help) Prints this help message"
            echo "-x (exclude) Skips deploying resources for Auditing tenant isolation lab."
            exit
        ;;
        \?) # Handle invalid flag
            echo "Unknown flag. Use -h to see usages"
            exit
        ;;
    esac
done

saasops_deploy_wait() {
    START_TIME=$(date '+%s')
    STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='SaaSOps'].StackStatus" --output text)
    while [ $STATUS == 'CREATE_IN_PROGRESS' ]; do
        CURRENT_TIME=$(date '+%s')
        DDIFF=$(( $CURRENT_TIME - $START_TIME ))
        echo $(date) "SaaSOps Stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s"
        sleep 15
        STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='$STACK_NAME'].StackStatus" --output text)
    done
    CURRENT_TIME=$(date '+%s')
    DDIFF=$(( $CURRENT_TIME - $START_TIME ))
    echo $(date) "SaaSOps Stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s."
    if [[ $STATUS == 'CREATE_COMPLETE' ]]; then
        echo $(date) "SaaSOps workshop deployed. Please proceed and enjoy the workshop!"
    fi
}

echo "IGNORE_AUDITING_LAB="$IGNORE_AUDITING_LAB

STACK_ID=$(aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body file://WorkshopStack.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters \
        ParameterKey=RepoUrl,ParameterValue="$REPO_URL" \
        ParameterKey=RepoBranchName,ParameterValue="$REPO_BRANCH_NAME" \
        ParameterKey=ParticipantAssumedRoleArn,ParameterValue="$PARTICIPANT_ASSUMED_ROLE_ARN" \
        ParameterKey=IgnoreAuditingLab,ParameterValue="$IGNORE_AUDITING_LAB" \
    --query StackId --output text)

echo "STACK_ID: $STACK_ID"
echo "CloudFormation stack $STACK_NAME creation started. You can monitor progress in the AWS Console at https://console.aws.amazon.com/cloudformation"

saasops_deploy_wait
