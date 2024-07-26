#!/bin/bash
echo 'Provisioning stack '$STACK_NAME

STACK_CONFIG='./stack-config.json'

npm install -g aws-cdk jq

if [ -f $STACK_CONFIG ]; then
    rm $STACK_CONFIG
fi

JSON_STRING='{"stackName":"'"$STACK_NAME"'"}'
echo $JSON_STRING > $STACK_CONFIG

npm install
rm -f yarn.lock
echo "Install dependencies"
npx projen
#echo "Build"
#npx projen build 
echo "Deploy"
cdk deploy --require-approval never --context stackName=$STACK_NAME SaaSOpsV2-$STACK_NAME