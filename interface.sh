#!/bin/bash

SHARED_PASSWORD='Hello123!'
STACK_NAME='pool0'
APPLICATION_NAME='SaaSOpsV2'
STACK_NAME=$APPLICATION_NAME'-'$STACK_NAME
LOGGROUP_PREFIX='/'$APPLICATION_NAME'/'$STACK_NAME'/'
USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)
CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`ClientId`].OutputValue' --output text)
API=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
TENANTS=("TenantA" "TenantB")

sops_create_user() {
    USER=$1
    TENANT_ID=$(uuidgen)

    aws cognito-idp admin-create-user \
        --user-pool-id $USERPOOL_ID \
        --username $USER \
        --user-attributes \
            Name=email,Value=success+$USER@simulator.amazonses.com \
            Name=custom:tenantId,Value=$TENANT_ID \
            Name=custom:tier,Value=Basic \
            Name=custom:role,Value=User \
        --message-action SUPPRESS \
        --output text
    aws cognito-idp admin-set-user-password \
        --user-pool-id $USERPOOL_ID \
        --username $USER \
        --password $SHARED_PASSWORD \
        --permanent

    aws cognito-idp admin-create-user \
        --user-pool-id $USERPOOL_ID \
        --username ${USER}-adm \
        --user-attributes \
            Name=email,Value=success+$USER@simulator.amazonses.com \
            Name=custom:tenantId,Value=$TENANT_ID \
            Name=custom:tier,Value=Basic \
            Name=custom:role,Value=Admin \
        --message-action SUPPRESS \
        --output text
    aws cognito-idp admin-set-user-password \
        --user-pool-id $USERPOOL_ID \
        --username ${USER}-adm \
        --password $SHARED_PASSWORD \
        --permanent
}

sops_get_access_token() {
    USER=$1
    ACCESS_TOKEN=$(aws cognito-idp initiate-auth \
        --auth-flow USER_PASSWORD_AUTH \
        --client-id $CLIENT_ID \
        --auth-parameters USERNAME=$USER,PASSWORD="$SHARED_PASSWORD" \
        --output text \
        --query AuthenticationResult.AccessToken
    )
    echo $ACCESS_TOKEN
}

sops_init() {
    for TENANT in ${TENANTS[@]}; do
        sops_create_user $TENANT
    done
}

sops_logs_orders() {
    aws logs tail --follow $LOGGROUP_PREFIX'orders'
}

sops_logs_products() {
    aws logs tail --follow $LOGGROUP_PREFIX'products'
}

sops_logs_user() {
    aws logs tail --follow $LOGGROUP_PREFIX'user'
}

sops_logs_api() {
    aws logs tail --follow $LOGGROUP_PREFIX'api'
}

sops_logs_authorizer() {
    aws logs tail --follow $LOGGROUP_PREFIX'tenantauthorizer'
}

sops_test_user() {
    echo -e "\nTesting as regular user:"
    TENANT=${TENANTS[1]}
    ACCESS_TOKEN=$(sops_get_access_token $TENANT)
    USER_NAME="bobby"$(($RANDOM % 100))
    curl -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{ "userName":"'${USER_NAME}'","role":"User" }' \
        ${API}users
    echo -e "\n"
    echo -e "\nTesting as admin:"
    TENANT=${TENANTS[1]}-adm
    ACCESS_TOKEN=$(sops_get_access_token $TENANT)
    USER_NAME="bobby"$(($RANDOM % 100))
    curl -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{ "userName":"'${USER_NAME}'","role":"User" }' \
        ${API}users
    echo -e "\n"
}

sops_test() {
    for tenant in ${TENANTS[1]}; do
        PRODUCT_ID1=$(($RANDOM % 100))
        PRODUCT_ID2=$(($RANDOM % 100))
        PRODUCT_ID3=$(($RANDOM % 100))
        ORDER_ID1=$(($RANDOM % 10000))
        ORDER_ID2=$(($RANDOM % 10000))
        ACCESS_TOKEN=$(sops_get_access_token $TENANT)
        echo -e "\nTesting with "$TENANT
        echo -e "\nPost product:"
        curl -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"tighty whitey","price":20,"sku":"eww21" }' \
            ${API}products
        echo -e "\nPut product1:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"old man shorts","price":12,"sku":"musty24" }' \
            ${API}products/${PRODUCT_ID1}
        echo -e "\nPut product2:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"old man undies","price":22,"sku":"tasty22" }' \
            ${API}products/${PRODUCT_ID2}
        echo -e "\nPut product3:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"old man undies","price":22,"sku":"tasty22" }' \
            ${API}products/${PRODUCT_ID3}
        echo -e "\nDelete product3:"
        curl -X DELETE \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            ${API}products/${PRODUCT_ID3}
        echo -e "\nDelete product3 again:"
        curl -X DELETE \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            ${API}products/${PRODUCT_ID3}
        echo -e "\nGet product:"
        curl -X GET \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            "${API}products?productId=${PRODUCT_ID1}"
        echo -e "\nGet all products:"
        curl -X GET \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            "${API}products"
        echo -e "\n"
        echo -e "\nPost order:"
        curl -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "lines":[{"productId":"'${PRODUCT_ID1}'","quantity":1},{"productId":"'${PRODUCT_ID2}'","quantity":2}] }' \
            ${API}orders
        echo -e "\nPut order1:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "lines":[{"productId":"'${PRODUCT_ID1}'","quantity":1},{"productId":"'${PRODUCT_ID2}'","quantity":2}] }' \
            ${API}orders/${ORDER_ID1}
        echo -e "\nPut order2:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "lines":[{"productId":"'${PRODUCT_ID1}'","quantity":1},{"productId":"'${PRODUCT_ID2}'","quantity":2}] }' \
            ${API}orders/${ORDER_ID2}
        echo -e "\nGet order1:"
        curl -X GET \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            "${API}orders?orderId=${ORDER_ID1}"
        echo -e "\nDelete order1:"
        curl -X DELETE \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            "${API}orders/${ORDER_ID1}"
        echo -e "\nGet all orders:"
        curl -X GET \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            "${API}orders"
    done
}