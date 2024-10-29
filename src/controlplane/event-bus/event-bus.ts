import { Aws, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup, LambdaFunction, SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, Status } from '../../config';

const description = 'EventBus';
const stackName = Aws.STACK_NAME;

interface SfnCallbackProps {
  eventBus: EventBus;
  logGroup: LogGroup;
}

class SfnCallback extends Construct {
  constructor(scope: Construct, id: string, props: SfnCallbackProps) {
    super(scope, id);
    const sfnCallbackFn = new NodejsFunction(this, 'SfnCallbackFn', {
      functionName: applicationName+'-'+description+'SfnCallback',
      entry: __dirname + '/sfn-callback.function.ts',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'sfnCallback',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    sfnCallbackFn.role?.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        'states:SendTaskSuccess',
        'states:SendTaskFailure',
      ],
      resources: ['*'],
    }));
    const rule = new Rule(this, 'SfnCallbackRule', {
      ruleName: 'SfnCallbackRule',
      eventPattern: {
        source: [ControlPlaneEventBusEventSource.controlPlane],
        detailType: [ControlPlaneEventBusDetailType.SfnCallback],
        detail: {
          status: [Status.Failed, Status.Succeeded],
          taskToken: [{ exists: true }],
        },
      },
      eventBus: props.eventBus,
    });
    rule.addTarget(new LambdaFunction(sfnCallbackFn));
  }
}

export class ControlPlaneEventBus extends Construct {
  public readonly eventBus: EventBus;
  public readonly logGroup: LogGroup;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.logGroup = new LogGroup(this, description + 'LogGroup', {
      logGroupName: '/' + stackName + '/' + description,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.eventBus = new EventBus(this, description + 'EventBus', {
      eventBusName: applicationName + '-' + description,
    });
    new Rule(this, description + 'LogRule', {
      ruleName: 'LogRule',
      eventBus: this.eventBus,
      eventPattern: { source: [{ prefix: '' }] as any[] },
      targets: [new CloudWatchLogGroup(this.logGroup)],
    });
    new SfnCallback(this, 'SfnCallback', {
      eventBus: this.eventBus,
      logGroup: this.logGroup,
    });
  }
  addLambdaTarget(detailType: ControlPlaneEventBusDetailType, fn: NodejsFunction, ruleName?: string) {
    const ruleNameToUse = ruleName ?? detailType;
    const rule = new Rule(this, ruleNameToUse + 'Rule', {
      ruleName: ruleNameToUse,
      eventPattern: {
        source: [ControlPlaneEventBusEventSource.controlPlane],
        detailType: [detailType],
      },
      eventBus: this.eventBus,
    });
    rule.addTarget(new LambdaFunction(fn));
  }
  addStepFunctionTarget(detailType: ControlPlaneEventBusDetailType, sfnStateMachine: StateMachine, ruleName?: string) {
    const ruleNameToUse = ruleName ?? detailType;
    const rule = new Rule(this, ruleNameToUse + 'Rule', {
      ruleName: ruleNameToUse,
      eventPattern: {
        source: [ControlPlaneEventBusEventSource.controlPlane],
        detailType: [detailType],
      },
      eventBus: this.eventBus,
    });
    rule.addTarget(new SfnStateMachine(sfnStateMachine));
  }
}