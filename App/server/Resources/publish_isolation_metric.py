# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from datetime import datetime
import boto3

METRIC_NAMESPACE = "SaaSOperations"
METRIC_NAME = "PotentialIsolationBreach"

client = boto3.client('cloudwatch')

date_parser = lambda x: datetime.strptime(x, '%Y-%m-%d %H:%M:%S.%f')

def lambda_handler(event, context):

    metric_data = [
        {
            'MetricName': METRIC_NAME, 
            'Timestamp': date_parser(row['Data'][0]['VarCharValue']), 
            'Value': float(row['Data'][1]['VarCharValue']), 
            'Unit': 'Count'
        } for row in event['ResultSet']['Rows'][1:]
    ]

    if len(metric_data) > 0:
        client.put_metric_data(
            Namespace=METRIC_NAMESPACE,
            MetricData=metric_data
        )

    return {
        'statusCode': 200,
        'body': 'OK'
    }
