import { Aws, Duration } from 'aws-cdk-lib';
import { BuildEnvironmentVariableType, Project } from 'aws-cdk-lib/aws-codebuild';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { CodeBuildStartBuild, EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, CellStatus, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, runtime, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'StackDeprov';
const stackName = Aws.STACK_NAME;

export interface CellDeprovisioningProps {
  eventBus: ControlPlaneEventBus;
  logGroup: LogGroup;
  project: Project;
  tenantCatalog: TableV2;
  deleteCellEntryFn: NodejsFunction;
}

// Input:
//  stackName: string;
export class CellDeprovisioning extends Construct {
  constructor(scope: Construct, id: string, props: CellDeprovisioningProps) {
    super(scope, id);
    const cellDeprovisioningRole = new Role(this, description + 'CellDeprovisioningRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const updateCellDeprovisioningFn = new NodejsFunction(this, description + 'UpdateCellDeprovisioningFn', {
      functionName: stackName + '-' + description + '-UpdateCellDeprovisioning',
      entry: __dirname + '/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'updateCellEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    props.tenantCatalog.grantReadWriteData(updateCellDeprovisioningFn.role as Role);
    const updateCellDeprovisioning = new LambdaInvoke(this, description + 'UpdateCellDeprovisioning', {
      stateName: 'Update stack status to DEPROVISIONING in tenant catalog',
      lambdaFunction: updateCellDeprovisioningFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
        status: CellStatus.Deprovisioning,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const deprovisionCell = new CodeBuildStartBuild(this, description + 'DeprovisionCell', {
      stateName: 'Deprovision application stack',
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
    cellDeprovisioningRole.addToPolicy(new PolicyStatement({
      actions: ['codebuild:StartBuild'],
      resources: [props.project.projectArn],
    }));

    const deleteCellEntry = new LambdaInvoke(this, description + 'DeleteCellEntry', {
      stateName: 'Delete stack entry in tenant catalog',
      lambdaFunction: props.deleteCellEntryFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const taskTokenPresent = new Choice(this, description + 'TaskTokenPresent', {
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

    const sendDeprovisioningSuccessEvent = new EventBridgePutEvents(this, description + 'SendDeprovisioningSuccessEvent', {
      stateName: 'Send DEPROVISIONING_SUCCESS event',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.DeprovisioningSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          stackName: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = updateCellDeprovisioning
      .next(deprovisionCell)
      .next(deleteCellEntry)
      .next(sendDeprovisioningSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Deprovision an application stack',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-StackDeprovisioning',
      role: cellDeprovisioningRole,
    });
    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.DeprovisioningRequest, sfn);
  }
}