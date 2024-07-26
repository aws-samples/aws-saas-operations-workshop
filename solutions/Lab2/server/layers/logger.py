# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from aws_lambda_powertools import Logger
logger = Logger()

"""Log info messages
"""
def info(log_message):  
    logger.info (log_message)

"""Log error messages
"""
def error(log_message):
    logger.error (log_message)


def log_message(event, log_message):
    logger.structure_logs(append=True, tenantId=event['requestContext']['authorizer']['tenantId'], tenantName=event['requestContext']['authorizer']['tenantName'], tenantTier=event['requestContext']['authorizer']['tenantTier'])
    logger.info (log_message)
