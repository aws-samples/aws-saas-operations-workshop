import { Aws, Duration } from 'aws-cdk-lib';
import { BuildEnvironmentVariableType, Project } from 'aws-cdk-lib/aws-codebuild';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { CodeBuildStartBuild, EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, CellStatus, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, runtime, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'StackProv';
const stackName = Aws.STACK_NAME;

export interface CellProvisioningProps {
  eventBus: ControlPlaneEventBus;
  logGroup: LogGroup;
  project: Project;
  tenantCatalog: TableV2;
  updateCellEntryFn: NodejsFunction;
}

// Input:
//  stackName: string;
//  tier: TenantTier;
export class CellProvisioning extends Construct {
  constructor(scope: Construct, id: string, props: CellProvisioningProps) {
    super(scope, id);
    const cellProvisioningRole = new Role(this, description + 'CellProvisioningRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const updateCellProvisioning = new LambdaInvoke(this, description + 'UpdateCellProvisioning', {
      stateName: 'Update cell status to PROVISIONING in tenant catalog',
      lambdaFunction: props.updateCellEntryFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
        status: CellStatus.Provisioning,
        tier: JsonPath.stringAt('$.detail.tier'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const provisionCell = new CodeBuildStartBuild(this, description + 'ProvisionCell', {
      stateName: 'Provision or update an application cell',
      project: props.project,
      integrationPattern: IntegrationPattern.RUN_JOB,
      environmentVariablesOverride: {
        STACK_NAME: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.detail.stackName'),
        },
      },
      resultPath: JsonPath.DISCARD,
    });
    cellProvisioningRole.addToPolicy(new PolicyStatement({
      actions: ['codebuild:StartBuild'],
      resources: [props.project.projectArn],
    }));

    const getStackDetailsFn = new NodejsFunction(this, description + 'GetStackDetailsFn', {
      functionName: stackName + '-' + description + '-GetStackDetails',
      entry: __dirname + '/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'getStackDetails',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    getStackDetailsFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:ListStacks',
          'cloudformation:DescribeStacks',
        ],
        resources: ['*'],
      }),
    );
    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack details',
      lambdaFunction: getStackDetailsFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        clientId: JsonPath.objectAt('$.Payload.clientId'),
        dataTableArn: JsonPath.objectAt('$.Payload.dataTableArn'),
        dataTableName: JsonPath.objectAt('$.Payload.dataTableName'),
        url: JsonPath.objectAt('$.Payload.url'),
        userPoolId: JsonPath.objectAt('$.Payload.userPoolId'),
      },
      resultPath: JsonPath.stringAt('$.stack'),
    });

    const updateStackActive = new LambdaInvoke(this, description + 'UpdateStackActive', {
      stateName: 'Update stack status to ACTIVE in tenant catalog',
      lambdaFunction: props.updateCellEntryFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
        status: CellStatus.Active,
        tier: JsonPath.stringAt('$.detail.tier'),
        clientId: JsonPath.stringAt('$.stack.clientId'),
        dataTableArn: JsonPath.stringAt('$.stack.dataTableArn'),
        dataTableName: JsonPath.stringAt('$.stack.dataTableName'),
        userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
        url: JsonPath.stringAt('$.stack.url'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const taskTokenPresent = new Choice(this, description + 'TaskTokenPresent1', {
      stateName: 'Is another step function waiting on a callback?',
    });
    const taskTokenPresentCondition = Condition.isPresent(JsonPath.stringAt('$.detail.taskToken'));
    const taskTokenPresentNo = new Pass(this, description + 'TaskTokenPresentNo', {
      stateName: 'No task token present',
    });
    const taskTokenPresentYes = new Pass(this, description + 'TaskTokenPresentYes', {
      stateName: 'Task token present',
    });

    const sendSfnSuccessCallbackEvent = new EventBridgePutEvents(this, description + 'SendSfnSuccessCallbackEvent', {
      stateName: 'Send successful SFN_CALLBACK event',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.SfnCallback,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          status: Status.Succeeded,
          taskToken: JsonPath.stringAt('$.detail.taskToken'),
          output: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const callback = taskTokenPresent
      .when(taskTokenPresentCondition, taskTokenPresentYes
        .next(sendSfnSuccessCallbackEvent),
      )
      .otherwise(taskTokenPresentNo)
      .afterwards();

    const sendProvisioningSuccessEvent = new EventBridgePutEvents(this, description + 'SendProvisioningSuccessEvent', {
      stateName: 'Send PROVISIONING_SUCCESS event',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.ProvisioningSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          stackName: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = updateCellProvisioning
      .next(provisionCell)
      .next(getStackDetails)
      .next(updateStackActive)
      .next(sendProvisioningSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Provision an application stack',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-StackProvisioning',
      role: cellProvisioningRole,
    });
    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.ProvisioningRequest, sfn);
  }
}