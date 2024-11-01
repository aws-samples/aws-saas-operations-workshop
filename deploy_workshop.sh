#!/bin/bash

echo "Install dependencies"
if ! command -v npm 2>&1 >/dev/null
then
    echo "Installing npm"
    sudo yum install -y npm
fi
if ! command -v jq 2>&1 >/dev/null
then
    echo "Installing jq"
    sudo yum install -y jq
fi
if ! command -v yarn 2>&1 >/dev/null
then
    echo "Installing yarn"
    sudo npm install -g yarn
fi

[[ -f yarn.lock ]] && rm yarn.lock
[[ -f package-lock.json]] && rm package-lock.json

yarn install
npx cdk bootstrap
npx projen deploy

echo "Provisioning basic cell"
APPLICATION_NAME='SaaSOpsV2'
EVENT_BUS='SaaSOpsV2-EventBus'
EVENT_SOURCE='SAAS_CONTROL_PLANE'
DETAIL_TYPE='PROVISIONING_REQUEST'
TIER='BASIC'
STACK_NAME=$APPLICATION_NAME'-cell-basic'
TENANT_CATALOG=$APPLICATION_NAME"-TenantCatalog"

aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"stackName\":\"'$STACK_NAME'\",\"tier\":\"'$TIER'\"}"}'
STACKS=$(aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND begins_with(sk, "STACK#")' --projection "status"|grep ACTIVE|cut -f 3 -d " ")
echo "Waiting for stack creation"
while [ -z ${STACKS} ]; do
    sleep 15
    echo "Still waiting"
    STACKS=$(aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND begins_with(sk, "STACK#")' --projection "status"|grep ACTIVE|cut -f 3 -d " ")
done
echo "Stack created"
