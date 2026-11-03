#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## Defines workshop configuration shared amongst scripts

## Variables
WORKSHOP_ID=""
WORKSHOP_NAME="SaaSOps"$WORKSHOP_ID
REPO_NAME="aws-saas-operations-workshop"
# IDE (AWS Code Editor on EC2, see code-editor/code-editor.yaml)
IDE_STACK_NAME="${WORKSHOP_NAME}-CodeEditor"
IDE_INSTANCE_NAME="${WORKSHOP_NAME}CodeEditor"
IDE_INSTANCE_TYPE="m5.xlarge"
IDE_VOLUME_SIZE="50"
TARGET_USER="participant"
NODE_MAJOR="20"
IDE_HOME_FOLDER="/home/${TARGET_USER}/environment"
# The participant instance profile name is published by WorkshopStack.yaml
PARTICIPANT_INSTANCE_PROFILE_PARAMETER_NAME="/${WORKSHOP_NAME}/IDE/ParticipantInstanceProfileName"
# File read by the CodeBuild post_build step and returned to CloudFormation as custom resource Data
OUTPUTS_FILE="/tmp/saasops-outputs.json"
DELAY=15 # Used to sleep in functions. Tweak as desired.
