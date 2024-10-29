#!/bin/bash
echo 'Deprovisioning stack '$STACK_NAME

yarn install
npx projen
npx cdk destroy --force --context stackName=$STACK_NAME $STACK_NAME
exitCode=$?
if test $exitCode -ne 0
then
    echo "Error"
    exit 1
fi
echo "Done"
