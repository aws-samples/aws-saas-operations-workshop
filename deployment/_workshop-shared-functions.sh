#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Wait for named background jobs and fail if any of them failed.
# Usage: wait_for_jobs "name1:pid1" "name2:pid2" ...
# Propagates the exit status, so a failed parallel step (an Angular build, a stack
# deploy) fails the whole build instead of being ignored.
wait_for_jobs() {
    local failed=0
    local job name pid status
    for job in "$@"; do
        name="${job%%:*}"
        pid="${job##*:}"
        if wait "$pid"; then
            echo "Job '${name}' finished"
        else
            status=$?
            echo "Job '${name}' FAILED (exit ${status})"
            failed=1
        fi
    done
    if [[ $failed -ne 0 ]]; then
        echo "One or more parallel jobs failed"
        exit 1
    fi
}

# Try to run a command 3 times then timeout
retry() {
  local n=1
  local max=3
  while true; do
    "$@" && break || {
      if [[ $n -lt $max ]]; then
        ((n++))
        echo "Command failed. Attempt $n/$max:"
        sleep $DELAY;
      else
        echo "The command has failed after $n attempts."
        exit 1
      fi
    }
  done
}

# Run an SSM command on an EC2 instance
run_ssm_command() {
    SSM_COMMAND="$1"
    parameters=$(jq -n --arg cm "runuser -l \"$TARGET_USER\" -c \"$SSM_COMMAND\"" '{executionTimeout:["3600"], commands: [$cm]}')
    comment=$(echo "$SSM_COMMAND" | cut -c1-100)
    # send ssm command to the IDE instance
    sh_command_id=$(aws ssm send-command \
        --targets "Key=InstanceIds,Values=$IDE_INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters "$parameters" \
        --timeout-seconds 3600 \
        --comment "$comment" \
        --output text \
        --query "Command.CommandId")

    command_status="InProgress" # seed status var
    while [[ "$command_status" == "InProgress" || "$command_status" == "Pending" || "$command_status" == "Delayed" ]]; do
        sleep $DELAY
        command_invocation=$(aws ssm get-command-invocation \
            --command-id "$sh_command_id" \
            --instance-id "$IDE_INSTANCE_ID")
        # echo -E "$command_invocation" | jq # for debugging purposes
        command_status=$(echo -E "$command_invocation" | jq -r '.Status')
    done

    if [ "$command_status" != "Success" ]; then
        echo "failed executing $SSM_COMMAND : $command_status" && exit 1
    else
        echo "successfully completed execution!"
    fi
}

# Wait for an EC2 instance to become available and for it to be online in SSM
wait_for_instance_ssm() {
    INSTANCE_ID="$1"
    COUNT=1
    MAX_COUNT=12 # Wait for 12*15s=180s
    echo "Waiting for instance $INSTANCE_ID to become available"
    aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"
    echo "Instance $INSTANCE_ID is available"
    ssm_status=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE_ID" --query 'InstanceInformationList[].PingStatus' --output text)
    while [[ "$ssm_status" != "Online" ]]; do
        if [[ $COUNT -gt $MAX_COUNT ]]; then
            echo "Instance $INSTANCE_ID is not online in SSM for "$MAX_COUNT" attempts. Exiting."
            exit 1
        fi
        echo "Instance $INSTANCE_ID is not online in SSM yet. Waiting $DELAY seconds"
        sleep $DELAY
        ssm_status=$(aws ssm describe-instance-information --filters "Key=InstanceIds, Values=$INSTANCE_ID" --query 'InstanceInformationList[].PingStatus' --output text)
    done
    echo "Instance $INSTANCE_ID is online in SSM"
}

# Replace an instance profile on an EC2 instance
replace_instance_profile() {
    echo "Replacing instance profile"
    IDE_INSTANCE_PROFILE_NAME=$(aws ssm get-parameter \
        --name "$1" \
        --output text \
        --query "Parameter.Value")
    association_id=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$IDE_INSTANCE_ID" "Name=state,Values=associated,associating" --query 'IamInstanceProfileAssociations[0].AssociationId' --output text)
    if [[ -n "$association_id" && "$association_id" != "None" ]]; then
        aws ec2 disassociate-iam-instance-profile --association-id $association_id
        command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$IDE_INSTANCE_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
        while [[ "$command_status" == "disassociating" ]]; do
            sleep $DELAY
            command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$IDE_INSTANCE_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
        done
    fi
    aws ec2 associate-iam-instance-profile --instance-id $IDE_INSTANCE_ID --iam-instance-profile Name=$IDE_INSTANCE_PROFILE_NAME
    command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$IDE_INSTANCE_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
    while [[ "$command_status" == "associating" ]]; do
        sleep $DELAY
        command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$IDE_INSTANCE_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
    done
    echo "Instance profile replaced"
    # No reboot: IMDS serves the new role's credentials within seconds and the SSM agent
    # follows. The next SSM command verifies that the instance runs as the new role.
    wait_for_instance_role "$IDE_INSTANCE_PROFILE_NAME"
}

# Wait until commands on the IDE instance run with the role of the given instance profile
wait_for_instance_role() {
    local profile_name="$1"
    local role_name
    role_name=$(aws iam get-instance-profile --instance-profile-name "$profile_name" --query 'InstanceProfile.Roles[0].RoleName' --output text)
    local count=1
    local max_count=20 # 20*15s = 5 min
    while true; do
        local ssm_command_id
        ssm_command_id=$(aws ssm send-command \
            --targets "Key=InstanceIds,Values=$IDE_INSTANCE_ID" \
            --document-name "AWS-RunShellScript" \
            --parameters '{"commands":["aws sts get-caller-identity --query Arn --output text"]}' \
            --timeout-seconds 60 \
            --comment "check instance role" \
            --output text \
            --query "Command.CommandId" 2>/dev/null)
        local status="Pending"
        local arn=""
        while [[ "$status" == "InProgress" || "$status" == "Pending" || "$status" == "Delayed" ]]; do
            sleep 5
            local invocation
            invocation=$(aws ssm get-command-invocation --command-id "$ssm_command_id" --instance-id "$IDE_INSTANCE_ID" 2>/dev/null)
            status=$(echo -E "$invocation" | jq -r '.Status // "Failed"')
            arn=$(echo -E "$invocation" | jq -r '.StandardOutputContent // ""' | tr -d '[:space:]')
        done
        if [[ "$status" == "Success" && "$arn" == *":assumed-role/${role_name}/"* ]]; then
            echo "Instance $IDE_INSTANCE_ID runs as role ${role_name}"
            return 0
        fi
        if [[ $count -ge $max_count ]]; then
            echo "Instance $IDE_INSTANCE_ID did not switch to role ${role_name} (last: status=${status} arn=${arn}). Exiting."
            exit 1
        fi
        echo "Instance still reports '${arn}' (status ${status}); waiting for role ${role_name}"
        count=$((count + 1))
        sleep $DELAY
    done
}

# Get the IDE instance ID from the IDE stack
get_ide_instance_id() {
    IDE_INSTANCE_ID=$(aws cloudformation describe-stack-resource \
        --stack-name "$IDE_STACK_NAME" \
        --logical-resource-id CodeEditorInstance \
        --query 'StackResourceDetail.PhysicalResourceId' \
        --output text)
    if [[ -z "$IDE_INSTANCE_ID" || "$IDE_INSTANCE_ID" == "None" ]]; then
        echo "IDE instance not found in stack $IDE_STACK_NAME" && exit 1
    fi
}
