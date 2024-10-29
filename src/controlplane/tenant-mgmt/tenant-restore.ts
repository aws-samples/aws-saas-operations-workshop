import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, ExportType, Status, TenantStatus } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantRestore';

export interface TenantRestoreProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  readTenantEntry: NodejsFunction;
  updateTenantEntry: NodejsFunction;
}

//Input
//  tenantId: string; - tenant to restore
export class TenantRestore extends Construct {
  constructor(scope: Construct, id: string, props: TenantRestoreProps) {
    super(scope, id);
    const exportType = ExportType.Archive;
    const detailTypeRequest = ControlPlaneEventBusDetailType.TenantRestoreRequest;
    const detailTypeSuccess = ControlPlaneEventBusDetailType.TenantRestoreSuccess;

    const getTenantDetails = new LambdaInvoke(this, description + 'GetTenantDetails', {
      stateName: 'Get tenant details',
      lambdaFunction: props.readTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
      }),
      resultSelector: {
        stackName: JsonPath.objectAt('$.Payload.tenant.stackName'),
        tenantId: JsonPath.objectAt('$.Payload.tenant.tenantId'),
        tenantName: JsonPath.objectAt('$.Payload.tenant.tenantName'),
        tier: JsonPath.objectAt('$.Payload.tenant.tier'),
        apiKey: JsonPath.objectAt('$.Payload.tenant.apiKey'),
      },
      resultPath: '$.tenant',
    });

    const setTenantEntryRestoring = new LambdaInvoke(this, description + 'SetTenantRestoring', {
      stateName: 'Set tenant to ' + TenantStatus.Restoring,
      lambdaFunction: props.updateTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.tenant.tier'),
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
        status: TenantStatus.Restoring,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const setTenantEntryActive = new LambdaInvoke(this, description + 'SetTenantActive', {
      stateName: 'Set tenant to ' + TenantStatus.Active,
      lambdaFunction: props.updateTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.tenant.tier'),
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
        status: TenantStatus.Active,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const restoreData = new EventBridgePutEvents(this, description + 'PutImportEvent', {
      stateName: 'Restore tenant data (Send '+ControlPlaneEventBusDetailType.TenantDataImportRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataImportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: exportType,
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const deleteOldData = new EventBridgePutEvents(this, description + 'PutDeleteEvent', {
      stateName: 'Delete old tenant data (Send '+ControlPlaneEventBusDetailType.TenantDataDeleteRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataDeleteRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
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

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send '+detailTypeSuccess+' to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: detailTypeSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getTenantDetails
      .next(setTenantEntryRestoring)
      .next(deleteOldData)
      .next(restoreData)
      .next(setTenantEntryActive)
      .next(sendSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Restore tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-' + description,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(detailTypeRequest, sfn);

  }
}

