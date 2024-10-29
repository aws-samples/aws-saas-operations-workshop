import { Duration } from 'aws-cdk-lib';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Parallel, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantImport';

export interface TenantImportProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
}

//Input
//  tenantId: string; - tenant to import
//  stackName: string; - stack to import to
//  exportType: ExportType; - which bucket to import from (Archive or temporary)
export class TenantImport extends Construct {
  constructor(scope: Construct, id: string, props: TenantImportProps) {
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

    const userImport = new EventBridgePutEvents(this, description + 'PutUserImportEvent', {
      stateName: 'Import tenant users (Send '+ControlPlaneEventBusDetailType.TenantUserImportRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantUserImportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: JsonPath.stringAt('$.detail.exportType'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const dataImport = new EventBridgePutEvents(this, description + 'PutDataImportEvent', {
      stateName: 'Import tenant data (Send '+ControlPlaneEventBusDetailType.TenantDataImportRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataImportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: JsonPath.stringAt('$.detail.exportType'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const tenantImport = new Parallel(this, description + 'TenantImport', {
      stateName: 'Import tenant',
      resultPath: JsonPath.DISCARD,
    })
      .branch(userImport)
      .branch(dataImport);

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send TENANT_IMPORT_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantImportSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = tenantImport
      .next(sendSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Import tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-' + description,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantImportRequest, sfn);

  }
}

