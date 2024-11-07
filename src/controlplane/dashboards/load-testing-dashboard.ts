import { Duration } from 'aws-cdk-lib';
import { Dashboard, DashboardVariable, DefaultValue, Metric, SingleValueWidget, Unit, Values, VariableInputType, VariableType } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

const description = 'LoadTesting';

export class LoadTestingDashboards extends Construct {
  public readonly dashboard: Dashboard;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.dashboard = new Dashboard(this, description + 'Dashboard', {
      defaultInterval: Duration.hours(1),
      dashboardName: 'Load-testing',
    });

    this.dashboard.addVariable(new DashboardVariable({
      label: 'Tenant tier',
      type: VariableType.PROPERTY,
      inputType: VariableInputType.SELECT,
      id: 'tiervar',
      values: Values.fromValues({value: "BASIC", label: "Basic Tier"}, {value: "PREMIUM", label: "Premium Tier"}),
      value: 'Tier',
      defaultValue: DefaultValue.value("BASIC")
    }));

    this.addLoadTestingGraphs();
  }

  addLoadTestingGraphs() {
    this.dashboard.addWidgets(
      new SingleValueWidget({
        title: 'API response stats',
        metrics: [
          new Metric({
            namespace: "SaaSOpsV2-LoadTest",
            metricName: "http.response_time.2xx.median",
            unit: Unit.MILLISECONDS,
            dimensionsMap: {
              Tier: "BASIC",
              Name: "loadtest"
            },
            statistic: "avg"
          }),
          new Metric({
            namespace: "SaaSOpsV2-LoadTest",
            metricName: "http.response_time.2xx.min",
            unit: Unit.MILLISECONDS,
            dimensionsMap: {
              Tier: "BASIC",
              Name: "loadtest"
            },
            statistic: "min"
          }),
          new Metric({
            namespace: "SaaSOpsV2-LoadTest",
            metricName: "http.response_time.2xx.max",
            unit: Unit.MILLISECONDS,
            dimensionsMap: {
              Tier: "BASIC",
              Name: "loadtest"
            },
            statistic: "max"
          }),
          new Metric({
            namespace: "SaaSOpsV2-LoadTest",
            metricName: "http.response_time.2xx.p99",
            unit: Unit.MILLISECONDS,
            dimensionsMap: {
              Tier: "BASIC",
              Name: "loadtest"
            },
            statistic: "p99",
          })
        ],
        width: 24,
        height: 4,
        period: Duration.minutes(5),
        sparkline: true,
      })
    )
  }
}

