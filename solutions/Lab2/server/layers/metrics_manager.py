# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
from aws_lambda_powertools import Metrics
import datetime


metrics = Metrics()


def record_metric(event, metric_name, metric_unit, metric_value):
    """ Record the metric in Cloudwatch using EMF format
    Args:
        event ([type]): [description]
        metric_name ([type]): [description]
        metric_unit ([type]): [description]
        metric_value ([type]): [description]
    """
    metrics.add_dimension(name="tenantId", value=event['requestContext']['authorizer']['tenantId'])
    metrics.add_dimension(name="tenantName", value=event['requestContext']['authorizer']['tenantName'])
    metrics.add_dimension(name="tenantTier", value=event['requestContext']['authorizer']['tenantTier'])
    metrics.add_metric(name=metric_name, unit=metric_unit, value=metric_value)
    metrics_object = metrics.serialize_metric_set()
    metrics.clear_metrics()
    print(json.dumps(metrics_object))

