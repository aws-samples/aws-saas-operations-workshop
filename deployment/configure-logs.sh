#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Ships the workshop build logs (.ws-*.log) from the IDE instance to CloudWatch Logs,
# alongside the CodeBuild log group, so the whole build can be followed in one place.
# The CloudWatch agent is installed by the Code Editor template with its default
# configuration, which runs the agent as the cwagent user. That user cannot read the
# IDE user's home directory, so the config is replaced with one that runs as root.

cd "$(dirname "$0")"
# This script is executed, not sourced, so the caller's variables are not visible here.
source _workshop-conf.sh
if [[ -z "${REPO_NAME}" ]]; then
    echo "Error! REPO_NAME is not set"
    exit 1
fi
sed -e "s#__HOME__#${HOME}#g" -e "s#__REPO_NAME__#${REPO_NAME}#g" config.json > /tmp/saasops-cw-config.json
grep file_path /tmp/saasops-cw-config.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/tmp/saasops-cw-config.json
