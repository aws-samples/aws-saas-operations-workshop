#!/bin/bash

REGION=$(aws configure get region)
ACCOUNT=$(aws sts get-caller-identity | jq '.Account' -r)
BASIC_TENANT_1=$(aws dynamodb query --table-name SaaSOperations-TenantDetails --index-name SaasOperations-TenantConfig --projection-expression "tenantId" --key-condition-expression "tenantName = :tn" --expression-attribute-values '{":tn": {"S": "BasicTestTenant1"}}' --return-consumed-capacity NONE | jq '.Items[0].tenantId.S' -r)
BASIC_TENANT_2=$(aws dynamodb query --table-name SaaSOperations-TenantDetails --index-name SaasOperations-TenantConfig --projection-expression "tenantId" --key-condition-expression "tenantName = :tn" --expression-attribute-values '{":tn": {"S": "BasicTestTenant2"}}' --return-consumed-capacity NONE | jq '.Items[0].tenantId.S' -r)
PLATINUM_TENANT=$(aws dynamodb query --table-name SaaSOperations-TenantDetails --index-name SaasOperations-TenantConfig --projection-expression "tenantId" --key-condition-expression "tenantName = :tn" --expression-attribute-values '{":tn": {"S": "PlatinumTestTenant"}}' --return-consumed-capacity NONE | jq '.Items[0].tenantId.S' -r)

cd ~/environment/aws-saas-operations-workshop/App/isolation-test

cat <<EoF >config.json
{
    "accountId": "$ACCOUNT",
    "region": "$REGION",
    "basicTenant1": "$BASIC_TENANT_1",
    "basicTenant2": "$BASIC_TENANT_2",
    "platinumTenant": "$PLATINUM_TENANT"
}
EoF