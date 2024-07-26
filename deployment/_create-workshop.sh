#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## Dependencies
install_dependencies() {
    echo "Installing dependencies"
    echo "Enabling yarn"
    corepack enable || retry npm install --global yarn
    echo "yarn enabled"
    echo "Installing isolation test packages"
    cd ${REPO_PATH}/App/isolation-test/
    retry npm install
    echo "Isolation test packages installed"
    echo "Installing artillery"
    retry npm install -g artillery
    echo "Installed artillery"
    echo "Dependencies installed"
}

# Create CodeCommit repository
create_codecommit() {
    echo "Creating CodeCommit repository"
    cd ${REPO_PATH}
    git init -b main
    git config --global --add safe.directory ${REPO_PATH}
    git add -A
    git commit -m "Base code"
    if ! aws codecommit get-repository --repository-name ${REPO_NAME}
    then
        echo "${REPO_NAME} codecommit repo is not present, will create one now"
        CREATE_REPO=$(aws codecommit create-repository --repository-name ${REPO_NAME} --repository-description "${REPO_DESCRIPTION}")
        echo "${CREATE_REPO}"
    fi
    if ! git remote add cc "${CC_REPO_URL}"
    then
        echo "Setting url to remote cc"
        git remote set-url cc "${CC_REPO_URL}"
    fi
    git push cc "$(git branch --show-current)":main
    echo "CodeCommit repository created"
}

# Deploy tenant pipeline
create_tenant_pipeline() {
    echo "Deploying tenant pipeline"
    cd ${REPO_PATH}/App/server/TenantPipeline || exit 
    retry npm install
    npm run build
    cdk bootstrap
    cdk deploy --require-approval never
    echo "Tenant pipeline deployed"
}

# Create application
create_bootstrap() {
    echo "Deploying application"
    cd ${REPO_PATH}/App/server
    DEFAULT_SAM_S3_BUCKET=$(grep s3_bucket samconfig-bootstrap.toml | cut -d'=' -f2 | cut -d \" -f2)
    if ! aws s3 ls "s3://${DEFAULT_SAM_S3_BUCKET}"
    then
        echo "S3 Bucket: ${DEFAULT_SAM_S3_BUCKET} specified in samconfig-bootstrap.toml is not readable."
        echo "So creating a new S3 bucket and will update samconfig-bootstrap.toml with new bucket name."
        UUID=$(uuidgen | awk '{print tolower($0)}')
        SAM_S3_BUCKET=sam-bootstrap-bucket-${UUID}
        aws s3 mb "s3://${SAM_S3_BUCKET}" --region "${REGION}"
        aws s3api put-bucket-encryption \
            --bucket "${SAM_S3_BUCKET}" \
            --server-side-encryption-configuration '{"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}'
        if [[ $? -ne 0 ]]
        then
            echo "bootstrap bucket deployment failed"
            exit 1
        fi
        # Update samconfig-bootstrap.toml with new bucket name
        ex -sc '%s/s3_bucket = .*/s3_bucket = \"'"${SAM_S3_BUCKET}"'\"/|x' samconfig-bootstrap.toml
    fi
    sam build -t bootstrap-template.yaml --use-container --region="$REGION"
    sam deploy --config-file samconfig-bootstrap.toml --region="$REGION" --no-confirm-changeset
    if [[ $? -ne 0 ]]
    then
        echo "Error! bootstrap-template.yaml deploy failed"
        exit 1
    fi
    echo "Application deployed"
}

execute_pipeline() {
    # Start CI/CD pipeline which loads tenant stack
    echo "Starting CI/CD pipeline"
    PIPELINE_EXECUTION_ID=$(aws codepipeline start-pipeline-execution --name saas-operations-pipeline | jq -r '.pipelineExecutionId')
    ADMIN_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminAppBucket'].Value" --output text)
    APP_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AppBucket'].Value" --output text)
    LANDING_APP_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-LandingAppBucket'].Value" --output text)
    ADMIN_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminAppSite'].Value" --output text)
    APP_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-ApplicationSite'].Value" --output text)
    LANDING_APP_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-LandingApplicationSite'].Value" --output text)
    ADMIN_APPCLIENTID=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminUserPoolClientId'].Value" --output text)
    ADMIN_USERPOOLID=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminUserPoolId'].Value" --output text)
    ADMIN_APIGATEWAYURL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminApiGatewayUrl'].Value" --output text)
    echo "Finished CI/CD pipeline"
}

# Configuring admin UI
deploy_admin_ui() {
    echo "Configuring admin UI"
    if ! aws s3 ls "s3://${ADMIN_SITE_BUCKET}"
    then
        echo "Error! S3 Bucket: ${ADMIN_SITE_BUCKET} not readable"
        exit 1
    fi
    cd ${REPO_PATH}/App/clients/Admin
    cat <<EoF >./src/environments/environment.prod.ts
export const environment = {
    production: true,
    apiUrl: '${ADMIN_APIGATEWAYURL}',
};
EoF
    cat <<EoF >./src/environments/environment.ts
export const environment = {
    production: false,
    apiUrl: '${ADMIN_APIGATEWAYURL}',
};
EoF
    cat <<EoF >./src/aws-exports.ts
const awsmobile = {
    "aws_project_region": "${REGION}",
    "aws_cognito_region": "${REGION}",
    "aws_user_pools_id": "${ADMIN_USERPOOLID}",
    "aws_user_pools_web_client_id": "${ADMIN_APPCLIENTID}",
};
export default awsmobile;
EoF
    retry npm install
    npm run build
    aws s3 sync --delete --cache-control no-store dist "s3://${ADMIN_SITE_BUCKET}"
    if [[ $? -ne 0 ]]
    then
        echo "Error:sync ${ADMIN_SITE_BUCKET}"
        exit 1
    fi
    echo "Admin UI configured"
}

# Configuring application UI
deploy_application_ui() {
    echo "Configuring application UI"
    if ! aws s3 ls "s3://${APP_SITE_BUCKET}"
    then
        echo "Error! S3 Bucket: ${APP_SITE_BUCKET} not readable"
        exit 1
    fi  
    cd ${REPO_PATH}/App/clients/Application
    cat <<EoF >./src/environments/environment.prod.ts
export const environment = {
    production: true,
    regApiGatewayUrl: '${ADMIN_APIGATEWAYURL}',
};
EoF
    cat <<EoF >./src/environments/environment.ts
export const environment = {
    production: true,
    regApiGatewayUrl: '${ADMIN_APIGATEWAYURL}',
};
EoF
    retry npm install
    npm run build
    aws s3 sync --delete --cache-control no-store dist "s3://${APP_SITE_BUCKET}"
    if [[ $? -ne 0 ]]
    then
        echo "Error:sync ${APP_SITE_BUCKET}"
        exit 1
    fi
    echo "Application UI configured"
}

# Configuring landing UI
deploy_landing_ui() {
    echo "Configuring landing UI"
    if ! aws s3 ls "s3://${LANDING_APP_SITE_BUCKET}"
    then
        echo "Error! S3 Bucket: ${LANDING_APP_SITE_BUCKET} not readable"
        exit 1
    fi
    cd ${REPO_PATH}/App/clients/Landing
    cat <<EoF >./src/environments/environment.prod.ts
export const environment = {
    production: true,
    apiGatewayUrl: '${ADMIN_APIGATEWAYURL}'
};
EoF
    cat <<EoF >./src/environments/environment.ts
export const environment = {
    production: false,
    apiGatewayUrl: '${ADMIN_APIGATEWAYURL}'
};
EoF
    retry npm install
    npm run build
    aws s3 sync --delete --cache-control no-store dist "s3://${LANDING_APP_SITE_BUCKET}"
    if [[ $? -ne 0 ]]
    then
        echo "Error:sync $LANDING_APP_SITE_BUCKET"
        exit 1
    fi
    while true; do
        deploymentstatus=$(aws codepipeline get-pipeline-execution --pipeline-name saas-operations-pipeline --pipeline-execution-id ${PIPELINE_EXECUTION_ID} | jq -r '.pipelineExecution.status')
        if [[ "${deploymentstatus}" == "Succeeded" ]]; then
            break
        fi
        echo "Waiting for pipeline execution"
        sleep 30
    done
    echo "Landing UI configured"
}

# Deploy dashboards
deploy_dashboards() {
    echo "Deploying dashboards"
    cd ${REPO_PATH}/App/server/dashboards
    ./deploy.sh
    echo "Dashboards deployed"
}

create_tenant() {
    ADMIN_APIGATEWAYURL=$1
    TENANT_NAME=$2
    TENANT_EMAIL=$3
    TENANT_TIER=$4
    data=$(cat <<EOF
{
    "tenantName": "${TENANT_NAME}",
    "tenantEmail": "${TENANT_EMAIL}",
    "tenantTier": "${TENANT_TIER}",
    "tenantPhone": null,
    "tenantAddress": null
}
EOF
    )
    REQUEST=$(curl -X POST -H 'Content-type:application/json' --data "$data" "${ADMIN_APIGATEWAYURL}registration")
    echo $REQUEST
}

create_tenants() {
    echo "Creating tenants"
    basicTenants=("PooledTenant1" "PooledTenant2" "PooledTenant3" "PooledTenant4" "BasicTestTenant1" "BasicTestTenant2")
    for i in "${basicTenants[@]}"
    do
        create_tenant $ADMIN_APIGATEWAYURL $i "success+$i@simulator.amazonses.com" Basic
    done

    platinumTenants=("SiloedTenant1" "PlatinumTestTenant")
    for i in "${platinumTenants[@]}"
    do
        create_tenant $ADMIN_APIGATEWAYURL $i "success+$i@simulator.amazonses.com" Platinum
    done
    echo "Tenants created"
}

create_tenant_users() {
    echo "Creating tenant users"
    TENANTS=("SiloedTenant1" "PooledTenant1" "PooledTenant2" "PooledTenant3" "PooledTenant4")
    for tenant in ${TENANTS[@]}; do
        TENANTUSERPOOL=$(curl "${ADMIN_APIGATEWAYURL}/tenant/init/${tenant}" | jq -r '.userPoolId')
        TENANTID=$(aws cognito-idp list-users --user-pool-id $TENANTUSERPOOL | jq -r --arg id "${tenant}@" '.Users[] | select(.Attributes[] | .Value | contains($id)) | .Attributes[] | select(.Name == "custom:tenantId") | .Value')

        USERSCOUNT=$((1 + $RANDOM % 50))
        for (( i=1 ; i<=${USERSCOUNT} ; i++ )); 
            do
            USERPREFIX=$(date +%s)
            aws cognito-idp admin-create-user \
                --user-pool-id ${TENANTUSERPOOL} \
                --username success+${tenant}_user_${USERPREFIX}@simulator.amazonses.com  \
                --user-attributes Name=email,Value=success+${tenant}_user_${USERPREFIX}@simulator.amazonses.com Name=email_verified,Value=true Name=custom:tenantId,Value=${TENANTID} Name=custom:userRole,Value=TenantUser 1> /dev/null 

            sleep 1
        done
    done
    echo "Tenant users created"
}
