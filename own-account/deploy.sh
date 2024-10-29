#!/bin/bash

aws cloudformation create-stack --stack-name SaaSOpsV2-Vscode --template-body file://SaaSOpsV2VscodeStack.template.json --capabilities CAPABILITY_IAM
