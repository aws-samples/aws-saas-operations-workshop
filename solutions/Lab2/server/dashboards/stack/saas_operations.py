from aws_cdk import (
    Stack,
    aws_cloudwatch,
    Duration
)

from constructs import Construct

class SaaSOperationsDashboard(Stack):

    def __init__(self, scope: Construct, construct_id: str, namespace, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Initialize Dashboard
        cw_dashboard = aws_cloudwatch.Dashboard(self, construct_id,
            dashboard_name='Lab1-SaaS-Operations',
            default_interval=Duration.minutes(15)
        )
        cw_dashboard.add_widgets(
            aws_cloudwatch.SingleValueWidget(
                width=24,
                height=4,
                title='API metrics',
                metrics=[
                    self.__buildMetric(namespace,'apiCountSuccess','Success count'),
                    self.__buildMetric(namespace,'apiCountThrottle', 'Throttle count'),
                    self.__buildMetric(namespace,'apiCountError', 'Error count'),
                    self.__buildMetric(namespace,'apiLatency','Latency','Average')
                ],
                period=Duration.minutes(1),
                sparkline=True
            )
        )
        cw_dashboard.add_widgets(
            aws_cloudwatch.SingleValueWidget(
                width=24,
                height=4,
                title='Lambda metrics',
                metrics=[
                    self.__buildMetric('AWS/Lambda','ConcurrentExecutions','Concurrent executions','Average'),
                    self.__buildMetric('AWS/Lambda','Duration', 'Duration','Average'),
                    self.__buildMetric('AWS/Lambda','Throttles', 'Throttles'),
                    self.__buildMetric('AWS/Lambda','Errors','Errors')
                ],
                period=Duration.minutes(1),
                sparkline=True
            )
        )
        cw_dashboard.add_widgets(
            aws_cloudwatch.SingleValueWidget(
                width=24,
                height=4,
                title='Service usage',
                metrics=[
                    self.__buildServiceMetric(namespace,'apiResourcePath','/orders','GetOrders'),
                    self.__buildServiceMetric(namespace,'apiResourcePath','/order', 'CreateOrder'),
                    self.__buildServiceMetric(namespace,'apiResourcePath','/order/{id}', 'DeleteOrder'),
                    self.__buildServiceMetric(namespace,'apiResourcePath','/products','GetProducts'),
                    self.__buildServiceMetric(namespace,'apiResourcePath','/product', 'CreateProduct'),
                    self.__buildServiceMetric(namespace,'apiResourcePath','/product/{id}', 'DeleteProduct')
                ],
                period=Duration.minutes(1),
                sparkline=True
            )
        )
    
    def __buildMetric(self,namespace,metric_name,label,statistic='Sum'):
        return aws_cloudwatch.Metric(
            metric_name = metric_name,
            namespace = namespace,
            period=Duration.minutes(1),
            statistic=statistic
        )
    
    def __buildServiceMetric(self,namespace,metric_name,resourcePath,label,statistic='Sum'):
        return aws_cloudwatch.Metric(
            metric_name = metric_name,
            namespace = namespace,
            dimensions_map = {
                'resourcePath':resourcePath
            },
            label=label,
            period=Duration.minutes(1),
            statistic=statistic
        )