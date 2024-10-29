#!/bin/bash

STACK_NAME="SaaSOpsV2-Vscode"

saasops_deploy_wait() {
    START_TIME=$(date '+%s')
    STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='$STACK_NAME'].StackStatus" --output text)
    while [ $STATUS == 'CREATE_IN_PROGRESS' ]; do
        CURRENT_TIME=$(date '+%s')
        DDIFF=$(( $CURRENT_TIME - $START_TIME ))
        echo $(date) "SaaSOpsV2 stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s"
        sleep 15
        STATUS=$(aws cloudformation describe-stacks --query "Stacks[?StackName=='$STACK_NAME'].StackStatus" --output text)
    done
    CURRENT_TIME=$(date '+%s')
    DDIFF=$(( $CURRENT_TIME - $START_TIME ))
    echo $(date) "SaaSOpsV2 stack status: "$STATUS", Time elapsed: "$(($DDIFF / 60))"m"$(($DDIFF % 60))"s."
    if [[ $STATUS == 'CREATE_COMPLETE' ]]; then
        echo $(date) "SaaSOpsV2 workshop deployed. Please proceed and enjoy the workshop!"
    fi
}

STACK_ID=$(aws cloudformation create-stack --stack-name $STACK_NAME --template-body file://SaaSOpsV2VscodeStack.template.json --capabilities CAPABILITY_IAM --query StackId --output text)

echo "STACK_ID: $STACK_ID"
echo "CloudFormation stack $STACK_NAME creation started. You can monitor progress in the AWS Console at https://console.aws.amazon.com/cloudformation"

saasops_deploy_wait