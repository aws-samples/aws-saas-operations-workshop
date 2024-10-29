import { Duration } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, Status, ExportType, TenantStatus, TenantTier } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantOffboarding';

export interface TenantOffboardingProps {
  logGroup: LogGroup;
  tenantCatalog: TableV2;
  eventBus: ControlPlaneEventBus;
  deleteStackTenantMappingEntry: NodejsFunction;
  deleteTenantEntry: NodejsFunction;
  readTenantEntry: NodejsFunction;
  readStackEntry: NodejsFunction;
  updateTenantEntry: NodejsFunction;
}

// Input:
//  tenantId: string;
export class TenantOffboarding extends Construct {
  constructor(scope: Construct, id: string, props: TenantOffboardingProps) {
    super(scope, id);

    const getTenantDetails = new LambdaInvoke(this, description + 'GetTenantDetail', {
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

    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack details',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.tenant.stackName'),
      }),
      resultSelector: {
        stackName: JsonPath.objectAt('$.Payload.cell.stackName'),
      },
      resultPath: '$.stack',
    });

    const setTenantInactive = new LambdaInvoke(this, description + 'SetTenantInactive', {
      stateName: 'Set tenant to INACTIVE',
      lambdaFunction: props.updateTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.tenant.tier'),
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
        status: TenantStatus.Inactive,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const exportTenant = new EventBridgePutEvents(this, description + 'PutExportEvent', {
      stateName: 'Export tenant (Send TENANT_EXPORT_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantExportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: ExportType.Archive,
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const isTenantBasic = new Choice(this, description + 'IsTenantBasic', {
      stateName: 'Basic tier?',
    });
    const isTenantBasicCondition = Condition.stringEquals('$.tenant.tier', TenantTier.Basic);
    const basicYes = new Pass(this, description + 'BasicYes', {
      stateName: 'Basic tier',
    });
    const basicNo = new Pass(this, description + 'BasicNo', {
      stateName: 'Not basic tier',
    });

    const deleteTenantData = new EventBridgePutEvents(this, description + 'PutDeleteDataEvent', {
      stateName: 'Delete tenant data (Send TENANT_DELETE_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDeleteRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          exportType: ExportType.Archive,
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const deleteStack = new EventBridgePutEvents(this, description + 'PutDeleteStackEvent', {
      stateName: 'Delete tenant stack (Send DEPROVISIONING_REQUEST to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.DeprovisioningRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          exportType: ExportType.Archive,
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });
    const deleteTenantResources = isTenantBasic
      .when(isTenantBasicCondition, basicYes
        .next(deleteTenantData))
      .otherwise(basicNo
        .next(deleteStack))
      .afterwards();

    const deleteStackTenantMapping = new LambdaInvoke(this, description + 'DeleteStackTenantMapping', {
      stateName: 'Delete stack-tenant mapping in tenant catalogue',
      lambdaFunction: props.deleteStackTenantMappingEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const deleteTenantEntry = new LambdaInvoke(this, description + 'DeleteTenantEntry', {
      stateName: 'Delete tenant entry in tenant catalogue',
      lambdaFunction: props.deleteTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const sendOffboardingSuccessEvent = new EventBridgePutEvents(this, description + 'SendOffboardingEvent', {
      stateName: 'Send OFFBOARDING_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.OffboardingSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.tenant.tenantId'),
        }),
      }],
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

    const sfnDefinition = getTenantDetails
      .next(getStackDetails)
      .next(setTenantInactive)
      .next(exportTenant)
      .next(deleteTenantResources)
      .next(deleteStackTenantMapping)
      .next(deleteTenantEntry)
      .next(sendOffboardingSuccessEvent)
      .next(callback);


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Offboard a tenant',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantOffboarding',
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.OffboardingRequest, sfn);

  }
}

