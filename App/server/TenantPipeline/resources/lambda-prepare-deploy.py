# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import json
import zipfile
import tempfile
import traceback

print('Loading function')
s3 = boto3.client('s3')
code_pipeline = boto3.client('codepipeline')
dynamodb = boto3.resource('dynamodb')
table_tenant_stack_mapping = dynamodb.Table('SaaSOperations-TenantStackMapping')
table_tenant_details = dynamodb.Table('SaaSOperations-TenantDetails')
table_tenant_settings = dynamodb.Table('SaaSOperations-Settings')


def find_artifact(artifacts, name):
    """Finds the artifact 'name' among the 'artifacts'
    
    Args:
        artifacts: The list of artifacts available to the function
        name: The artifact we wish to use
    Returns:
        The artifact dictionary found
    Raises:
        Exception: If no matching artifact is found
    
    """
    for artifact in artifacts:
        if artifact['name'] == name:
            return artifact

    raise Exception('Input artifact named "{0}" not found in event'.format(name))

def get_template_url(s3, artifact, file_in_zip):
    """Gets the template artifact
    
    Downloads the artifact from the S3 artifact store to a temporary file
    then extracts the zip and returns the file containing the CloudFormation
    template.
    
    Args:
        artifact: The artifact to download
        file_in_zip: The path to the file within the zip containing the template
        
    Returns:
        The CloudFormation template as a string
        
    Raises:
        Exception: Any exception thrown while downloading the artifact or unzipping it
    
    """
    tmp_file = tempfile.NamedTemporaryFile()
    bucket = artifact['location']['s3Location']['bucketName']
    print(bucket)

    key = artifact['location']['s3Location']['objectKey']
    print(key)    
    with tempfile.NamedTemporaryFile() as tmp_file:
        s3.download_file(bucket, key, tmp_file.name)
        with zipfile.ZipFile(tmp_file.name, 'r') as zip:
            extracted_file = zip.extract(file_in_zip, '/tmp/')
            s3.upload_file(extracted_file, bucket, file_in_zip)
            template_url =''.join(['https://', bucket,'.s3.amazonaws.com/',file_in_zip])
            return template_url  

def put_job_success(job, message):
    """Notify CodePipeline of a successful job
    
    Args:
        job: The CodePipeline job ID
        message: A message to be logged relating to the job status
        
    Raises:
        Exception: Any exception thrown by .put_job_success_result()
    
    """
    print('Putting job success')
    print(message)
    code_pipeline.put_job_success_result(jobId=job)

def put_job_failure(job, message):
    """Notify CodePipeline of a failed job
    
    Args:
        job: The CodePipeline job ID
        message: A message to be logged relating to the job status
        
    Raises:
        Exception: Any exception thrown by .put_job_failure_result()
    
    """
    print('Putting job failure')
    print(message)
    code_pipeline.put_job_failure_result(jobId=job, failureDetails={'message': message, 'type': 'JobFailed'})

def get_user_params(job_data):
    """Decodes the JSON user parameters and validates the required properties.
    
    Args:
        job_data: The job data structure containing the UserParameters string which should be a valid JSON structure
        
    Returns:
        The JSON parameters decoded as a dictionary.
        
    Raises:
        Exception: The JSON can't be decoded or a property is missing.
        
    """
    try:
        # Get the user parameters which contain the stack, artifact and file settings
        user_parameters = job_data['actionConfiguration']['configuration']['UserParameters']
        decoded_parameters = json.loads(user_parameters)

    except Exception:
        # We're expecting the user parameters to be encoded as JSON
        # so we can pass multiple values. If the JSON can't be decoded
        # then fail the job with a helpful message.
        raise Exception('UserParameters could not be decoded as JSON')


    if 'artifact' not in decoded_parameters:
        # Validate that the artifact name is provided, otherwise fail the job
        # with a helpful message.
        raise Exception('Your UserParameters JSON must include the artifact name')

    if 'template_file' not in decoded_parameters:
        # Validate that the template file is provided, otherwise fail the job
        # with a helpful message.
        raise Exception('Your UserParameters JSON must include the template file name')

    return decoded_parameters

def get_tenant_params(tenantId):
    """Get tenant details to be supplied to Cloud formation
    Args:
        tenantId (str): tenantId for which details are needed
    Returns:
        params from tenant management table
    """
    if (tenantId != "pooled"):
        tenant_details = table_tenant_details.get_item(Key={'tenantId': tenantId})   
        userPoolId = tenant_details['Item']['userPoolId']   
        identityPoolId = tenant_details['Item']['identityPoolId']
        appClientId = tenant_details['Item']['appClientId']
    else:
        tenant_details = table_tenant_settings.get_item(Key={'settingName': 'userPoolId-pooled'})                        
        userPoolId = tenant_details['Item']['settingValue']
        tenant_details = table_tenant_settings.get_item(Key={'settingName': 'identityPoolId-pooled'})                        
        identityPoolId = tenant_details['Item']['settingValue']
        tenant_details = table_tenant_settings.get_item(Key={'settingName': 'appClientId-pooled'})                        
        appClientId = tenant_details['Item']['settingValue']

    params = []
    param_tenantid = {}
    param_tenantid['ParameterKey'] = 'TenantIdParameter'
    param_tenantid['ParameterValue'] = tenantId
    params.append(param_tenantid)

    return params

def add_parameter(params, parameter_key, parameter_value):
    parameter = {}
    parameter['ParameterKey'] = parameter_key
    parameter['ParameterValue'] = parameter_value
    params.append(parameter)

def lambda_handler(event, context):
    """The Lambda function handler
    Args:
        event: The event passed by Lambda
        context: The context passed by Lambda
        
    """
    stacks = []
    try:
        # Extract the Job ID
        job_id = event['CodePipeline.job']['id']

        # Extract the Job Data 
        job_data = event['CodePipeline.job']['data']

        # Extract the params
        params = get_user_params(job_data)
        artifact = params['artifact']
        template_file = params['template_file']
        commit_id = params['commit_id']


        # Get the list of artifacts passed to the function
        input_artifacts = job_data['inputArtifacts']
        output_artifact = job_data['outputArtifacts'][0]
        print(output_artifact)


        # Get all the stacks for each tenant to be updated/created from tenant stack mapping table
        mappings = table_tenant_stack_mapping.scan()
        print (mappings)
        print (input_artifacts)

        output_bucket = output_artifact['location']['s3Location']['bucketName']
        output_key = output_artifact['location']['s3Location']['objectKey']
        print (output_key)
        print (output_bucket)

        #Create array to pass to step function
        for mapping in mappings['Items']:
            stack = mapping['stackName']
            tenantId = mapping['tenantId']
            waveNumber = mapping['waveNumber']

            # Get the parameters to be passed to the Cloudformation from tenant table
            params = get_tenant_params(tenantId)
            # Passing parameter to enable canary deployment for lambda's
            add_parameter(params, 'LambdaCanaryDeploymentPreference', "True")

            # Get the artifact details
            artifact_data = find_artifact(input_artifacts, artifact)

            # Get the JSON template file out of the artifact
            template_url = get_template_url(s3, artifact_data, template_file)

            stacks.append(
                {
                    "stackName": stack,
                    "tenantId": tenantId,
                    "templateURL": template_url,
                    "parameters": params,
                    "commitId": commit_id,
                    "waveNumber": int(waveNumber)
                })

    except Exception as e:
        # If any other exceptions which we didn't expect are raised
        # then fail the job and log the exception message.
        print('Function failed due to exception.') 
        print(e)
        traceback.print_exc()
        put_job_failure(job_id, 'Function exception: ' + str(e))

    print (stacks)

    #write stacks variable to file
    with open('/tmp/output.json', 'w') as outfile:
        json.dump({"stacks": stacks}, outfile)

    #zip the file
    with zipfile.ZipFile('/tmp/output.json.zip', 'w') as zip:
        zip.write('/tmp/output.json', 'output.json')

    #upload the output to output_bucket in s3
    s3.upload_file('/tmp/output.json.zip', output_bucket, output_key)
    print('output.json.zip uploaded to s3')

    put_job_success(job_id, "Function complete.")
    print('Function complete.')       
    return stacks