#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Runs on the IDE instance as the IDE user, over SSM, while CodeBuild builds the SaaS
# application. Installs what the labs run from the IDE terminal: Node.js, AWS CDK, AWS SAM CLI,
# artillery and the isolation-test packages. Does not deploy anything.

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
# Ship this log to the CodeBuild log group so the whole build can be followed in one place.
./configure-logs.sh

install_dependencies
echo "Success - IDE ready!"
