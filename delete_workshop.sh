#!/bin/bash
# We need to delete in batches else we exceed quotas to AWS service APIs

aws_command="aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE ROLLBACK_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE"
batch_size=4
declare -a STACKS=()

function parse_output() {
  if [ ! -z "$cli_output" ]; then
    # The output parsing below also needs to be adapted as needed.
    STACKS+=($(echo $cli_output| jq '.StackSummaries[] | select(.StackName|test("^SaaSOpsV2")) | .StackName'))
    NEXT_TOKEN=$(echo $cli_output | jq -r ".NextToken")
  fi
}

cli_output=$($aws_command)
parse_output

while [ "$NEXT_TOKEN" != "null" ]; do
  if [ "$NEXT_TOKEN" == "null" ] || [ -z "$NEXT_TOKEN" ] ; then
    echo "now running: $aws_command "
    sleep 3
    cli_output=$($aws_command)
    parse_output
  else
    echo "now paginating: $aws_command --starting-token $NEXT_TOKEN"
    sleep 3
    cli_output=$($aws_command --starting-token $NEXT_TOKEN)
    parse_output
  fi
done

# Delete stacks in batches of $batch_size
for((i=0; i < ${#STACKS[@]}; i+=batch_size))
do
  part=( "${STACKS[@]:i:batch_size}" )
  echo "Deleting chunk of up to "$batch_size" stacks"
  for stack in ${part[*]}; do
    echo "Deleting stack "$(echo $stack|tr -d '"')
    aws cloudformation delete-stack --stack-name $(echo $stack|tr -d '"')
  done
  echo "Waiting for stacks to be deleted"
  for stack in ${part[*]}; do
    aws cloudformation wait stack-delete-complete --stack-name $(echo $stack|tr -d '"')
  done
done

LOG_GROUPS=$(aws logs describe-log-groups --query 'logGroups[?starts_with(logGroupName, `/aws/lambda/SaaSOpsV2`) == `true`].logGroupName' --output text)
for LOG_GROUP in $LOG_GROUPS; do
    echo "Deleting log group "$LOG_GROUP
    aws logs delete-log-group --log-group-name $LOG_GROUP
done

LOG_GROUPS=$(aws logs describe-log-groups --query 'logGroups[?starts_with(logGroupName, `SaaSOpsV2`) == `true`].logGroupName' --output text)
for LOG_GROUP in $LOG_GROUPS; do
    echo "Deleting log group "$LOG_GROUP
    aws logs delete-log-group --log-group-name $LOG_GROUP
done

LOG_GROUPS=$(aws logs describe-log-groups --query 'logGroups[?starts_with(logGroupName, `/SaaSOpsV2`) == `true`].logGroupName' --output text)
for LOG_GROUP in $LOG_GROUPS; do
    echo "Deleting log group "$LOG_GROUP
    aws logs delete-log-group --log-group-name $LOG_GROUP
done

echo "Workshop deleted"
exit 0
