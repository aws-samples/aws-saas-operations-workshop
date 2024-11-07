import { Duration } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, GraphWidgetView, Metric, Row, TextWidget, Unit } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

const description = 'CtrlPlane';

export interface ControlPlaneDashboardProps {
  tenantOnboardingStateMachineArn: string;
}

export class CtrlPlaneDashboards extends Construct {
  public readonly dashboard: Dashboard;
  private readonly props: ControlPlaneDashboardProps;

  constructor(scope: Construct, id: string, props: ControlPlaneDashboardProps) {
    super(scope, id);
    this.dashboard = new Dashboard(this, description + 'Dashboard', {
      defaultInterval: Duration.hours(1),
      dashboardName: 'Control-plane',
    });
    this.props = props;

    const ctrlPlaneTitle = new TextWidget({
      markdown: '# Control plane',
      height: 1,
      width: 24,
    });
    this.dashboard.addWidgets(ctrlPlaneTitle);

    this.addTenantStatsGraphs();

  }

  addTenantStatsGraphs() {
    this.dashboard.addWidgets(
      new Row(
        new GraphWidget({
            title: 'Tenant on/off-boarding',
            left: [
              new Metric({
                metricName: 'Invocations',
                namespace: 'AWS/Events',
                statistic: 'Sum',
                color: Color.GREEN,
                label: 'Onboarding',
                unit: Unit.COUNT,
                dimensionsMap: {
                  EventBusName: 'SaaSOpsV2-EventBus',
                  RuleName: 'ONBOARDING_REQUEST'
                }
              })
            ],
            right: [
              new Metric({
                metricName: 'Invocations',
                namespace: 'AWS/Events',
                statistic: 'Sum',
                color: Color.RED,
                label: 'Offboarding',
                unit: Unit.COUNT,
                dimensionsMap: {
                  EventBusName: 'SaaSOpsV2-EventBus',
                  RuleName: 'OFFBOARDING_REQUEST'
                }
              })
            ],
            height: 6,
            width: 8,
            liveData: true,
            leftYAxis: {
                min: 0,
                showUnits: false,
            },
            rightYAxis: {
                min: 0,
                showUnits: false,
            },
        }),
      
        new GraphWidget({
          title: 'Onboarding time',
          left: [
            new Metric({
              namespace: 'AWS/States',
              metricName: 'ExecutionTime',
              dimensionsMap: {
                StateMachineArn: this.props.tenantOnboardingStateMachineArn
              },
              period: Duration.minutes(5),
              statistic: "Average",
              unit: Unit.MILLISECONDS,
              label: "Time taken (ms)"
            })
          ],
          height: 6,
          width: 8,
          liveData: true,
          view: GraphWidgetView.TIME_SERIES,
          statistic: "Average",
          period: Duration.minutes(5),
          leftYAxis: {
            min: 0,
            showUnits: false,
          },
          rightYAxis: {
              min: 0,
              showUnits: false,
          },
        }),

        new GraphWidget({
          title: 'Onboarding failures',
          left: [
            new Metric({
              namespace: 'AWS/States',
              metricName: 'ExecutionsFailed',
              label: 'Failed',
              dimensionsMap: {
                StateMachineArn: this.props.tenantOnboardingStateMachineArn
              },
              period: Duration.minutes(5),
              statistic: "Sum",
              unit: Unit.COUNT,
              color: Color.RED
            })
          ],
          right: [
            new Metric({
              namespace: 'AWS/States',
              metricName: 'ExecutionsTimedOut',
              label: 'Timed out',
              dimensionsMap: {
                StateMachineArn: this.props.tenantOnboardingStateMachineArn
              },
              period: Duration.minutes(5),
              statistic: "Sum",
              unit: Unit.COUNT,
              color: Color.ORANGE,
            })
          ],
          height: 6,
          width: 8,
          view: GraphWidgetView.TIME_SERIES,
          statistic: "Sum",
          period: Duration.minutes(5),
          liveData: true,
          leftYAxis: {
            min: 0,
            showUnits: false,
          },
          rightYAxis: {
              min: 0,
              showUnits: false,
          },
        })
      )
    );
  }
}

