#!/bin/bash

SHARED_PASSWORD='Stopthatthats51llY!'
APPLICATION_NAME='SaaSOpsV2'
TENANT_CATALOG=$APPLICATION_NAME"-TenantCatalog"

EVENT_BUS='SaaSOpsV2-EventBus'
EVENT_SOURCE='SAAS_CONTROL_PLANE'
CONTROL_PLANE_STACK='SaaSOpsV2-controlplane'

cheat() {
    if [[ -z "$1" ]]
    then
        while :; do
            read -p "Enter a lab number to deploy to: " lab
            [[ $lab =~ ^[0-5]+$ ]] || { echo "Enter a valid number"; return; }
            if ((lab >= 1 && lab <= 5)); then
                break
            else
                echo "Enter a number from 1 to 5"
                return
            fi
        done
    else
        [[ $1 =~ ^[1-5]+$ ]] || { echo "Enter a valid number"; return; }
        lab=$1
    fi

    SRC_DIR='/home/ec2-user/environment/src'
    TENANT_MGMT=$SRC_DIR'/controlplane/tenant-mgmt/tenant-mgmt.ts'
    CONTROLPLANE=$SRC_DIR'/controlplane/controlplane.ts'

    for ((i=1;i<=$lab;i++)); do
        if [ $i -eq 5 ]; then
            src_file=$CONTROLPLANE
        else
            src_file=$TENANT_MGMT
        fi
        src_file_tmp=$src_file'.tmp'
        EXPRESSION=LAB$i
        echo "Uncommenting " $EXPRESSION
        START=$EXPRESSION'-TODO'
        END=$EXPRESSION'-END'
        ACTIVE=false
        while IFS= read -r line || [ -n "$line" ]; do
            if $ACTIVE ; then
                if echo $line | grep -q "//$END"; then
                    ACTIVE=false
                    echo "$line" >> $src_file_tmp
                else
                    echo "$line" | sed 's/\/\///' >> $src_file_tmp
                fi
            else
                echo "$line" >> $src_file_tmp
            fi
            if echo $line | grep -q "//$START"; then
                ACTIVE=true
            fi
        done < $src_file
        mv $src_file_tmp $src_file
    done

    npx projen deploy
}

create_order() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    elif [[ -z "$2" ]]
    then
        echo "Please provide a username"
    else
        TENANT_ID=$1
        USER_NAME=$2
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        ACCESS_TOKEN=$(get_access_token $TENANT_ID $USER_NAME)
        PRODUCT_ID1=$(($RANDOM % 100))
        PRODUCT_ID2=$(($RANDOM % 100))
        echo -e "\nPut product1:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"old man shorts","price":12,"sku":"musty24" }' \
            ${API}products/${PRODUCT_ID1} &> /dev/null
        echo -e "\nPut product2:"
        curl -X PUT \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"undies","name":"old man undies","price":22,"sku":"tasty22" }' \
            ${API}products/${PRODUCT_ID2} &> /dev/null
        echo -e "\nPost order:"
        curl -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "lines":[{"productId":"'${PRODUCT_ID1}'","quantity":1},{"productId":"'${PRODUCT_ID2}'","quantity":2}] }' \
            ${API}orders &> /dev/null
    fi
}

create_orders() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        USER_NAME=$1'-Admin'
        COUNT=${2:-30}
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        ACCESS_TOKEN=$(get_access_token $TENANT_ID $USER_NAME)
        echo "Creating orders"
        for i in $( eval echo {1..$COUNT} )
        do
            curl -X POST \
                -H "Authorization: Bearer $ACCESS_TOKEN" \
                -H "Content-Type: application/json" \
                --data '{ "lines":[{"productId":"'799893'","quantity":1},{"productId":"'366271'","quantity":2}] }' \
                ${API}orders &> /dev/null
        done
        echo -e "Created orders"
    fi
}

create_product() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        USER_NAME=${2:-$TENANT_ID'-Admin'}
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        ACCESS_TOKEN=$(get_access_token $TENANT_ID $USER_NAME)
        curl -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "category":"guitarists","name":"Roine Stolt","price":20,"sku":"eww21" }' \
            ${API}products &> /dev/null
    fi
    echo "Created product"
}

create_products() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        USER_NAME=$1'-Admin'
        COUNT=${2:-30}
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        ACCESS_TOKEN=$(get_access_token $TENANT_ID $USER_NAME)
        echo "Creating products"
        for i in $( eval echo {1..$COUNT} )
        do
            curl -X POST \
                -H "Authorization: Bearer $ACCESS_TOKEN" \
                -H "Content-Type: application/json" \
                --data '{ "category":"guitarists","name":"Duane Allman","price":22,"sku":"ABB" }' \
                ${API}products &> /dev/null
        done
        echo -e "Created products"
    fi
}

create_user() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    elif [[ -z "$2" ]]
    then
        echo "Please provide a username"
    else
        TENANT_ID=$1
        USER_NAME=$2
        TENANT_ADMIN=$TENANT_ID'-Admin'
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        CLIENT_ID=$(get_stack_client_id $STACKNAME)
        ACCESS_TOKEN=$(get_access_token $TENANT_ID $TENANT_ADMIN)
        echo -e "\nCreating user: "${USER_NAME}
        curl -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "username":"'${USER_NAME}'","role":"USER" }' \
            ${API}users &> /dev/null
    fi
    echo "Created user "$2
}

delete_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_DELETE_REQUEST'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

delete_tenant_data() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_DATA_DELETE_REQUEST'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

delete_tenant_users() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_USER_DELETE_REQUEST'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

export_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_EXPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\"}"}'
    fi
}

export_tenant_data() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_DATA_EXPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

export_tenant_users() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_USER_EXPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

get_access_token() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    elif [[ -z "$2" ]]
    then
        echo "Please provide a user name"
    else
        TENANT_ID=$1
        USER_NAME=$2
        STACKNAME=$(get_stack $TENANT_ID)
        API=$(get_stack_api $STACKNAME)
        RESPONSE=$(curl -X POST \
            -s \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            --data '{ "username":"'${USER_NAME}'","password":"'${SHARED_PASSWORD}'" }' \
            ${API}auth) &> /dev/null
        echo $RESPONSE|jq -r '.accessToken'
    fi
}

get_exports_archive() {
    BUCKET=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK --query 'Stacks[0].Outputs[?OutputKey==`ArchiveBucket`].OutputValue' --output text)
    if [[ -z "$1" ]]
    then
        aws s3 ls --recursive s3://$BUCKET
    else
        KEY=$1
        aws s3 cp s3://$BUCKET/$KEY - | jq -r
    fi
}

get_exports_temporary() {
    BUCKET=$(aws cloudformation describe-stacks --stack-name $CONTROL_PLANE_STACK --query 'Stacks[0].Outputs[?OutputKey==`TemporaryBucket`].OutputValue' --output text)
    if [[ -z "$1" ]]
    then
        aws s3 ls --recursive s3://$BUCKET
    else
        KEY=$1
        aws s3 cp s3://$BUCKET/$KEY - | jq -r
    fi
}

get_orders() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        STACKNAME=$(get_stack $TENANT_ID)
        aws ddb select $STACKNAME --key-condition 'pk = "'$TENANT_ID'" AND begins_with(sk, "ORDER#")' --attributes COUNT
    fi
}

get_products() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        STACKNAME=$(get_stack $TENANT_ID)
        aws ddb select $STACKNAME --key-condition 'pk = "'$TENANT_ID'" AND begins_with(sk, "PRODUCT#")' --attributes COUNT
    fi
}

get_stack() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND sk =  "TENANT#'$TENANT_ID'"' --projection "stackName"|grep stackName|cut -f 3 -d " "|sed 's/STACK#//'
    fi
}

get_stack_api() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a stack"
    else
        STACKNAME=$1
        API=$(aws cloudformation describe-stacks --stack-name $STACKNAME --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
        echo $API
    fi
}

get_stack_client_id() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a stack"
    else
        STACKNAME=$1
        CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACKNAME --query 'Stacks[0].Outputs[?OutputKey==`ClientId`].OutputValue' --output text)
        echo $CLIENT_ID
    fi
}

get_stack_userpool_id() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a stack"
    else
        STACKNAME=$1
        USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACKNAME --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)
        echo $USERPOOL_ID
    fi
}

get_stacks() {
    echo -e "\nStacks in tenantCatalog:"
    aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND begins_with(sk, "STACK#")' --projection "sk,status,tier,url"|sed 's/sk: STACK#/stackName: /'|sed 's/TIER#//'
}

get_tenants() {
    echo -e "\nTenants in tenantCatalog:"
    aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND begins_with(sk, "TENANT#")' --projection "sk,tier,status,stackName"|sed 's/TENANT#//'|sed 's/STACK#//'|sed 's/sk:/tenantId:/'
}

get_users() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        STACKNAME=$(get_stack $TENANT_ID)
        USERPOOL_ID=$(get_stack_userpool_id $STACKNAME)
        aws cognito-idp list-users --user-pool-id $USERPOOL_ID --query 'Users[].{Username:Username, TenantId:Attributes[?Name==`custom:tenantId`].Value}'|grep -B2 $TENANT_ID|grep "Username"|cut -d'"' -f4
    fi
}

import_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_IMPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

import_tenant_data() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_DATA_IMPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

import_tenant_users() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_USER_IMPORT_REQUEST'
        EXPORT_TYPE='ARCHIVE'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"exportType\":\"'$EXPORT_TYPE'\",\"stackName\":\"'$(get_stack $TENANT_ID)'\"}"}'
    fi
}

load_test_basic() {
    DETAIL_TYPE='LOAD_TESTING_REQUEST'
    TIER='BASIC'
    COUNT=1
    MAXVUSERS=4
    aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tier\":\"'$TIER'\",\"count\":\"'$COUNT'\",\"maxVUsers\":\"'$MAXVUSERS'\"}"}'
}

load_test_premium() {
    DETAIL_TYPE='LOAD_TESTING_REQUEST'
    TIER='PREMIUM'
    COUNT=1
    MAXVUSERS=4
    aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tier\":\"'$TIER'\",\"count\":\"'$COUNT'\",\"maxVUsers\":\"'$MAXVUSERS'\"}"}'
}

migrate_tenant_to_basic() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_MIGRATE_REQUEST'
        TIER='BASIC'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"tier\":\"'$TIER'\"}"}'
    fi
}

migrate_tenant_to_premium() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_MIGRATE_REQUEST'
        TIER='PREMIUM'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\",\"tier\":\"'$TIER'\"}"}'
    fi
}

offboard_all() {
    local tenants=$(aws ddb select $TENANT_CATALOG --key-condition 'pk = "DESCRIPTION#" AND begins_with(sk, "TENANT#")' --projection "sk"|grep sk|cut -f 3 -d " "|sed 's/TENANT#//')
    for tenant in $tenants; do
        offboard_tenant $tenant
    done
}

offboard_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='OFFBOARDING_REQUEST'
        aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\"}"}'
    fi
}

onboard_basic_tenant() {
    TENANT_NAME='sheepylove'$(($RANDOM % 100))
    DETAIL_TYPE='ONBOARDING_REQUEST'
    TIER='BASIC'
    aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantName\":\"'$TENANT_NAME'\",\"tier\":\"'$TIER'\"}"}'
}

onboard_premium_tenant() {
    TENANT_NAME='sheepylove'$(($RANDOM % 100))
    DETAIL_TYPE='ONBOARDING_REQUEST'
    TIER='PREMIUM'
    aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantName\":\"'$TENANT_NAME'\",\"tier\":\"'$TIER'\"}"}'
}

restore_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        DETAIL_TYPE='TENANT_RESTORE_REQUEST'
    fi
    aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$DETAIL_TYPE'","Detail":"{\"tenantId\":\"'$TENANT_ID'\"}"}'
}

test_tenant() {
    if [[ -z "$1" ]]
    then
        echo "Please provide a tenant ID"
    else
        TENANT_ID=$1
        COUNT=${2:-30}
        USER_NAME='User'$(($RANDOM % 1000))
        create_user $TENANT_ID $USER_NAME &
        create_products $TENANT_ID $COUNT &
        sleep 1
        create_orders $TENANT_ID $COUNT
        echo ""
    fi
}
