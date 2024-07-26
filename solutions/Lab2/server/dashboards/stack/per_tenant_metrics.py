from aws_cdk import (
    Stack,
    aws_cloudwatch,
    Duration
)

from constructs import Construct

class PerTenantMetricsDashboard(Stack):

    def __init__(self, scope: Construct, construct_id: str, namespace, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Initialize Dashboard
        cw_dashboard = aws_cloudwatch.Dashboard(self, construct_id,
            dashboard_name='Lab2-Per-Tenant-API-Metrics',
            default_interval=Duration.minutes(15)
        )
        cw_dashboard.add_widgets(
            self.__buildPerTenantWidget('Success count',namespace,'apiPerTenantCountSuccess'),
            self.__buildPerTenantWidget('Throttle count',namespace,'apiPerTenantCountThrottle'),
            self.__buildPerTenantWidget('Error count',namespace,'apiPerTenantCountError'),
        )
    
    def __buildPerTenantMetric(self,namespace,metric_name,tenantName):
        return aws_cloudwatch.Metric(
            metric_name = metric_name,
            namespace = namespace,
            dimensions_map = {
                'tenantName': tenantName
            },
            period=Duration.minutes(1),
            statistic='Sum'
        )
        
    def __buildPerTenantWidget(self,title,namespace,metric_name):
        return aws_cloudwatch.SingleValueWidget(
            width=24,
            height=4,
            title=title,
            metrics=[
                self.__buildPerTenantMetric(namespace,metric_name,'PooledTenant1'),
                self.__buildPerTenantMetric(namespace,metric_name,'PooledTenant2'),
                self.__buildPerTenantMetric(namespace,metric_name,'PooledTenant3'),
                self.__buildPerTenantMetric(namespace,metric_name,'SiloedTenant1')
            ],
            period=Duration.minutes(1),
            sparkline=True
        )