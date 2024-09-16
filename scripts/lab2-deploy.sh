#!/bin/bash

python3 -m pip install pylint

# default variables
solve=false

while getopts "hsc" flag; do
    case $flag in
        h) # Handle the -h flag
            echo "Deploys the changes you made for Lab2"
            echo "Optional flags:"
            echo "-h (help) Prints this help message"
            echo "-s (solve) Deploys provided solution for this lab only"
            exit
        ;;
        s) # Handle the -s flag to deploy solution
            solve=true
        ;;
        \?) # Handle invalid flag
            echo "Unknown flag. Use -h to see usages"
            exit
        ;;
    esac
done

cd  ~/environment/aws-saas-operations-workshop/solutions/Lab2/server/dashboards
cp -r . ~/environment/aws-saas-operations-workshop/App/server/dashboards
if [ $? -ne 0 ]
then
    echo "****ERROR: Copying Lab2 dashboards to App****"
    exit 1
fi
cd ~/environment/aws-saas-operations-workshop/App/server/dashboards
if [ -d ./cdk.out ]
then
    sudo rm -rf ./cdk.out
fi
./deploy.sh

# copy solution if -s flag is provided
if [ "$solve" = true ]; then
    cd  ~/environment/aws-saas-operations-workshop/solutions/Lab2/server || exit
    git reset --hard
    cp -r . ~/environment/aws-saas-operations-workshop/App/server/
    if [ $? -ne 0 ]
    then
        echo "****ERROR: Copying Lab2 solutions to App****"
        exit 1
    fi
fi

# lint layer python code
cd  ~/environment/aws-saas-operations-workshop/App/server/layers || exit
python3 -m pylint -E -d E0401 $(find . -iname "*.py")
if [[ $? -ne 0 ]]; then
    echo "****ERROR: Please fix above code errors and then rerun script!!****"
    exit 1
fi

# check in the code
cd  ~/environment/aws-saas-operations-workshop/App/server
git add -A . 
git commit -m "Lab2 changes"
cd ~/environment/aws-saas-operations-workshop
zip -r source.zip . -x ".git/*" -x "**/node_modules/*" -x "**/cdk.out/*" -x "**/.aws-sam/*"
SOURCE_CODE_BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name saas-operations-pipeline \
  --query "Stacks[0].Outputs[?OutputKey=='SourceCodeBucketName'].OutputValue" \
  --output text)
echo "Source code S3 bucket name: ${SOURCE_CODE_BUCKET_NAME}"
aws s3 cp source.zip s3://${SOURCE_CODE_BUCKET_NAME}/source.zip
rm source.zip
aws codepipeline start-pipeline-execution --name saas-operations-pipeline

# deploy operations lambda layer for shared services
cd  ~/environment/aws-saas-operations-workshop/App/server
rm -rf .aws-sam/
echo "Deploying operations lambda layer for shared services" 
echo Y | sam sync --stack-name saas-operations-controlplane \
        --template-file bootstrap-template.yaml --code \
        --resource-id LambdaFunctions/SaaSOperationsLayers -u

# deploy tenant authorizer
cd  ~/environment/aws-saas-operations-workshop/App/server
rm -rf .aws-sam/
echo "Deploying tenant authorizer" 
echo Y | sam sync --stack-name saas-operations-controlplane \
        --template-file bootstrap-template.yaml --code \
        --resource-id LambdaFunctions/BusinessServicesAuthorizerFunction -u
