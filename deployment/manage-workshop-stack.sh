#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

## Import workshop configuration
# This contains the create_workshop( ignoreAuditingLab ) and delete_workshop() functions
FUNCTIONS=( _workshop-conf.sh _manage-workshop-stack.sh _workshop-shared-functions.sh )
for FUNCTION in "${FUNCTIONS[@]}"; do
    if [ -f $FUNCTION ]; then
        source $FUNCTION
    else
        echo "ERROR: $FUNCTION not found"
    fi
done

## Calls the create and delete operations
manage_workshop_stack() {
    STACK_OPERATION=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    if [[ "$STACK_OPERATION" == "create" || "$STACK_OPERATION" == "update" ]]; then
        create_workshop "$IGNORE_AUDITING_LAB"
    elif [ "$STACK_OPERATION" == "delete" ]; then
        delete_workshop
    else
        echo "Invalid stack operation!"
        exit 1
    fi
}

STACK_OPERATION="$1"
echo "Managing workshop for " $STACK_OPERATION "event."

for i in {1..3}; do
    echo "iteration number: $i"
    # Subshell: the functions exit on failure, and that must end the attempt, not the retry loop.
    # The steps are safe to re-run (stack deploys converge, existing tenants and users are skipped).
    if ( manage_workshop_stack "$STACK_OPERATION" ); then
        echo "successfully completed execution"
        exit 0
    else
        sleep "$((15*i))"
    fi
done

echo "failed to complete execution"
exit 1
