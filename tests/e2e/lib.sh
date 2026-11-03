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
    detail="${detail//$'\n'/; }" # the report is one table row per check
    if "$@" >/dev/null 2>&1; then
        PASSED=$((PASSED + 1)); RESULTS+=("PASS|${name}|")
        log "PASS ${name}"
    else
        FAILED=$((FAILED + 1)); RESULTS+=("FAIL|${name}|${detail}")
        log "FAIL ${name}: ${detail}"
    fi
}

stack_exists() { aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }
stack_status() { aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "ABSENT"; }
stack_output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null; }
export_value() { aws cloudformation list-exports --query "Exports[?Name=='$1'].Value" --output text 2>/dev/null; }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1"; }

# wait_for_stack_settled <stack> <minutes>: poll until the status no longer ends in _IN_PROGRESS
# (or the stack is gone). Returns 1 on timeout. CloudFormation rejects delete-stack while a
# rollback is in progress, so teardown needs this as much as the deploy step does.
wait_for_stack_settled() {
    local stack="$1" minutes="$2" waited=0 status
    while true; do
        status=$(stack_status "${stack}")
        [[ "${status}" == *_IN_PROGRESS ]] || return 0
        (( waited >= minutes * 60 )) && return 1
        sleep 30; waited=$((waited + 30))
    done
}

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

# Everything the workshop owns that teardown must have removed. Prints one line per leftover.
# aws-sam-cli-managed-default (stack and bucket) is created by `sam sync` in Lab 2 and removed by
# delete-workshop.sh; the test never runs Lab 2, so it only shows up when the account was dirty.
# Not listed, because delete-workshop.sh does not own them: the CDK bootstrap (CDKToolkit stack,
# cdk-hnb659fds-* bucket and ECR repository) and the CodeBuild and Lambda log groups.
list_leftovers() {
    aws cloudformation list-stacks \
        --stack-status-filter CREATE_IN_PROGRESS CREATE_FAILED CREATE_COMPLETE \
            ROLLBACK_IN_PROGRESS ROLLBACK_FAILED ROLLBACK_COMPLETE \
            DELETE_IN_PROGRESS DELETE_FAILED \
            UPDATE_IN_PROGRESS UPDATE_COMPLETE_CLEANUP_IN_PROGRESS UPDATE_COMPLETE UPDATE_FAILED \
            UPDATE_ROLLBACK_IN_PROGRESS UPDATE_ROLLBACK_FAILED UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE \
            REVIEW_IN_PROGRESS IMPORT_IN_PROGRESS IMPORT_COMPLETE IMPORT_ROLLBACK_IN_PROGRESS IMPORT_ROLLBACK_FAILED IMPORT_ROLLBACK_COMPLETE \
        --query 'StackSummaries[].StackName' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E '^(stack-|saas-operations-|saasOpsWorkshop-|SaaSOps|aws-sam-cli-managed-default$)' | sed 's/^/stack: /'
    aws s3api list-buckets --query 'Buckets[].Name' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E '^(saas-operations-|sam-bootstrap-|aws-sam-cli-managed-default-)' | sed 's/^/bucket: /'
    aws cognito-idp list-user-pools --max-results 60 --query 'UserPools[].Name' --output text 2>/dev/null | tr '\t' '\n' \
        | grep -E 'SaaSOperationsUserPool$' | sed 's/^/user pool: /'
    return 0
}

# Log stream of the most recent build of the workshop CodeBuild project.
codebuild_log_stream() {
    local build_id
    build_id=$(aws codebuild list-builds-for-project --project-name install-workshop-stack-codebuild \
        --sort-order DESCENDING --max-items 1 --query 'ids[0]' --output text 2>/dev/null)
    [[ -n "${build_id}" && "${build_id}" != "None" ]] || return 1
    aws codebuild batch-get-builds --ids "${build_id}" --query 'builds[0].logs.streamName' --output text 2>/dev/null
}

# log_contains <stream> <text>: true when the stream in the CodeBuild log group has a line with
# the text. filter-log-events searches server-side and pages, so long builds are no problem.
log_contains() {
    local stream="$1" text="$2" matches
    matches=$(aws logs filter-log-events --log-group-name "${LOG_GROUP}" --log-stream-names "${stream}" \
        --filter-pattern "\"${text}\"" --query 'length(events)' --output text 2>/dev/null)
    [[ -n "${matches}" && "${matches}" != "0" && "${matches}" != "None" ]]
}

# Save CodeBuild and IDE instance logs for the artifact. filter-log-events pages, get-log-events
# would stop after 10,000 events or 1 MB.
collect_logs() {
    aws logs describe-log-streams --log-group-name "${LOG_GROUP}" --order-by LastEventTime --descending --max-items 6 \
        --query 'logStreams[].logStreamName' --output text 2>/dev/null | tr '\t' '\n' | while read -r stream; do
        [[ -n "${stream}" ]] || continue
        aws logs filter-log-events --log-group-name "${LOG_GROUP}" --log-stream-names "${stream}" \
            --query 'events[].message' --output json 2>/dev/null | jq -r '.[]' > "${E2E_ARTIFACT_DIR}/log-${stream//\//_}.txt"
    done
    return 0
}

# The IDE URL carries the login token as tkn=<password>. deploy-workshop.sh prints the URL and
# older builds echoed it into the CodeBuild log; neither may leave the runner.
redact_artifacts() {
    local f
    for f in "${E2E_ARTIFACT_DIR}"/*; do
        [[ -f "${f}" ]] && sed -i -E 's/tkn=[^&" \\]+/tkn=REDACTED/g' "${f}"
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
    return 0
}
