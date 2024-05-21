#!/bin/bash

queues=$(aws cloudformation list-stack-resources --stack-name saas-operations-pipeline | jq -r '.StackResourceSummaries[] | select(.ResourceType == "AWS::SQS::Queue") | .PhysicalResourceId')

for q in $queues
do
    echo "About to get messages from ${q}"
    read -p "Are you sure? [y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]
    then
        messages=$(aws sqs receive-message --queue-url "${q}" | jq '.Messages')
        length=$(echo $messages | jq -r 'length')
        index=0
        while [[ $index -lt $length ]]
        do
            m=$(echo $messages | jq ".[${index}]")
            ((index++))
            handle=$(echo $m | jq -r '.ReceiptHandle')
            body=$(echo $m | jq '.Body | fromjson')
            token=$(echo $body | jq -r '.TaskToken')
            echo $body | jq '.'
            read -p "Confirm deployment wave? [y/n] " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]
            then
                aws stepfunctions send-task-success --task-token "${token}" --task-output "{\"approval_status\": \"Approved\"}"
                aws sqs delete-message --queue-url "$q" --receipt-handle "${handle}"
            fi
        done
    fi
done
