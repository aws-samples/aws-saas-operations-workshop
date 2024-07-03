#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Break when all background jobs are done
wait_for_background_jobs() {
    echo "Waiting for background jobs to finish"
    while true; do
        jobs_running=($(jobs -l | grep Running | awk '{print $2}'))
        if [ ${#jobs_running[@]} -eq 0 ]; then
            break
        fi
        echo "Jobs running: ${jobs_running[@]}"
        sleep $DELAY
    done
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
    # send ssm command to instance id in C9_ID
    sh_command_id=$(aws ssm send-command \
        --targets "Key=InstanceIds,Values=$C9_ID" \
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
            --instance-id "$C9_ID")
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
        if [[ $COUNT > $MAX_COUNT ]]; then
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
    C9_INSTANCE_PROFILE_NAME=$(aws ssm get-parameter \
        --name "$1" \
        --output text \
        --query "Parameter.Value")
    association_id=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$C9_ID" --query 'IamInstanceProfileAssociations[].AssociationId' --output text)
    if [ ! association_id == "" ]; then
        aws ec2 disassociate-iam-instance-profile --association-id $association_id
        command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$C9_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
        while [[ "$command_status" == "disassociating" ]]; do
            sleep $DELAY
            command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$C9_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
        done
    fi
    aws ec2 associate-iam-instance-profile --instance-id $C9_ID --iam-instance-profile Name=$C9_INSTANCE_PROFILE_NAME
    command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$C9_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
    while [[ "$command_status" == "associating" ]]; do
        sleep $DELAY
        command_status=$(aws ec2 describe-iam-instance-profile-associations --filter "Name=instance-id,Values=$C9_ID" --query 'IamInstanceProfileAssociations[].State' --output text)
    done
    echo "Instance profile replaced. Rebooting instance"
    aws ec2 reboot-instances --instance-ids "$C9_ID"
    wait_for_instance_ssm "$C9_ID"
    echo "Instance rebooted"
}

# Get Cloud9 instance ID
get_c9_id() {
    C9_ID=$(aws ec2 describe-instances \
        --filter "Name=tag:Workshop,Values=$WORKSHOP_NAME" \
        --query 'Reservations[].Instances[].{Instance:InstanceId}' \
        --output text)
}

bootstrap_cdk() {
    echo "Deploying CDK..."
    npm install --force --global aws-cdk
    cd cloud9
    npm install
    cdk bootstrap
    cd ..
}
