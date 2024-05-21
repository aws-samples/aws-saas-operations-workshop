# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

from datetime import datetime, timezone, timedelta

def lambda_handler(event, context):
    current_time = datetime.now(timezone.utc)
    start_time = current_time + timedelta(hours=-1)

    partition = start_time.strftime("'%Y-%m-%d'")
    start_min = start_time.strftime("'%Y-%m-%dT%H:%M:00Z'")

    response = {}
    response['partition'] = partition
    response['start'] = start_min

    return response
