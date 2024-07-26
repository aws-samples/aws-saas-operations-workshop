#!/usr/bin/env python3
from aws_cdk import App
import aws_cdk as cdk

from stack.saas_operations import SaaSOperationsDashboard

app = App()
namespace='SaaSOperations'

SaaSOperationsDashboard(app, "saasOpsWorkshop-saasOperationsDashboard", namespace)

app.synth()
