import { Duration } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, GraphWidgetView, MathExpression, Row, SingleValueWidget, TextWidget } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { applicationName } from '../../config';

const description = 'AppPlane';

export class AppPlaneDashboards extends Construct {
  public readonly dashboard: Dashboard;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.dashboard = new Dashboard(this, description + 'Dashboard', {
      defaultInterval: Duration.hours(1),
      dashboardName: 'Application-plane',
    });
    const applicationPlaneTitle = new TextWidget({
      markdown: '# Application plane overview',
      height: 1,
      width: 24,
    });
    this.dashboard.addWidgets(applicationPlaneTitle);
    let services = ['orders', 'products', 'users', 'auth'];

    this.addServiceUsagesGraph(services);
    this.addTop5ConsumersGraphs(services);
  }

  addServiceUsagesGraph(services: string[]) {
    this.dashboard.addWidgets(
      new SingleValueWidget({
        title: 'Service usages',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `SUM(SEARCH('{"${applicationName}", "status", "tenantId", "stackName"} MetricName="${service}"', 'SampleCount'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),

      new SingleValueWidget({
        title: 'Service latency (ms)',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `AVG(SEARCH('{"${applicationName}", "status", "tenantId", "stackName"} MetricName="${service}"', 'Average'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),

      new SingleValueWidget({
        title: 'Service error count',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `SUM(SEARCH('{"${applicationName}", "status", "tenantId", "stackName"} MetricName="${service}" status="500"', 'SampleCount'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),
    )
  }

  addTop5ConsumersGraphs(services: string[]) {
    this.dashboard.addWidgets(
      new Row(
        ...services.map((service) => {
          return new GraphWidget({
            title: service === 'auth' ? '"/auth" usages - Top 5 cells' : `"/${service}" usages - top 5 tenants`,
            left: [
              new MathExpression({
                expression: `SORT(SEARCH('Namespace="${applicationName}" "tenantId" "status" "stackName" MetricName="${service}"', 'SampleCount'), MAX, DESC, 5)`,
                usingMetrics: {},
                label: service === 'auth' ? "${PROP('Dim.stackName')}" : "${PROP('Dim.tenantId')}",
                period: Duration.days(1),
              })
            ],
            height: 4,
            width: 6,
            period: Duration.days(1),
            liveData: true,
            stacked: true,
            view: GraphWidgetView.PIE,
          })
        })
      )

    );
  }
}

