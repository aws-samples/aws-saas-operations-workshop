#!/bin/bash
echo 'Provisioning stack '$STACK_NAME

echo "Install dependencies"
yarn install
echo "Deploy"
npx cdk deploy --require-approval never --context stackName=$STACK_NAME $STACK_NAME
exitCode=$?
if test $exitCode -ne 0
then
    echo "Error"
    exit 1
fi
echo "Done"
