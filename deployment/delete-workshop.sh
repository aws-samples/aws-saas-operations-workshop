#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

echo "Deleting workshop"

FUNCTIONS=( _workshop-conf.sh _workshop-shared-functions.sh _delete-workshop.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
    fi
done

TRAILS=( "saas-ops-ddb-access-trails" "saas-ops-management-trails" )
STACKS_1=()
STACKS_2=( "saas-operations-controlplane" "saas-operations-pipeline" "saasOpsWorkshop-saasOperationsDashboard" "${WORKSHOP_NAME}-C9" "saasOpsWorkshop-perTenantMetrics" )
CODECOMMIT_REPOS=( "saas-operations-workshop" )

get_c9_id
aws ec2 create-tags --resources $C9_ID --tags "Key=Workshop,Value=${WORKSHOP_NAME}Old"

for TRAIL in "${TRAILS[@]}"; do
    stop_cloudtrail "${TRAIL}"
done
delete_tenant_stacks
delete_buckets
for STACK in "${STACKS_1[@]}"; do
    delete_stack "${STACK}"
done
for STACK in "${STACKS_2[@]}"; do
    delete_stack "${STACK}" &
done
wait_for_background_jobs
for REPO in "${CODECOMMIT_REPOS[@]}"; do
    delete_codecommit_repo "${REPO}" &
done
delete_log_groups &
delete_user_pools &
delete_api_keys &
wait_for_background_jobs

echo "Workshop deleted"
