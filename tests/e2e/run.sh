#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# End-to-end deployment test for the SaaS Operations workshop. See docs/e2e-test.md.
#
# Deploys the workshop with deployment/deploy-workshop.sh exactly as a self-deployer does,
# verifies what participants touch first, tears everything down and asserts nothing is left.
# Needs: aws, curl, jq, credentials for a dedicated, otherwise empty test account.
#
# Environment:
#   E2E_DEPLOY_FLAGS   flags for deploy-workshop.sh (default "-x", required in Isengard accounts)
#   E2E_KEEP           set to 1 to skip teardown (debugging)
#   E2E_SKIP_DEPLOY    set to 1 to verify an existing deployment instead of creating one.
#                      Implies E2E_KEEP=1: the test never deletes a deployment it did not create.
#                      The tenant admin passwords of PooledTenant1 and SiloedTenant1 are reset
#                      to TENANT_PASSWORD (permanent) by the login check in either mode.
#   E2E_ARTIFACT_DIR   where logs and the report go (default ./e2e-artifacts)
#   REPO_URL, REPO_BRANCH_NAME   passed through to deploy-workshop.sh
#   DEPLOY_TIMEOUT_MIN, DELETE_TIMEOUT_MIN   defaults 75 and 40
#   SILO_TIMEOUT_MIN   how long to wait for the SiloedTenant1 stack after CREATE_COMPLETE (default 15)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
source "${HERE}/lib.sh"

E2E_DEPLOY_FLAGS="${E2E_DEPLOY_FLAGS:--x}"
E2E_KEEP="${E2E_KEEP:-0}"
E2E_SKIP_DEPLOY="${E2E_SKIP_DEPLOY:-0}"
if [[ "${E2E_SKIP_DEPLOY}" == "1" && "${E2E_KEEP}" != "1" ]]; then
    E2E_KEEP=1
    echo "E2E_SKIP_DEPLOY=1 implies E2E_KEEP=1: an existing deployment is verified, never deleted"
fi
E2E_ARTIFACT_DIR="${E2E_ARTIFACT_DIR:-${PWD}/e2e-artifacts}"
DEPLOY_TIMEOUT_MIN="${DEPLOY_TIMEOUT_MIN:-75}"
DELETE_TIMEOUT_MIN="${DELETE_TIMEOUT_MIN:-40}"
SILO_TIMEOUT_MIN="${SILO_TIMEOUT_MIN:-15}"
STACK_NAME="SaaSOps"
IDE_STACK_NAME="SaaSOps-CodeEditor"
LOG_GROUP="/aws/codebuild/install-workshop-stack-codebuild"
TENANT_PASSWORD="Lab@12345"

mkdir -p "${E2E_ARTIFACT_DIR}"
export AWS_PAGER=""

# ---------------------------------------------------------------- preflight
section "Preflight"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text) || die "no AWS credentials"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region)}}"
[[ -n "${REGION}" ]] || die "no region configured"
log "account ${ACCOUNT_ID}, region ${REGION}, deploy flags '${E2E_DEPLOY_FLAGS}'"

if [[ "${E2E_SKIP_DEPLOY}" != "1" ]]; then
    if stack_exists "${STACK_NAME}"; then
        die "stack ${STACK_NAME} already exists ($(stack_status "${STACK_NAME}")); clean the account first"
    fi
    leftovers=$(list_leftovers)
    [[ -z "${leftovers}" ]] || die "account is not clean before the test:"$'\n'"${leftovers}"
fi

# ---------------------------------------------------------------- teardown on exit
teardown() {
    local rc=$?
    trap - EXIT
    section "Teardown"
    collect_logs
    if [[ "${E2E_KEEP}" == "1" ]]; then
        log "E2E_KEEP=1, leaving the deployment in place"
    elif stack_exists "${STACK_NAME}"; then
        # A failed deploy is still rolling back here; delete-stack is rejected until it settles,
        # and a stack left in ROLLBACK_COMPLETE would fail every later run in preflight.
        if ! wait_for_stack_settled "${STACK_NAME}" "${DELETE_TIMEOUT_MIN}"; then
            log "stack ${STACK_NAME} still $(stack_status "${STACK_NAME}") after ${DELETE_TIMEOUT_MIN} min"
        fi
        if [[ "$(stack_status "${STACK_NAME}")" != "DELETE_IN_PROGRESS" ]]; then
            log "deleting ${STACK_NAME} ($(stack_status "${STACK_NAME}"))"
            aws cloudformation delete-stack --stack-name "${STACK_NAME}"
        fi
        if wait_for_stack_gone "${STACK_NAME}" "${DELETE_TIMEOUT_MIN}"; then
            check "teardown: ${STACK_NAME} deleted" "" true
        else
            check "teardown: ${STACK_NAME} deleted" "status after ${DELETE_TIMEOUT_MIN} min: $(stack_status "${STACK_NAME}")" false
        fi
        leftovers=$(list_leftovers)
        check "teardown: nothing left behind" "${leftovers}" test -z "${leftovers}"
    else
        log "stack ${STACK_NAME} not present, nothing to delete"
    fi
    redact_artifacts
    report
    [[ ${FAILED} -eq 0 && ${rc} -eq 0 ]] && exit 0 || exit 1
}
trap teardown EXIT

# ---------------------------------------------------------------- deploy
section "Deploy"
if [[ "${E2E_SKIP_DEPLOY}" == "1" ]]; then
    log "E2E_SKIP_DEPLOY=1, verifying the existing deployment"
else
    start=$(date +%s)
    # deploy-workshop.sh polls until the stack leaves CREATE_IN_PROGRESS; timeout guards a hang.
    (cd "${REPO_ROOT}/deployment" && timeout "${DEPLOY_TIMEOUT_MIN}m" ./deploy-workshop.sh ${E2E_DEPLOY_FLAGS}) \
        > "${E2E_ARTIFACT_DIR}/deploy-workshop.log" 2>&1
    log "deploy-workshop.sh finished in $(( ($(date +%s) - start) / 60 )) min"
    # deploy-workshop.sh returns on the first status that is not CREATE_IN_PROGRESS, which on
    # failure is ROLLBACK_IN_PROGRESS and on a throttled describe-stacks is an empty string.
    # Wait for a settled status ourselves before judging it.
    remaining_min=$(( DEPLOY_TIMEOUT_MIN - ($(date +%s) - start) / 60 ))
    (( remaining_min > 5 )) || remaining_min=5
    wait_for_stack_settled "${STACK_NAME}" "${remaining_min}" || log "stack ${STACK_NAME} did not settle within ${DEPLOY_TIMEOUT_MIN} min"
fi
check "stack ${STACK_NAME} CREATE_COMPLETE" "status: $(stack_status "${STACK_NAME}")" test "$(stack_status "${STACK_NAME}")" == "CREATE_COMPLETE"

# ---------------------------------------------------------------- verify IDE
section "Verify IDE"
IDE_URL=$(stack_output "${STACK_NAME}" CodeEditorUrl)
IDE_HOST=$(sed -E 's#https://([^/]+)/.*#\1#' <<<"${IDE_URL}")
check "CodeEditorUrl output present" "host: ${IDE_HOST}" test -n "${IDE_URL}" -a "${IDE_HOST##*.cloudfront.net}" == ""
health_code=$(http_code "https://${IDE_HOST}/healthz")
check "IDE /healthz returns 200" "got ${health_code}" test "${health_code}" == "200"
anon_code=$(http_code "https://${IDE_HOST}/")
check "IDE refuses access without token (403)" "got ${anon_code}" test "${anon_code}" == "403"
tok_code=$(http_code "${IDE_URL}")
check "IDE accepts the token (302/200)" "got ${tok_code}" test "${tok_code}" == "302" -o "${tok_code}" == "200"

IDE_INSTANCE_ID=$(aws cloudformation describe-stack-resource --stack-name "${IDE_STACK_NAME}" \
    --logical-resource-id CodeEditorInstance --query 'StackResourceDetail.PhysicalResourceId' --output text 2>/dev/null)
WANT_PROFILE=$(aws ssm get-parameter --name /SaaSOps/IDE/ParticipantInstanceProfileName --query Parameter.Value --output text 2>/dev/null)
HAVE_PROFILE=$(aws ec2 describe-iam-instance-profile-associations \
    --filter "Name=instance-id,Values=${IDE_INSTANCE_ID}" "Name=state,Values=associated" \
    --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text 2>/dev/null)
check "IDE instance runs with the participant profile" "have ${HAVE_PROFILE##*/}, want ${WANT_PROFILE}" test -n "${WANT_PROFILE}" -a "${HAVE_PROFILE##*/}" == "${WANT_PROFILE}"

# Two streams in the CodeBuild log group: <build-id> for the orchestration and the application
# build in CodeBuild, <instance-id> for bootstrap-ide.sh on the IDE (shipped by the CloudWatch agent).
BUILD_STREAM=$(codebuild_log_stream)
check "CodeBuild log reports the application build succeeded" "stream ${BUILD_STREAM:-?} in ${LOG_GROUP}" log_contains "${BUILD_STREAM}" "Success - Workshop created!"
check "IDE bootstrap log reached CloudWatch and reports success" "stream ${IDE_INSTANCE_ID} in ${LOG_GROUP}" log_contains "${IDE_INSTANCE_ID}" "Success - IDE ready!"

# ---------------------------------------------------------------- verify control plane
section "Verify control plane"
for name in AdminApiGatewayUrl AdminAppSite ApplicationSite LandingApplicationSite; do
    check "export SaaS-Operations-${name} present" "" test -n "$(export_value "SaaS-Operations-${name}")"
done
for name in AdminAppSite ApplicationSite LandingApplicationSite; do
    url=$(export_value "SaaS-Operations-${name}")
    site_code=$(http_code "${url}")
    check "site ${name} returns 200" "got ${site_code} from ${url}" test "${site_code}" == "200"
done
check "dashboards stack CREATE_COMPLETE" "status: $(stack_status saasOpsWorkshop-saasOperationsDashboard)" test "$(stack_status saasOpsWorkshop-saasOperationsDashboard)" == "CREATE_COMPLETE"

ADMIN_API=$(export_value SaaS-Operations-AdminApiGatewayUrl)
for tenant in PooledTenant1 PooledTenant2 PooledTenant3 PooledTenant4 BasicTestTenant1 BasicTestTenant2 SiloedTenant1 PlatinumTestTenant; do
    pool=$(curl -s "${ADMIN_API}/tenant/init/${tenant}" | jq -r '.userPoolId // empty')
    check "tenant ${tenant} registered" "" test -n "${pool}"
done

# ---------------------------------------------------------------- verify tenant login and API
section "Verify tenant access"
# Registering a Platinum tenant starts a pipeline run (~5 min) that creates its silo stack, and
# that run usually finishes after SaaSOps reports CREATE_COMPLETE. Wait for the silo API.
wait_for_tenant_api() {
    local tenant="$1" minutes="$2" waited=0 api
    while true; do
        api=$(curl -s "${ADMIN_API}/tenant/init/${tenant}" | jq -r '.apiGatewayUrl // empty')
        [[ -n "${api}" ]] && return 0
        (( waited >= minutes * 60 )) && return 1
        sleep 30; waited=$((waited + 30))
    done
}
for tenant in SiloedTenant1 PlatinumTestTenant; do
    if ! wait_for_tenant_api "${tenant}" "${SILO_TIMEOUT_MIN}"; then
        log "${tenant} API not published after ${SILO_TIMEOUT_MIN} min"
    fi
done
# Both Platinum tenants get a silo stack from the same pipeline run. A stack that rolled back
# still leaves the other tenant working, so look at the stacks, not only at SiloedTenant1.
tenant_stacks=$(aws cloudformation list-stacks --query 'StackSummaries[?starts_with(StackName,`stack-`) && StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output text | sort)
check "tenant stacks: stack-pooled and two silo stacks CREATE_COMPLETE" "$(tr '\n\t' ';=' <<<"${tenant_stacks}")" \
    test "$(wc -l <<<"${tenant_stacks}")" -eq 3 -a "$(grep -c -v 'CREATE_COMPLETE$' <<<"${tenant_stacks}")" -eq 0
for tenant in PooledTenant1 SiloedTenant1; do
    meta=$(curl -s "${ADMIN_API}/tenant/init/${tenant}")
    pool=$(jq -r '.userPoolId // empty' <<<"${meta}")
    client=$(jq -r '.appClientId // empty' <<<"${meta}")
    api=$(jq -r '.apiGatewayUrl // empty' <<<"${meta}")
    check "${tenant}: init returns pool, client and API" "" test -n "${pool}" -a -n "${client}" -a -n "${api}"
    user=$(aws cognito-idp list-users --user-pool-id "${pool}" \
        --filter "email = \"success+${tenant}@simulator.amazonses.com\"" --query 'Users[0].Username' --output text 2>/dev/null)
    check "${tenant}: admin user exists" "pool ${pool}" test -n "${user}" -a "${user}" != "None"
    aws cognito-idp admin-set-user-password --user-pool-id "${pool}" --username "${user}" --password "${TENANT_PASSWORD}" --permanent >/dev/null 2>&1
    token=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id "${client}" \
        --auth-parameters "USERNAME=${user},PASSWORD=${TENANT_PASSWORD}" --query AuthenticationResult.IdToken --output text 2>/dev/null)
    check "${tenant}: login returns a token" "" test -n "${token}" -a "${token}" != "None"
    for path in products orders; do
        code=$(curl -s -o "${E2E_ARTIFACT_DIR}/${tenant}-${path}.json" -w '%{http_code}' -H "Authorization: Bearer ${token}" "${api}/${path}")
        is_array=$(jq -r 'type == "array"' "${E2E_ARTIFACT_DIR}/${tenant}-${path}.json" 2>/dev/null)
        check "${tenant}: GET /${path} returns 200 with a JSON array" "got ${code}, array=${is_array}" test "${code}" == "200" -a "${is_array}" == "true"
    done
done

# teardown() runs from the EXIT trap and sets the exit code
