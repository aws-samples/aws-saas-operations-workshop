#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Deploy the IDE (AWS Code Editor on EC2 behind CloudFront)
create_ide() {
    # The Code Editor template is larger than the 51,200 byte inline limit, so it is uploaded to S3 first.
    # The bucket name starts with "saas-operations-" so delete_buckets removes it on teardown.
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
    TEMPLATE_BUCKET="saas-operations-templates-${ACCOUNT_ID}-${REGION}"
    if ! aws s3api head-bucket --bucket "${TEMPLATE_BUCKET}" 2>/dev/null; then
        echo "Creating template bucket ${TEMPLATE_BUCKET}"
        if [[ "${REGION}" == "us-east-1" ]]; then
            aws s3api create-bucket --bucket "${TEMPLATE_BUCKET}"
        else
            aws s3api create-bucket --bucket "${TEMPLATE_BUCKET}" --create-bucket-configuration LocationConstraint="${REGION}"
        fi
        aws s3api put-public-access-block --bucket "${TEMPLATE_BUCKET}" \
            --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
        aws s3api put-bucket-encryption --bucket "${TEMPLATE_BUCKET}" \
            --server-side-encryption-configuration '{"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}'
    fi

    # A stack left in ROLLBACK_COMPLETE by an earlier attempt cannot be updated, so remove it first.
    IDE_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "${IDE_STACK_NAME}" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)
    if [[ "${IDE_STACK_STATUS}" == ROLLBACK_* ]]; then
        echo "IDE stack ${IDE_STACK_NAME} is in ${IDE_STACK_STATUS}, deleting it before redeploying"
        aws cloudformation delete-stack --stack-name "${IDE_STACK_NAME}"
        aws cloudformation wait stack-delete-complete --stack-name "${IDE_STACK_NAME}" || exit 1
    fi

    echo "Deploying IDE stack ${IDE_STACK_NAME}..."
    aws cloudformation deploy \
        --stack-name "${IDE_STACK_NAME}" \
        --template-file code-editor/code-editor.yaml \
        --s3-bucket "${TEMPLATE_BUCKET}" \
        --s3-prefix templates \
        --capabilities CAPABILITY_IAM \
        --no-fail-on-empty-changeset \
        --parameter-overrides \
            CodeEditorUser="${TARGET_USER}" \
            InstanceName="${IDE_INSTANCE_NAME}" \
            InstanceType="${IDE_INSTANCE_TYPE}" \
            InstanceVolumeSize="${IDE_VOLUME_SIZE}" \
            HomeFolder="${IDE_HOME_FOLDER}" || { echo "IDE stack ${IDE_STACK_NAME} failed to deploy"; exit 1; }
    echo "IDE stack deployed"

    get_ide_instance_id
    echo "Waiting for ${IDE_INSTANCE_ID}"
    wait_for_instance_ssm "${IDE_INSTANCE_ID}"

    IDE_URL=$(aws cloudformation describe-stacks \
        --stack-name "${IDE_STACK_NAME}" \
        --query "Stacks[0].Outputs[?OutputKey=='URL'].OutputValue" \
        --output text)
    jq -n --arg url "${IDE_URL}" '{CodeEditorUrl: $url}' > "${OUTPUTS_FILE}"
    echo "IDE URL recorded in ${OUTPUTS_FILE}"
}

# Create the IDE and prepare it for the participant: participant role, repository clone,
# lab tooling (bootstrap-ide.sh). Runs in parallel with the application build.
prepare_ide() {
    create_ide
    replace_instance_profile "${PARTICIPANT_INSTANCE_PROFILE_PARAMETER_NAME}"
    run_ssm_command "cd ${IDE_HOME_FOLDER} ; git clone --branch ${REPO_BRANCH_NAME} ${REPO_URL} || echo 'Repo already exists.'"
    # pipefail: a failure inside bootstrap-ide.sh must fail the SSM command, not be hidden by tee
    run_ssm_command "set -o pipefail; cd ${IDE_HOME_FOLDER}/${REPO_NAME}/deployment && ./bootstrap-ide.sh 2>&1 | tee .ws-bootstrap.log"
}

# parameters: (1) ignoreAuditingWorkshop (True/False: string)
create_workshop() {
    # The IDE (CloudFront, SSM bootstrap, lab tooling) and the SaaS application are
    # independent, so they are built side by side: the IDE in the background, the
    # application here in CodeBuild with the CodeBuild service role.
    prepare_ide > >(sed -u 's/^/[ide] /') 2>&1 &
    local ide_pid=$!

    ./create-workshop.sh "${1}" > >(sed -u 's/^/[app] /') 2>&1 &
    local app_pid=$!

    wait_for_jobs "ide:${ide_pid}" "app:${app_pid}"
    echo "Success - Workshop created!"
}

delete_workshop() {
    ./delete-workshop.sh
}
