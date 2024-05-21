#!/bin/bash
aws cloudformation deploy --template-file launch.yaml --capabilities CAPABILITY_NAMED_IAM --stack-name "saasOpsWorkshop"$1
