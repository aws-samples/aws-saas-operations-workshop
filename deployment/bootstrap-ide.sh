#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Runs on the IDE instance as the IDE user, over SSM, while CodeBuild builds the SaaS
# application. Installs what the labs run from the IDE terminal: Node.js, AWS CDK, AWS SAM CLI,
# artillery, the isolation-test packages, the compiled tenant pipeline CDK app and a
# samconfig-bootstrap.toml pointing at this account's SAM bucket. Does not deploy anything.

set -eo pipefail

cd "$(dirname "$0")"
FUNCTIONS=( _workshop-conf.sh _workshop-shared-functions.sh _create-workshop.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
        exit 1
    fi
done

REPO_PATH="$(cd .. && pwd)"

echo "Bootstrapping IDE for ${USER} in ${REPO_PATH}"
# The participant works with the instance role; never with static keys.
rm -vf ~/.aws/credentials
# Lab scripts read the region with `aws configure get region`, which only looks at
# ~/.aws/config (Cloud9 used to write it; the Code Editor image only exports AWS_REGION).
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
if [[ -z "${REGION}" ]]; then
    IMDS_TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
    REGION=$(curl -sS -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" "http://169.254.169.254/latest/meta-data/placement/region")
fi
[[ -n "${REGION}" ]] || { echo "ERROR: could not determine the region"; exit 1; }
aws configure set region "${REGION}"
echo "AWS CLI default region set to $(aws configure get region)"
# Ship this log to the CodeBuild log group so the whole build can be followed in one place.
./configure-logs.sh

install_dependencies
echo "Success - IDE ready!"
