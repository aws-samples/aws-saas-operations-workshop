#!/bin/bash

# Install artillery - For Load testing
npm install -g artillery@2.0.7 --silent

# Profiles used
export PROFILE_PLATINUM='profile_platinum.yaml'
export PROFILE_BASIC1='profile_basic1.yaml'
export PROFILE_BASIC2='profile_basic2.yaml'
export PROFILE_BASIC3='profile_basic3.yaml'

# Setup temp files
export ENV_PLATINUM='./.env_platinum'
export ENV_BASIC='./.env_basic'
export OUT_PLATINUM='./.out_platinum.txt'
export OUT_BASIC1='./.out_basic1.txt'
export OUT_BASIC2='./.out_basic2.txt'
export OUT_BASIC3='./.out_basic3.txt'
export PID_PLATINUM='./.pid_platinum.nohup'
export PID_BASIC1='./.pid_basic1.nohup'
export PID_BASIC2='./.pid_basic2.nohup'
export PID_BASIC3='./.pid_basic3.nohup'

# Delete any existing temp files
for FILE in $ENV_PLATINUM $ENV_BASIC $OUT_PLATINUM $OUT_BASIC1 $OUT_BASIC2 $OUT_BASIC3 $PID_PLATINUM $PID_BASIC1 $PID_BASIC2 $PID_BASIC3; do
    if [ -f $FILE ]; then
        rm $FILE
    fi
done

# Configure region
export ADMIN_APIGATEWAYURL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminApiGatewayUrl'].Value" --output text)
export LOAD_REGION=$(aws configure get region)
export LOAD_USER_PASS=Lab@12345

# Configure silo tenant
export S1_METADATA=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/SiloedTenant1")
export S1_USERPOOL=$(echo $S1_METADATA | jq -r '.userPoolId')
export S1_CLIENTID=$(echo $S1_METADATA | jq -r '.appClientId')

echo S1_ENDPOINT=$(echo $S1_METADATA | jq -r '.apiGatewayUrl') > $ENV_PLATINUM

export S1_USER=$( aws cognito-idp list-users --user-pool-id $S1_USERPOOL --filter "email = \"success+SiloedTenant1@simulator.amazonses.com\"" | jq -r '.Users[]|.Username')
aws cognito-idp admin-set-user-password --user-pool-id $S1_USERPOOL --username $S1_USER --password $LOAD_USER_PASS --permanent

echo S1_TOKEN=$(aws cognito-idp initiate-auth --region $LOAD_REGION --auth-flow USER_PASSWORD_AUTH   \
--client-id $S1_CLIENTID --auth-parameters \
USERNAME=$S1_USER,PASSWORD=$LOAD_USER_PASS | jq -r .AuthenticationResult.IdToken) >> $ENV_PLATINUM

# Configure pool tenants
export P1_METADATA=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/PooledTenant1")
export P2_METADATA=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/PooledTenant2")
export P3_METADATA=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/PooledTenant3")
export P4_METADATA=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/PooledTenant4")

export P1_USERPOOL=$(echo $P1_METADATA | jq -r '.userPoolId')
export P2_USERPOOL=$(echo $P2_METADATA | jq -r '.userPoolId')
export P3_USERPOOL=$(echo $P3_METADATA | jq -r '.userPoolId')
export P4_USERPOOL=$(echo $P4_METADATA | jq -r '.userPoolId')

export P1_CLIENTID=$(echo $P1_METADATA | jq -r '.appClientId')
export P2_CLIENTID=$(echo $P2_METADATA | jq -r '.appClientId')
export P3_CLIENTID=$(echo $P3_METADATA | jq -r '.appClientId')
export P4_CLIENTID=$(echo $P4_METADATA | jq -r '.appClientId')

echo P1_ENDPOINT=$(echo $P1_METADATA | jq -r '.apiGatewayUrl') > $ENV_BASIC
echo P2_ENDPOINT=$(echo $P1_METADATA | jq -r '.apiGatewayUrl') >> $ENV_BASIC
echo P3_ENDPOINT=$(echo $P3_METADATA | jq -r '.apiGatewayUrl') >> $ENV_BASIC
echo P4_ENDPOINT=$(echo $P4_METADATA | jq -r '.apiGatewayUrl') >> $ENV_BASIC

export P1_USER=$( aws cognito-idp list-users --user-pool-id $P1_USERPOOL --filter "email = \"success+PooledTenant1@simulator.amazonses.com\"" | jq -r '.Users[]|.Username')
export P2_USER=$( aws cognito-idp list-users --user-pool-id $P2_USERPOOL --filter "email = \"success+PooledTenant2@simulator.amazonses.com\"" | jq -r '.Users[]|.Username')
export P3_USER=$( aws cognito-idp list-users --user-pool-id $P3_USERPOOL --filter "email = \"success+PooledTenant3@simulator.amazonses.com\"" | jq -r '.Users[]|.Username')
export P4_USER=$( aws cognito-idp list-users --user-pool-id $P4_USERPOOL --filter "email = \"success+PooledTenant4@simulator.amazonses.com\"" | jq -r '.Users[]|.Username')

aws cognito-idp admin-set-user-password --user-pool-id $P1_USERPOOL --username $P1_USER --password $LOAD_USER_PASS --permanent
aws cognito-idp admin-set-user-password --user-pool-id $P2_USERPOOL --username $P2_USER --password $LOAD_USER_PASS --permanent
aws cognito-idp admin-set-user-password --user-pool-id $P3_USERPOOL --username $P3_USER --password $LOAD_USER_PASS --permanent
aws cognito-idp admin-set-user-password --user-pool-id $P4_USERPOOL --username $P4_USER --password $LOAD_USER_PASS --permanent

echo P1_TOKEN=$(aws cognito-idp initiate-auth --region $LOAD_REGION --auth-flow USER_PASSWORD_AUTH   \
--client-id $P1_CLIENTID --auth-parameters \
USERNAME=$P1_USER,PASSWORD=$LOAD_USER_PASS | jq -r .AuthenticationResult.IdToken) >> $ENV_BASIC
echo P2_TOKEN=$(aws cognito-idp initiate-auth --region $LOAD_REGION --auth-flow USER_PASSWORD_AUTH   \
--client-id $P2_CLIENTID --auth-parameters \
USERNAME=$P2_USER,PASSWORD=$LOAD_USER_PASS | jq -r .AuthenticationResult.IdToken) >> $ENV_BASIC
echo P3_TOKEN=$(aws cognito-idp initiate-auth --region $LOAD_REGION --auth-flow USER_PASSWORD_AUTH   \
--client-id $P3_CLIENTID --auth-parameters \
USERNAME=$P3_USER,PASSWORD=$LOAD_USER_PASS | jq -r .AuthenticationResult.IdToken) >> $ENV_BASIC
echo P4_TOKEN=$(aws cognito-idp initiate-auth --region $LOAD_REGION --auth-flow USER_PASSWORD_AUTH   \
--client-id $P4_CLIENTID --auth-parameters \
USERNAME=$P4_USER,PASSWORD=$LOAD_USER_PASS | jq -r .AuthenticationResult.IdToken) >> $ENV_BASIC

# Start load sim
nohup artillery run --dotenv $ENV_PLATINUM $PROFILE_PLATINUM &> $OUT_PLATINUM &
echo $! > $PID_PLATINUM
nohup artillery run --dotenv $ENV_BASIC $PROFILE_BASIC1 &> $OUT_BASIC1 &
echo $! > $PID_BASIC1
nohup artillery run --dotenv $ENV_BASIC $PROFILE_BASIC2 &> $OUT_BASIC2 &
echo $! > $PID_BASIC2
nohup artillery run --dotenv $ENV_BASIC $PROFILE_BASIC3 &> $OUT_BASIC3 &
echo $! > $PID_BASIC3
