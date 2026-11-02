#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Ships the workshop build logs (.ws-*.log) from the IDE instance to CloudWatch Logs,
# alongside the CodeBuild log group, so the whole build can be followed in one place.
# The CloudWatch agent itself is installed by the Code Editor template; this appends a config.

sed "s#__HOME__#${HOME}#g" config.json > /tmp/saasops-cw-config.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a append-config -m ec2 -s -c file:/tmp/saasops-cw-config.json
