import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Parallel, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantDelete';

export interface TenantDeleteProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

// Input:
//  tenantId: string;
//  stackName: string;
export class TenantDelete extends Construct {
  constructor(scope: Construct, id: string, props: TenantDeleteProps) {
    super(scope, id);

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

    const userDelete = new EventBridgePutEvents(this, description + 'PutUserDeleteEvent', {
      stateName: 'Delete tenant users (Send TENANT_USER_DELETE_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantUserDeleteRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const dataDelete = new EventBridgePutEvents(this, description + 'PutDataDeleteEvent', {
      stateName: 'Delete tenant data (Send TENANT_DATA_DELETE_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataDeleteRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const tenantDelete = new Parallel(this, description + 'TenantDelete', {
      stateName: 'Delete tenant',
      resultPath: JsonPath.DISCARD,
    })
      .branch(userDelete)
      .branch(dataDelete);

    const sendSfnSuccessCallbackEvent = new EventBridgePutEvents(this, description + 'SendSfnSuccessCallbackEvent', {
      stateName: 'Send successful SFN_CALLBACK event',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.SfnCallback,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          status: Status.Succeeded,
          taskToken: JsonPath.stringAt('$.detail.taskToken'),
          output: JsonPath.stringAt('$.detail.tenantId'),
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

    const sendDeleteSuccessEvent = new EventBridgePutEvents(this, description + 'SendDeleteSuccessEvent', {
      stateName: 'Send TENANT_DELETE_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDeleteSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = tenantDelete
      .next(sendDeleteSuccessEvent)
      .next(callback);


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Delete tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantDelete',
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantDeleteRequest, sfn);

  }
}

