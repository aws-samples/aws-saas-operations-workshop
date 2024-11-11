import { Duration } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, MathExpression, Row, SingleValueWidget, TextWidget } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { applicationName } from '../../config';

const description = 'Dashboards';

export class Dashboards extends Construct {
  public readonly applicationPlaneDashboard: Dashboard;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.applicationPlaneDashboard = new Dashboard(this, description + 'Dashboard', {
      defaultInterval: Duration.hours(1),
      dashboardName: applicationName + '-Overview',
    });
    const applicationPlaneTitle = new TextWidget({
      markdown: '# Application plane',
      height: 1,
      width: 24,
    });
    this.applicationPlaneDashboard.addWidgets(applicationPlaneTitle);
    let services = ['orders', 'products', 'users', 'auth'];

    for (var service in services) {
      this.addServiceDashboard(services[service]);
    }
  }
  addServiceDashboard(serviceName: string) {
    this.applicationPlaneDashboard.addWidgets(
      new TextWidget({
        markdown: '# /'+serviceName,
        height: 1,
        width: 24,
      }),
      new Row(
        new GraphWidget({
          title: 'Usage per cell',
          left: [
            new MathExpression({
              expression: 'SELECT COUNT(' + serviceName + ') FROM SCHEMA(SaaSOpsV2, status, tenantId, stackName) GROUP BY stackName',
              usingMetrics: {},
              label: '/' + serviceName,
              period: Duration.minutes(1),
            }),
          ],
          height: 4,
          width: 8,
          liveData: true,
        }),
        new GraphWidget({
          title: 'Latency per cell',
          left: [
            new MathExpression({
              expression: 'SELECT AVG(' + serviceName + ") FROM SCHEMA(SaaSOpsV2, status, tenantId, stackName) WHERE status = '200' GROUP BY stackName",
              usingMetrics: {},
              label: '/' + serviceName,
              period: Duration.minutes(1),
            }),
          ],
          height: 4,
          width: 8,
          liveData: true,
        }),
        new SingleValueWidget({
          title: 'Average Latency',
          metrics: [
            new MathExpression({
              expression: 'SELECT AVG(' + serviceName + ") FROM SCHEMA(SaaSOpsV2, status, tenantId, stackName) WHERE status = '200'",
              usingMetrics: {},
              label: '/' + serviceName,
              period: Duration.minutes(1),
            }),
          ],
          height: 4,
          width: 4,
          sparkline: true,
        }),
        new SingleValueWidget({
          title: 'Error rate',
          metrics: [
            new MathExpression({
              expression: 'SELECT COUNT(' + serviceName + ") FROM SCHEMA(SaaSOpsV2, status, tenantId, stackName) WHERE status != '200'",
              usingMetrics: {},
              label: '/' + serviceName,
              period: Duration.minutes(1),
            }),
          ],
          height: 4,
          width: 4,
          sparkline: true,
        }),
      ),

    );
  }
}

