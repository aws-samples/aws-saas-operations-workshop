#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

REPO_URL=$1
IGNORE_AUDITING_LAB=$2

if [ -z $IGNORE_AUDITING_LAB ]; then
    IGNORE_AUDITING_LAB=false
fi

FUNCTIONS=( _workshop-conf.sh _workshop-shared-functions.sh _create-workshop.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
    fi
done

## Variables
REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
REPO_PATH="/home/ec2-user/environment/${REPO_NAME}"

## Init
rm -vf ~/.aws/credentials
cd ~/environment/$REPO_NAME/deployment && ./configure-logs.sh
cd ~/environment/$REPO_NAME/deployment/cloud9 && ./resize-cloud9-ebs-vol.sh

## Create SaaS application
echo "Creating workshop"
install_dependencies
create_tenant_pipeline 
upload_source_code_to_s3
echo "IGNORE_AUDITING_LAB=$IGNORE_AUDITING_LAB"
create_bootstrap $IGNORE_AUDITING_LAB
execute_pipeline
deploy_dashboards &
deploy_admin_ui &
deploy_application_ui &
deploy_landing_ui &
wait_for_background_jobs
create_tenants
create_tenant_users
echo "Success - Workshop created!"
