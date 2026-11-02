#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Helpers for tests/e2e/run.sh. Sourced, not executed.

PASSED=0
FAILED=0
RESULTS=()

log() { echo "$(date -u +%H:%M:%S) $*"; }
section() { echo; echo "=== $* ==="; }
die() { echo "FATAL: $*" >&2; exit 2; }

# check <name> <detail> <command...>. Records PASS or FAIL (detail shown on FAIL) and never aborts the run.
check() {
    local name="$1" detail="$2"; shift 2
    if "$@" >/dev/null 2>&1; then
        PASSED=$((PASSED + 1)); RESULTS+=("PASS|${name}|")
        log "PASS ${name}"
    else
        FAILED=$((FAILED + 1)); RESULTS+=("FAIL|${name}|${detail}")
        log "FAIL ${name}"
    fi
}

stack_exists() { aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }
stack_status() { aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "ABSENT"; }
stack_output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null; }
export_value() { aws cloudformation list-exports --query "Exports[?Name=='$1'].Value" --output text 2>/dev/null; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1"; }

# wait_for_stack_gone <stack> <minutes>
wait_for_stack_gone() {
    local stack="$1" minutes="$2" waited=0
    while stack_exists "${stack}"; do
        local status; status=$(stack_status "${stack}")
        [[ "${status}" == "DELETE_FAILED" ]] && return 1
        (( waited >= minutes * 60 )) && return 1
        sleep 30; waited=$((waited + 30))
    done
    return 0
}

# Everything the workshop creates that teardown must have removed. Prints one line per leftover.
list_leftovers() {
    aws cloudformation list-stacks \
        --stack-status-filter CREATE_COMPLETE CREATE_IN_PROGRESS UPDATE_COMPLETE ROLLBACK_COMPLETE ROLLBACK_FAILED DELETE_FAILED DELETE_IN_PROGRESS \
        --query 'StackSummaries[].StackName' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E '^(stack-|saas-operations-|saasOpsWorkshop-|SaaSOps)' | sed 's/^/stack: /'
    aws s3api list-buckets --query 'Buckets[].Name' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E '^(saas-operations-|sam-bootstrap-)' | sed 's/^/bucket: /'
    aws cognito-idp list-user-pools --max-results 60 --query 'UserPools[].Name' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E 'SaaSOperationsUserPool$' | sed 's/^/user pool: /'
    return 0
}

# Save CodeBuild and IDE instance logs for the artifact.
collect_logs() {
    local group="/aws/codebuild/install-workshop-stack-codebuild"
    aws logs describe-log-streams --log-group-name "${group}" --order-by LastEventTime --descending --max-items 6 \
        --query 'logStreams[].logStreamName' --output text 2>/dev/null | tr '\t' '\n' | while read -r stream; do
        [[ -n "${stream}" ]] || continue
        aws logs get-log-events --log-group-name "${group}" --log-stream-name "${stream}" --start-from-head \
            --query 'events[].message' --output text > "${E2E_ARTIFACT_DIR}/log-${stream//\//_}.txt" 2>/dev/null
    done
    return 0
}

report() {
    local md="${E2E_ARTIFACT_DIR}/report.md"
    {
        echo "## SaaS Operations workshop e2e"
        echo
        echo "Account ${ACCOUNT_ID:-?}, region ${REGION:-?}, deploy flags \`${E2E_DEPLOY_FLAGS:-}\`. **${PASSED} passed, ${FAILED} failed.**"
        echo
        echo "| Result | Check | Detail |"
        echo "|---|---|---|"
        for r in "${RESULTS[@]}"; do
            IFS='|' read -r res name detail <<<"${r}"
            echo "| ${res} | ${name} | ${detail} |"
        done
    } > "${md}"
    echo; cat "${md}"
    [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat "${md}" >> "${GITHUB_STEP_SUMMARY}"
    return 0
}
