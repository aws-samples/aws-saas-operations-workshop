# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import utils
import logger
import metrics_manager
import order_service_dal
from decimal import Decimal
from types import SimpleNamespace
from aws_lambda_powertools import Tracer
tracer = Tracer()

@tracer.capture_lambda_handler
def get_order(event, context):

    timestampStart = utils.getUTCEpoch()
    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)
    logger.log_message(event, "Request received to get a order")
    params = event['pathParameters']
    key = params['id']
    logger.log_message(event, params)
    order = order_service_dal.get_order(event, key)
    logger.log_message(event, "Request completed to get a order")
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "SingleOrderRequested", "Count", 1)
    metrics_manager.record_metric(event, "GetOrderExecutionTime", "Seconds", timestampEnd-timestampStart)
    return utils.generate_response(order)
    
@tracer.capture_lambda_handler
def create_order(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_message(event, "Request received to create a order")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    order = order_service_dal.create_order(event, payload)
    logger.log_message(event, "Request completed to create a order")
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "OrderCreated", "Count", 1)
    metrics_manager.record_metric(event, "CreateOrderExecutionTime", "Seconds", timestampEnd-timestampStart)    
    return utils.generate_response(order)
    
@tracer.capture_lambda_handler
def update_order(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)
    
    logger.log_message(event, "Request received to update a order")
    payload = json.loads(event['body'], object_hook=lambda d: SimpleNamespace(**d), parse_float=Decimal)
    params = event['pathParameters']
    key = params['id']
    order = order_service_dal.update_order(event, payload, key)
    logger.log_message(event, "Request completed to update a order")
    timestampEnd = utils.getUTCEpoch() 
    metrics_manager.record_metric(event, "OrderUpdated", "Count", 1)
    metrics_manager.record_metric(event, "UpdateOrderExecutionTime", "Seconds", timestampEnd-timestampStart)    
    return utils.generate_response(order)

@tracer.capture_lambda_handler
def delete_order(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)

    logger.log_message(event, "Request received to delete a order")
    params = event['pathParameters']
    key = params['id']
    response = order_service_dal.delete_order(event, key)
    logger.log_message(event, "Request completed to delete a order")
    timestampEnd = utils.getUTCEpoch()
    metrics_manager.record_metric(event, "OrderDeleted", "Count", 1)
    metrics_manager.record_metric(event, "DeleteOrderExecutionTime", "Seconds", timestampEnd-timestampStart)    
    return utils.create_success_response("Successfully deleted the order")

@tracer.capture_lambda_handler
def get_orders(event, context):
    timestampStart = utils.getUTCEpoch()

    tenantId = event['requestContext']['authorizer']['tenantId']
    tracer.put_annotation(key="TenantId", value=tenantId)
    
    logger.log_message(event, "Request received to get all orders")
    response = order_service_dal.get_orders(event, tenantId)
    metrics_manager.record_metric(event, "OrdersRetrieved", "Count", len(response))
    timestampEnd = utils.getUTCEpoch()
    logger.log_message(event, "Request completed to get all orders")
    metrics_manager.record_metric(event, "GetOrdersExecutionTime", "Seconds", timestampEnd-timestampStart)    
    return utils.generate_response(response)

  