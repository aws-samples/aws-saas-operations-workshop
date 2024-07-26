#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Deploying workshop resources..."

alias saasops_logs="aws logs tail --follow /aws/codebuild/install-workshop-stack-codebuild"

saasops_deploy_wait() {
    START_TIME=$(date '+%s')
    STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='SaaSOps'].StackStatus" --output text)
    while [ $STATUS == 'CREATE_IN_PROGRESS' ]; do
        CURRENT_TIME=$(date '+%s')
        DDIFF=$(( $CURRENT_TIME - $START_TIME ))
        echo $(date) "SaaSOps Stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s"
        sleep 15
        STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='SaaSOps'].StackStatus" --output text)
    done
    CURRENT_TIME=$(date '+%s')
    DDIFF=$(( $CURRENT_TIME - $START_TIME ))
    echo $(date) "SaaSOps Stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s."
    if [[ $STATUS == 'CREATE_COMPLETE' ]]; then
        echo $(date) "SaaSOps workshop deployed. Please proceed and enjoy the workshop!"
    fi
}

STACK_NAME="SaaSOps"${1:-""}
REPO_URL="https://github.com/aws-samples/aws-saas-operations-workshop.git"
REPO_BRANCH_NAME="main"
PARTICIPANT_ASSUMED_ROLE_ARN="$(aws sts get-caller-identity --query 'Arn' --output text)"

STACK_ID=$(aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body file://WorkshopStack.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters \
        ParameterKey=RepoUrl,ParameterValue="$REPO_URL" \
        ParameterKey=RepoBranchName,ParameterValue="$REPO_BRANCH_NAME" \
        ParameterKey=ParticipantAssumedRoleArn,ParameterValue="$PARTICIPANT_ASSUMED_ROLE_ARN" \
    --query StackId --output text)

echo "STACK_ID: $STACK_ID"
echo "CloudFormation stack $STACK_NAME creation started. You can monitor progress in the AWS Console at https://console.aws.amazon.com/cloudformation"

saasops_deploy_wait
