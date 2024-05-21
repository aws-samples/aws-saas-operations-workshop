# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import boto3
import os
import utils
import uuid
import logger
import requests
import re

region = os.environ['AWS_REGION']
create_tenant_admin_user_resource_path = os.environ['CREATE_TENANT_ADMIN_USER_RESOURCE_PATH']
create_tenant_resource_path = os.environ['CREATE_TENANT_RESOURCE_PATH']
provision_tenant_resource_path = os.environ['PROVISION_TENANT_RESOURCE_PATH']

usage_plan_platinum_tier = os.environ['USAGE_PLAN_PLATINUM_TIER']
usage_plan_premium_tier = os.environ['USAGE_PLAN_PREMIUM_TIER']
usage_plan_standard_tier = os.environ['USAGE_PLAN_STANDARD_TIER']
usage_plan_basic_tier = os.environ['USAGE_PLAN_BASIC_TIER']

lambda_client = boto3.client('lambda')
apigw_client = boto3.client('apigateway')


def register_tenant(event, context):
    logger.info(event)
    try:
        tenant_id = uuid.uuid1().hex
        tenant_details = json.loads(event['body'])
        tenant_details['dedicatedTenancy'] = 'false'
        if (tenant_details['tenantTier'].upper() == utils.TenantTier.PLATINUM.value.upper()):
            tenant_details['dedicatedTenancy'] = 'true'
        
        tenant_details['tenantId'] = tenant_id
        tenant_details['apiKey'] = __create_api_key(tenant_details['tenantTier'], tenant_id)

        logger.info(tenant_details)

        stage_name = event['requestContext']['stage']
        host = event['headers']['Host']
        auth = utils.get_auth(host, region)
        headers = utils.get_headers(event)
        create_user_response = __create_tenant_admin_user(tenant_details, headers, auth, host, stage_name)
        
        logger.info (create_user_response)
        tenant_details['userPoolId'] = create_user_response['message']['userPoolId']
        tenant_details['identityPoolId'] = create_user_response['message']['identityPoolId']
        tenant_details['appClientId'] = create_user_response['message']['appClientId']
        tenant_details['tenantAdminUserName'] = create_user_response['message']['tenantAdminUserName']

        create_tenant_response = __create_tenant(tenant_details, headers, auth, host, stage_name)
        logger.info (create_tenant_response)

        if (tenant_details['dedicatedTenancy'].upper() == 'TRUE'):
            provision_tenant_response = __provision_tenant(tenant_details, headers, auth, host, stage_name)
            logger.info(provision_tenant_response)

        
    except Exception as e:
        logger.error('Error registering a new tenant')
        raise Exception('Error registering a new tenant', e)
    else:
        return utils.create_success_response("You have been registered in our system")

def __create_tenant_admin_user(tenant_details, headers, auth, host, stage_name):
    try:
        url = ''.join(['https://', host, '/', stage_name, create_tenant_admin_user_resource_path])
        logger.info(url)
        response = requests.post(url, data=json.dumps(tenant_details), auth=auth, headers=headers) 
        response_json = response.json()
    except Exception as e:
        logger.error('Error occured while calling the create tenant admin user service')
        raise Exception('Error occured while calling the create tenant admin user service', e)
    else:
        return response_json

def __create_tenant(tenant_details, headers, auth, host, stage_name):
    try:
        url = ''.join(['https://', host, '/', stage_name, create_tenant_resource_path])
        response = requests.post(url, data=json.dumps(tenant_details), auth=auth, headers=headers) 
        response_json = response.json()
    except Exception as e:
        logger.error('Error occured while creating the tenant record in table')
        raise Exception('Error occured while creating the tenant record in table', e) 
    else:
        return response_json

def __provision_tenant(tenant_details, headers, auth, host, stage_name):
    try:
        url = ''.join(['https://', host, '/', stage_name, provision_tenant_resource_path])
        logger.info(url)
        response = requests.post(url, data=json.dumps(tenant_details), auth=auth, headers=headers) 
        response_json = response.json()['message']
    except Exception as e:
        logger.error('Error occured while provisioning the tenant')
        raise Exception('Error occured while creating the tenant record in table', e) 
    else:
        return response_json

def __create_api_key(tier, tenant_id):
    api_key = uuid.uuid1().hex
    response = apigw_client.create_api_key(
        name=tenant_id + '-saasOpsWorkshop',
        description='API Key to be used with usage plan for tenant ' + tenant_id,
        enabled=True,
        value=api_key
    )

    api_key_id = response['id']

    usage_plan = usage_plan_basic_tier
    if tier.upper() == utils.TenantTier.PLATINUM.value.upper():
        usage_plan = usage_plan_platinum_tier
    elif tier.upper() == utils.TenantTier.PREMIUM.value.upper():
        usage_plan = usage_plan_premium_tier
    elif tier.upper() == utils.TenantTier.STANDARD.value.upper():
        usage_plan = usage_plan_standard_tier

    apigw_client.create_usage_plan_key(
        usagePlanId=usage_plan,
        keyId=api_key_id,
        keyType='API_KEY'
    )

    return api_key
