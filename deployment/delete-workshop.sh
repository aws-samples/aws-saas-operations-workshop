#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Removes everything the workshop created. Runs in the CodeBuild project on a Delete event
# (see _manage-workshop-stack.sh) or from any shell with admin credentials.
#
# Order matters in two places only:
#   - tenant stacks import the control plane's exports, so the control plane goes after them;
#   - CloudFront distributions are disabled first, because CloudFormation can only delete a
#     distribution once the disable has propagated (~3-4 min). Disabling them at the start
#     overlaps that wait with the tenant stack deletes instead of adding it at the end.
# Everything else runs in parallel.

echo "Deleting workshop"

FUNCTIONS=( _workshop-conf.sh _workshop-shared-functions.sh _delete-workshop.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
    fi
done

DELAY=5 # poll faster than the default 15 s; deletes are short and many

TRAILS=( "saas-ops-ddb-access-trails" "saas-ops-management-trails" )
CONTROLPLANE_STACK="saas-operations-controlplane"
# Stacks that do not depend on the tenant stacks
INDEPENDENT_STACKS=( "saas-operations-pipeline" "saasOpsWorkshop-saasOperationsDashboard" "${IDE_STACK_NAME}" "saasOpsWorkshop-perTenantMetrics" )

for TRAIL in "${TRAILS[@]}"; do
    stop_cloudtrail "${TRAIL}"
done
disable_cloudfront_distributions "${IDE_STACK_NAME}" "${CONTROLPLANE_STACK}"

JOBS=()
delete_tenant_stacks &
JOBS+=("tenant-stacks:$!")
for STACK in "${INDEPENDENT_STACKS[@]}"; do
    delete_stack "${STACK}" &
    JOBS+=("${STACK}:$!")
done
delete_buckets &
JOBS+=("buckets:$!")
wait_for_jobs "${JOBS[@]}"

delete_stack "${CONTROLPLANE_STACK}"

JOBS=()
delete_log_groups &
JOBS+=("log-groups:$!")
delete_user_pools &
JOBS+=("user-pools:$!")
delete_api_keys &
JOBS+=("api-keys:$!")
wait_for_jobs "${JOBS[@]}"

echo "Workshop deleted"
