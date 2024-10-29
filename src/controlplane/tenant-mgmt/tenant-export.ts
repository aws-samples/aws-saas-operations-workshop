import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Parallel, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantExport';

export interface TenantExportProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  readTenantEntry: NodejsFunction;
}

//Input:
//  tenantId: string;
export class TenantExport extends Construct {
  constructor(scope: Construct, id: string, props: TenantExportProps) {
    super(scope, id);

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

    const getTenantDetails = new LambdaInvoke(this, description + 'GetTenantDetail', {
      stateName: 'Get tenant details',
      lambdaFunction: props.readTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
      }),
      resultSelector: {
        stackName: JsonPath.stringAt('$.Payload.tenant.stackName'),
      },
      resultPath: '$.tenant',
    });

    const userExport = new EventBridgePutEvents(this, description + 'PutUserExportEvent', {
      stateName: 'Export tenant users (Send TENANT_USER_EXPORT_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantUserExportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: JsonPath.stringAt('$.detail.exportType'),
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const dataExport = new EventBridgePutEvents(this, description + 'PutDataExportEvent', {
      stateName: 'Export tenant data (Send TENANT_DATA_EXPORT_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataExportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: JsonPath.stringAt('$.detail.exportType'),
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const tenantExport = new Parallel(this, description + 'TenantExport', {
      stateName: 'Export tenant',
      resultPath: JsonPath.DISCARD,
    })
      .branch(userExport)
      .branch(dataExport);

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

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendExportEvent', {
      stateName: 'Send TENANT_EXPORT_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantExportSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: JsonPath.stringAt('$.detail.exportType'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getTenantDetails
      .next(tenantExport)
      .next(sendSuccessEvent)
      .next(callback);


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Export tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantExport',
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantExportRequest, sfn);

  }
}

