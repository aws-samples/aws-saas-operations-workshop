#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## Dependencies

# sudo is needed on the IDE instance (the IDE user is not root) and absent or unneeded in CodeBuild.
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
    SUDO="sudo"
fi

# Tooling the build itself needs. Runs in CodeBuild (Amazon Linux 2023 standard:5.0 with
# nodejs 22 and python 3.9 selected in the buildspec; the image has no nodejs 20), or on any
# admin shell with node, python3 and the AWS CLI.
install_build_tools() {
    echo "Installing build tools"
    node --version
    python3 --version
    if ! command -v cdk > /dev/null; then
        retry ${SUDO} npm install --global aws-cdk
    fi
    cdk --version
    install_sam_cli
    echo "Build tools installed"
}

# Tooling the labs run from the IDE terminal. Runs on the IDE instance as the IDE user.
install_dependencies() {
    echo "Installing dependencies"
    # The Code Editor image ships git, the AWS CLI, jq, zip and unzip.
    # Everything below is what the labs need on top of that.
    echo "Installing OS packages"
    retry ${SUDO} dnf install -y zip unzip python3-pip
    echo "Installing Node.js ${NODE_MAJOR}"
    if ! command -v node > /dev/null || [[ "$(node --version | cut -d. -f1)" != "v${NODE_MAJOR}" ]]; then
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource-setup.sh
        retry ${SUDO} bash /tmp/nodesource-setup.sh
        retry ${SUDO} dnf install -y nodejs
    fi
    node --version
    echo "Enabling yarn"
    ${SUDO} corepack enable || retry ${SUDO} npm install --global yarn
    echo "yarn enabled"
    echo "Installing AWS CDK"
    retry ${SUDO} npm install --global aws-cdk
    cdk --version
    install_sam_cli
    echo "Installing isolation test packages"
    cd ${REPO_PATH}/App/isolation-test/
    retry npm install
    echo "Isolation test packages installed"
    echo "Installing artillery"
    retry ${SUDO} npm install -g artillery
    echo "Installed artillery"
    echo "Dependencies installed"
}

install_sam_cli() {
    echo "Installing AWS SAM CLI"
    if ! command -v sam > /dev/null; then
        curl -fsSL "https://github.com/aws/aws-sam-cli/releases/latest/download/aws-sam-cli-linux-$(uname -m | sed 's/aarch64/arm64/').zip" -o /tmp/aws-sam-cli.zip
        rm -rf /tmp/sam-installation
        unzip -q -d /tmp/sam-installation /tmp/aws-sam-cli.zip
        retry ${SUDO} /tmp/sam-installation/install
        rm -rf /tmp/sam-installation /tmp/aws-sam-cli.zip
    fi
    sam --version
}

# pack and push source code to S3 source code bucket
upload_source_code_to_s3() {
    echo "Uploading source code to S3"
    SOURCE_CODE_BUCKET_NAME=$(aws cloudformation describe-stacks \
        --stack-name saas-operations-pipeline \
        --query "Stacks[0].Outputs[?OutputKey=='SourceCodeBucketName'].OutputValue" \
        --output text)
    echo "Source code bucket name: ${SOURCE_CODE_BUCKET_NAME}"
    cd ${REPO_PATH}/
    zip -r source.zip . -x ".git/*" -x "**/node_modules/*" -x "**/cdk.out/*" -x "**/.aws-sam/*"
    aws s3 cp source.zip s3://${SOURCE_CODE_BUCKET_NAME}/source.zip
    rm source.zip
    echo "Source code uploaded to S3"
}

# Deploy tenant pipeline
create_tenant_pipeline() {
    echo "Deploying tenant pipeline"
    cd ${REPO_PATH}/App/server/TenantPipeline || exit 1
    retry npm install
    npm run build || exit 1
    cdk bootstrap || exit 1
    cdk deploy --require-approval never || exit 1
    echo "Tenant pipeline deployed"
}

# Create application
# parameters: (1) ignoreAuditingLab (True/False: stirng)
create_bootstrap() {
    echo "Deploying application"
    cd ${REPO_PATH}/App/server
    DEFAULT_SAM_S3_BUCKET=$(grep s3_bucket samconfig-bootstrap.toml | cut -d'=' -f2 | cut -d \" -f2)
    if ! aws s3 ls "s3://${DEFAULT_SAM_S3_BUCKET}"
    then
        echo "S3 Bucket: ${DEFAULT_SAM_S3_BUCKET} specified in samconfig-bootstrap.toml is not readable."
        echo "So creating a new S3 bucket and will update samconfig-bootstrap.toml with new bucket name."
        UUID=$(cat /proc/sys/kernel/random/uuid)
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
        sed -i "s/^s3_bucket = .*/s3_bucket = \"${SAM_S3_BUCKET}\"/" samconfig-bootstrap.toml
    fi
    echo "Create bootstrap : IGNORE_AUDITING "$1
    # Built on the host with the python3.9 selected by the CodeBuild buildspec, which matches the function runtimes.
    sam build -t bootstrap-template.yaml --region="$REGION" --parameter-overrides ParameterKey=IgnoreAuditingLab,ParameterValue="$1" || exit 1
    # --no-fail-on-empty-changeset: a retry after a failure elsewhere finds the stack already
    # up to date, and the default exit 1 on "No changes to deploy" would kill every retry.
    sam deploy --config-file samconfig-bootstrap.toml --region="$REGION" --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides IgnoreAuditingLab="$1"
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
    echo "Pipeline execution ${PIPELINE_EXECUTION_ID} started"
}

# Wait for the pipeline execution started by execute_pipeline; fail on any end state but Succeeded
wait_for_pipeline() {
    echo "Waiting for pipeline execution ${PIPELINE_EXECUTION_ID}"
    local timeout_seconds=2700 # 45 min
    local waited=0
    while true; do
        local deploymentstatus
        deploymentstatus=$(aws codepipeline get-pipeline-execution --pipeline-name saas-operations-pipeline --pipeline-execution-id ${PIPELINE_EXECUTION_ID} | jq -r '.pipelineExecution.status')
        case "${deploymentstatus}" in
            Succeeded)
                echo "Pipeline execution succeeded"
                return 0
                ;;
            InProgress|Stopping)
                ;;
            *)
                echo "Error! Pipeline execution ended with status ${deploymentstatus}"
                exit 1
                ;;
        esac
        if [[ $waited -ge $timeout_seconds ]]; then
            echo "Error! Pipeline execution did not finish within ${timeout_seconds}s"
            exit 1
        fi
        sleep 30
        waited=$((waited + 30))
    done
}

# Read the control plane outputs the UI builds and the tenant steps need
read_controlplane_outputs() {
    ADMIN_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminAppBucket'].Value" --output text)
    APP_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AppBucket'].Value" --output text)
    LANDING_APP_SITE_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-LandingAppBucket'].Value" --output text)
    ADMIN_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminAppSite'].Value" --output text)
    APP_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-ApplicationSite'].Value" --output text)
    LANDING_APP_SITE_URL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-LandingApplicationSite'].Value" --output text)
    ADMIN_APPCLIENTID=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminUserPoolClientId'].Value" --output text)
    ADMIN_USERPOOLID=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminUserPoolId'].Value" --output text)
    ADMIN_APIGATEWAYURL=$(aws cloudformation list-exports --query "Exports[?Name=='SaaS-Operations-AdminApiGatewayUrl'].Value" --output text)
    if [[ -z "${ADMIN_APIGATEWAYURL}" || -z "${ADMIN_SITE_BUCKET}" ]]; then
        echo "Error! Control plane exports not found"
        exit 1
    fi
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
    npm run build || exit 1
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
    npm run build || exit 1
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
    npm run build || exit 1
    aws s3 sync --delete --cache-control no-store dist "s3://${LANDING_APP_SITE_BUCKET}"
    if [[ $? -ne 0 ]]
    then
        echo "Error:sync $LANDING_APP_SITE_BUCKET"
        exit 1
    fi
    echo "Landing UI configured"
}

# Deploy dashboards
deploy_dashboards() {
    echo "Deploying dashboards"
    cd ${REPO_PATH}/App/server/dashboards || exit 1
    ./deploy.sh || exit 1
    echo "Dashboards deployed"
}

tenant_exists() {
    # /tenant/init/<name> is unauthenticated and returns the tenant's user pool once registered
    curl -sf "${ADMIN_APIGATEWAYURL}tenant/init/${1}" | jq -e '.userPoolId // empty' > /dev/null 2>&1
}

create_tenant() {
    ADMIN_APIGATEWAYURL=$1
    TENANT_NAME=$2
    TENANT_EMAIL=$3
    TENANT_TIER=$4
    if tenant_exists "${TENANT_NAME}"; then
        echo "Tenant ${TENANT_NAME} already exists, skipping"
        return 0
    fi
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
    REQUEST=$(curl -sf -X POST -H 'Content-type:application/json' --data "$data" "${ADMIN_APIGATEWAYURL}registration") || {
        echo "Error! Registration of ${TENANT_NAME} failed"
        exit 1
    }
    echo "Tenant ${TENANT_NAME}: $REQUEST"
}

# Registration skips tenants that already exist, so the build can be retried.
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

# Create the users of one tenant. Usernames are deterministic, so a retry recreates nothing.
# parameters: (1) tenant name (2) number of users
create_users_for_tenant() {
    local tenant=$1
    local users_count=$2
    local TENANTUSERPOOL TENANTID existing
    TENANTUSERPOOL=$(curl -sf "${ADMIN_APIGATEWAYURL}tenant/init/${tenant}" | jq -r '.userPoolId')
    if [[ -z "${TENANTUSERPOOL}" || "${TENANTUSERPOOL}" == "null" ]]; then
        echo "Error! No user pool for tenant ${tenant}"
        exit 1
    fi
    TENANTID=$(aws cognito-idp list-users --user-pool-id $TENANTUSERPOOL | jq -r --arg id "${tenant}@" '.Users[] | select(.Attributes[] | .Value | contains($id)) | .Attributes[] | select(.Name == "custom:tenantId") | .Value')
    existing=$(aws cognito-idp list-users --user-pool-id $TENANTUSERPOOL --filter "email ^= \"success+${tenant}_user_\"" --query 'length(Users)' --output text)
    if [[ "${existing}" -ge "${users_count}" ]]; then
        echo "Tenant ${tenant} already has ${existing} users, skipping"
        return 0
    fi
    for (( i=1 ; i<=${users_count} ; i++ )); do
        local username="success+${tenant}_user_${i}@simulator.amazonses.com"
        aws cognito-idp admin-create-user \
            --user-pool-id ${TENANTUSERPOOL} \
            --username "${username}" \
            --user-attributes Name=email,Value="${username}" Name=email_verified,Value=true Name=custom:tenantId,Value=${TENANTID} Name=custom:userRole,Value=TenantUser 1> /dev/null \
            || echo "User ${username} exists"
    done
    echo "Tenant ${tenant}: ${users_count} users"
}

# Different user counts per tenant so the Lab 2 dashboards show variety; fixed so runs are reproducible.
create_tenant_users() {
    echo "Creating tenant users"
    create_users_for_tenant SiloedTenant1 32 &
    local p1=$!
    create_users_for_tenant PooledTenant1 11 &
    local p2=$!
    create_users_for_tenant PooledTenant2 27 &
    local p3=$!
    create_users_for_tenant PooledTenant3 5 &
    local p4=$!
    create_users_for_tenant PooledTenant4 18 &
    local p5=$!
    wait_for_jobs "SiloedTenant1:${p1}" "PooledTenant1:${p2}" "PooledTenant2:${p3}" "PooledTenant3:${p4}" "PooledTenant4:${p5}"
    echo "Tenant users created"
}
