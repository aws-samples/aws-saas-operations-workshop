#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Builds the SaaS application. Runs in the CodeBuild project created by WorkshopStack.yaml
# (called from _manage-workshop-stack.sh) and can also be run from any shell with admin
# credentials for a test account. Independent steps run in parallel.
#
# Usage: ./create-workshop.sh [IGNORE_AUDITING_LAB]
#   IGNORE_AUDITING_LAB  True to skip the Lab 5 auditing resources (CloudTrail data events
#                        for DynamoDB), False (default) to deploy them.

set -eo pipefail

cd "$(dirname "$0")"
IGNORE_AUDITING_LAB=${1:-False}

FUNCTIONS=( _workshop-conf.sh _workshop-shared-functions.sh _create-workshop.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
        exit 1
    fi
done

## Variables
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
export AWS_DEFAULT_REGION="$REGION"
REPO_PATH="$(cd .. && pwd)"
echo "Building the SaaS application from ${REPO_PATH} in ${REGION}"
echo "IGNORE_AUDITING_LAB=${IGNORE_AUDITING_LAB}"

## Create SaaS application
echo "Creating workshop"
install_build_tools

# The tenant pipeline (CDK) and the control plane (SAM) do not depend on each other.
{ create_tenant_pipeline && upload_source_code_to_s3; } &
PIPELINE_PID=$!
create_bootstrap "$IGNORE_AUDITING_LAB" &
BOOTSTRAP_PID=$!
wait_for_jobs "tenant-pipeline:${PIPELINE_PID}" "control-plane:${BOOTSTRAP_PID}"

# The pipeline run creates the pooled tenant stack. While it runs, the UIs and dashboards
# are built and the other stack outputs are read.
execute_pipeline
read_controlplane_outputs
wait_for_pipeline &
PIPELINE_RUN_PID=$!
deploy_dashboards &
DASHBOARDS_PID=$!
deploy_admin_ui &
ADMIN_UI_PID=$!
deploy_application_ui &
APP_UI_PID=$!
deploy_landing_ui &
LANDING_UI_PID=$!
wait_for_jobs "dashboards:${DASHBOARDS_PID}" "admin-ui:${ADMIN_UI_PID}" "application-ui:${APP_UI_PID}" "landing-ui:${LANDING_UI_PID}" "pipeline-run:${PIPELINE_RUN_PID}"

create_tenants
create_tenant_users
echo "Success - SaaS application created!"
