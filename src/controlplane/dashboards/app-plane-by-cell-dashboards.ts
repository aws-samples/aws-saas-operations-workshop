import { Duration } from 'aws-cdk-lib';
import { Color, Dashboard, DashboardVariable, DefaultValue, MathExpression, Metric, SingleValueWidget, Unit, Values, VariableInputType, VariableType } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { applicationName } from '../../config';

const description = 'AppPlaneByCell';

const basicTierStackName = `${applicationName}-cell-basic`;

export class AppPlaneByCellDashboards extends Construct {
  public readonly dashboard: Dashboard;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.dashboard = new Dashboard(this, description + 'Dashboard', {
      defaultInterval: Duration.hours(1),
      dashboardName: 'Application-plane-by-cell',
    });

    let services = ['orders', 'products', 'users', 'auth'];

    this.dashboard.addVariable(new DashboardVariable({
      label: 'Cell',
      type: VariableType.PROPERTY,
      inputType: VariableInputType.SELECT,
      id: 'cell',
      values: Values.fromSearch("SaaSOpsV2", "stackName"),
      value: "stackName",
      defaultValue: DefaultValue.value(basicTierStackName)
    }));

    this.addServicesDashboard(services);
    this.addApiDashboard();
  }

  addServicesDashboard(services: string[]) {
    this.dashboard.addWidgets(
      new SingleValueWidget({
        title: 'Service usages',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `SUM(SEARCH('{"SaaSOpsV2", "status", "tenantId", "stackName"} MetricName="${service}" stackName="${basicTierStackName}"', 'SampleCount'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),
      // new SingleValueWidget({
      //   title: 'Service usages',
      //   metrics: services.map((service) => {
      //     return new Metric({
      //       metricName: service,
      //       namespace: 'SaaSOpsV2',
      //       statistic: Stats.SAMPLE_COUNT,
      //       period: Duration.minutes(5),
      //       dimensionsMap: {
      //         stackName: 'SaaSOpsV2-cell-basic'
      //       }
      //     })
      //   }),
      //   height: 4,
      //   width: 24,
      //   sparkline: true,
      // }),
      new SingleValueWidget({
        title: 'Service latency (ms)',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `AVG(SEARCH('{"SaaSOpsV2", "status", "tenantId", "stackName"} MetricName="${service}" stackName="${basicTierStackName}"', 'Average'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),
      // new SingleValueWidget({
      //   title: 'Service latency',
      //   metrics: services.map((service) => {
      //     return new Metric({
      //       metricName: service,
      //       namespace: 'SaaSOpsV2',
      //       statistic: Stats.AVERAGE,
      //       period: Duration.minutes(5),
      //       dimensionsMap: {
      //         stackName: 'SaaSOpsV2-cell-basic'
      //       }
      //     })
      //   }),
      //   height: 4,
      //   width: 24,
      //   sparkline: true,
      // }),

      new SingleValueWidget({
        title: 'Service error count',
        metrics: services.map((service) => {
          return new MathExpression({
            expression: `SUM(SEARCH('{"SaaSOpsV2", "status", "tenantId", "stackName"} MetricName="${service}" status="500" stackName="${basicTierStackName}"', 'SampleCount'))`,
            usingMetrics: {},
            label: service,
            period: Duration.minutes(5),
          });
        }),
        height: 4,
        width: 24,
        sparkline: true,
      }),

      // new SingleValueWidget({
      //   title: 'Service error count',
      //   metrics: services.map((service) => {
      //     return new Metric({
      //       metricName: service,
      //       namespace: 'SaaSOpsV2',
      //       statistic: Stats.SAMPLE_COUNT,
      //       period: Duration.minutes(5),
      //       dimensionsMap: {
      //         status: '500',
      //         stackName: 'SaaSOpsV2-cell-basic'
      //       }
      //     })
      //   }),
      //   height: 4,
      //   width: 24,
      //   sparkline: true,
      // }),
    )
  }

  addApiDashboard() {
    this.dashboard.addWidgets(
      new SingleValueWidget({
        title: 'API stats',
        metrics: [
          new Metric({
            namespace: "SaaSOpsV2",
            metricName: "ApiLatency",
            unit: Unit.MILLISECONDS,
            dimensionsMap: {
              stackName: basicTierStackName,
            },
            statistic: "avg",
            label: 'Api latency (ms)',
            color: Color.BLUE,
          }),
          new Metric({
            namespace: "SaaSOpsV2",
            metricName: "ApiThrottleCount",
            unit: Unit.COUNT,
            dimensionsMap: {
              stackName: basicTierStackName,
            },
            statistic: "n",
            label: 'Throttle count',
            color: Color.ORANGE,
          }),
          new Metric({
            namespace: "SaaSOpsV2",
            metricName: "ApiErrorCount",
            unit: Unit.COUNT,
            dimensionsMap: {
              stackName: basicTierStackName,
            },
            statistic: "n",
            label: 'Error count',
            color: Color.RED,
          }),
        ],
        width: 24,
        height: 4,
        period: Duration.minutes(5),
        sparkline: true,
      })
    )
  }
}

