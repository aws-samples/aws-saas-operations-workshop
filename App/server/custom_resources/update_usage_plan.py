# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import random
import time
import boto3
import logger

from crhelper import CfnResource
helper = CfnResource()

try:
    dynamodb = boto3.resource('dynamodb')
    apigateway = boto3.client('apigateway')
except Exception as e:
    helper.init_failure(e)

# Usage plans are shared by every tenant stack. Two silo tenants provisioned in the same
# pipeline run patch the same plan within the same second. API Gateway rejects the second
# write with ConflictException while the first is applied, then throttles UpdateUsagePlan
# (TooManyRequestsException) for about 20 s, longer than botocore's own retries cover.
# The write is safe to repeat, so retry with a backoff that spans several throttle windows.
MAX_ATTEMPTS = 8


def add_stage_to_usage_plan(usage_plan_id, api_id, stage):
    retryable = (apigateway.exceptions.ConflictException,
                 apigateway.exceptions.TooManyRequestsException,
                 apigateway.exceptions.LimitExceededException)
    attempt = 1
    while True:
        try:
            return apigateway.update_usage_plan(
                usagePlanId=usage_plan_id,
                patchOperations=[
                    {
                        'op': 'add',
                        'path': '/apiStages',
                        'value': api_id + ":" + stage
                    }
                ]
            )
        except retryable as e:
            if attempt >= MAX_ATTEMPTS:
                raise
            delay = min(5 * 2 ** (attempt - 1), 25) + random.uniform(0, 5)
            logger.info("%s adding %s:%s to usage plan %s (attempt %d/%d), retrying in %.1fs: %s"
                        % (type(e).__name__, api_id, stage, usage_plan_id, attempt, MAX_ATTEMPTS, delay, e))
            time.sleep(delay)
            attempt += 1


@helper.create
def do_action(event, _):
    """ Usage plans are created as part of bootstrap template.
        This method associates the usage plans for various tiers with tenant Apis

    Args:
        event ([type]): [description]
        _ ([type]): [description]
    """
    logger.info("adding api gateway stage to usage plan")
    api_id = event['ResourceProperties']['ApiGatewayId']
    settings_table_name = event['ResourceProperties']['SettingsTableName']
    is_pooled_deploy = event['ResourceProperties']['IsPooledDeploy']
    stage = event['ResourceProperties']['Stage']
    usage_plan_id_basic = event['ResourceProperties']['UsagePlanBasicTier']
    usage_plan_id_standard = event['ResourceProperties']['UsagePlanStandardTier']
    usage_plan_id_premium = event['ResourceProperties']['UsagePlanPremiumTier']
    usage_plan_id_platinum = event['ResourceProperties']['UsagePlanPlatinumTier']

    table_system_settings = dynamodb.Table(settings_table_name)

    if(is_pooled_deploy == "true"):
        for usage_plan_id in (usage_plan_id_basic, usage_plan_id_standard, usage_plan_id_premium):
            add_stage_to_usage_plan(usage_plan_id, api_id, stage)
    else:
        add_stage_to_usage_plan(usage_plan_id_platinum, api_id, stage)

@helper.update
@helper.delete
def do_nothing(_, __):
    pass

def handler(event, context):   
    helper(event, context)
        
    
