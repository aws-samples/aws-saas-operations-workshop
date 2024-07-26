#!/usr/bin/env python3
from aws_cdk import App
import aws_cdk as cdk

from stack.per_tenant_metrics import PerTenantMetricsDashboard
from stack.saas_operations import SaaSOperationsDashboard

app = App()
namespace='SaaSOperations'

PerTenantMetricsDashboard(app, "saasOpsWorkshop-perTenantMetrics", namespace)
SaaSOperationsDashboard(app, "saasOpsWorkshop-saasOperationsDashboard", namespace)

app.synth()
