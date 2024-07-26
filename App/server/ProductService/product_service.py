# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import utils
import logger
import metrics_manager
import product_service_dal
from decimal import Decimal
from aws_lambda_powertools import Tracer
from types import SimpleNamespace
tracer = Tracer()

@tracer.capture_lambda_handler
def get_product(event, context):
    timestampStart = utils.getUTCEpoch()
    
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)
    
    logger.log_message(event, "Request received to get a product")
    params = event['pathParameters']
    logger.log_message(event, params)
    key = params['id']
    logger.log_message(event, key)
    product = product_service_dal.get_product(event, key)
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "GetProductExecutionTime", "Seconds", timestampEnd-timestampStart)    
    logger.log_message(event, "Request completed to get a product")
    metrics_manager.record_metric(event, "SingleProductRequested", "Count", 1)
    return utils.generate_response(product)
    
@tracer.capture_lambda_handler
def create_product(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_message(event, "Request received to create a product")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    product = product_service_dal.create_product(event, payload)
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "CreateProductExecutionTime", "Seconds", timestampEnd-timestampStart)    
    logger.log_message(event, "Request completed to create a product")
    metrics_manager.record_metric(event, "ProductCreated", "Count", 1)
    return utils.generate_response(product)
    
@tracer.capture_lambda_handler
def update_product(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_message(event, "Request received to update a product")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    params = event['pathParameters']
    key = params['id']
    product = product_service_dal.update_product(event, payload, key)
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "UpdateProductsExecutionTime", "Seconds", timestampEnd-timestampStart)    
    logger.log_message(event, "Request completed to update a product") 
    metrics_manager.record_metric(event, "ProductUpdated", "Count", 1)   
    return utils.generate_response(product)

@tracer.capture_lambda_handler
def delete_product(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_message(event, "Request received to delete a product")
    params = event['pathParameters']
    key = params['id']
    response = product_service_dal.delete_product(event, key)
    timestampEnd = utils.getUTCEpoch()
    logger.log_message(event, "Request completed to delete a product")
    metrics_manager.record_metric(event, "GetProductsExecutionTime", "Seconds", timestampEnd-timestampStart)    
    metrics_manager.record_metric(event, "ProductDeleted", "Count", 1)
    return utils.create_success_response("Successfully deleted the product")

@tracer.capture_lambda_handler
def get_products(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)
    
    logger.log_message(event, "Request received to get all products")
    response = product_service_dal.get_products(event, tenantId)
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "GetProductsExecutionTime", "Seconds", timestampEnd-timestampStart)    
    metrics_manager.record_metric(event, "ProductsRetrieved", "Count", len(response))
    logger.log_message(event, "Request completed to get all products")
    return utils.generate_response(response)

  