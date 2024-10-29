import { Duration } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Role } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, ExportType, runtime, Status, TenantStatus, TenantTier } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantMigrate';

export interface TenantMigrateProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  tenantCatalog: TableV2;
  deleteStackTenantMappingEntry: NodejsFunction;
  readTenantEntry: NodejsFunction;
  updateTenantEntry: NodejsFunction;
  updateStackTenantMappingEntry: NodejsFunction;
}

//Input
//  tenantId: string; - tenant to migrate
//  tier: TenantTier; - tier to migrate to
export class TenantMigrate extends Construct {
  constructor(scope: Construct, id: string, props: TenantMigrateProps) {
    super(scope, id);
    const exportType = ExportType.Migrate;
    const detailTypeRequest = ControlPlaneEventBusDetailType.TenantMigrateRequest;
    const detailTypeSuccess = ControlPlaneEventBusDetailType.TenantMigrateSuccess;

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

    const setTenantEntryMigrating = new LambdaInvoke(this, description + 'SetTenantMigrating', {
      stateName: 'Set tenant to ' + TenantStatus.Migrating,
      lambdaFunction: props.updateTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.tenant.tier'),
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
        status: TenantStatus.Migrating,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const exportTenantFromCurrentStack = new EventBridgePutEvents(this, description + 'PutTenantExportEvent', {
      stateName: 'Export tenant from current stack (Send '+ControlPlaneEventBusDetailType.TenantExportRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantExportRequest,
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

    const isTenantBasicChoice = new Choice(this, description + 'IsTenantBasic', {
      stateName: 'Is the tenant migrating to the basic tier?',
    });
    const isTenantBasicCondition = Condition.stringEquals('$.detail.tier', TenantTier.Basic);
    const basicYes = new Pass(this, description + 'BasicYes', {
      stateName: 'Basic tier',
    });
    const basicNo = new Pass(this, description + 'BasicNo', {
      stateName: 'Not basic tier',
    });

    const getBasicStacksFn = new NodejsFunction(this, description + 'GetBasicStacksFn', {
      entry: __dirname + '/../resource-mgmt/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'getStacks',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    props.tenantCatalog.grantReadData(getBasicStacksFn.role as Role);
    const getBasicStacks = new LambdaInvoke(this, description + 'GetBasicStacks', {
      stateName: 'Get basic stacks',
      lambdaFunction: getBasicStacksFn,
      payload: TaskInput.fromObject({
        tier: JsonPath.stringAt('$.detail.tier'),
      }),
      resultSelector: {
        stacks: JsonPath.objectAt('$.Payload.body'),
      },
      resultPath: JsonPath.stringAt('$.stacks'),
    });
    const doesBasicCellExist = new Choice(this, description + 'DoesBasicCellExist', {
      stateName: 'Does a basic cell exist?',
    });
    const doesBasicCellExistCondition = Condition.isPresent(JsonPath.stringAt('$.stacks.stacks[0].stackName'));
    const basicCellYes = new Pass(this, description + 'BasicCellYes', {
      stateName: 'Basic cell exists',
      parameters: {
        detail: JsonPath.stringAt('$.detail'),
        stack: JsonPath.stringAt('$.stacks.stacks[0]'),
        tenant: JsonPath.stringAt('$.tenant'),
      },
    });
    const basicCellNo = new Pass(this, description + 'BasicCellNo', {
      stateName: 'Basic cell does not exist',
    });

    const provisionCell = new EventBridgePutEvents(this, description + 'PutProvisioningEvent', {
      stateName: 'Provision tenant resources (Send '+ControlPlaneEventBusDetailType.ProvisioningRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.ProvisioningRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tier: JsonPath.stringAt('$.detail.tier'),
          stackName: JsonPath.stringAt('$.stack.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const createStackNameFn = new NodejsFunction(this, description + 'CreateStackNameFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'createStackName',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    const createStackNameAndProvision = new LambdaInvoke(this, description + 'CreateStackName', {
      stateName: 'Create stack name',
      lambdaFunction: createStackNameFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tier: JsonPath.stringAt('$.detail.tier'),
      }),
      resultSelector: {
        stackName: JsonPath.stringAt('$.Payload.body.stackName'),
      },
      resultPath: '$.stack',
    })
      .next(provisionCell);

    const provisionNewStack = isTenantBasicChoice
      .when(isTenantBasicCondition, basicYes
        .next(getBasicStacks)
        .next(doesBasicCellExist
          .when(doesBasicCellExistCondition, basicCellYes)
          .otherwise(basicCellNo
            .next(createStackNameAndProvision),
          ),
        ),
      )
      .otherwise(basicNo
        .next(createStackNameAndProvision),
      )
      .afterwards();

    const importTenantToNewStack = new EventBridgePutEvents(this, description + 'PutImportEvent', {
      stateName: 'Import tenant to new stack (Send '+ControlPlaneEventBusDetailType.TenantImportRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantImportRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          exportType: exportType,
          stackName: JsonPath.stringAt('$.stack.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const createNewStackTenantMapping = new LambdaInvoke(this, description + 'CreateNewStackTenantMapping', {
      stateName: 'Create stack-tenant mapping in tenant catalogue',
      lambdaFunction: props.updateStackTenantMappingEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        stackName: JsonPath.stringAt('$.stack.stackName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const updateTenantEntry = new LambdaInvoke(this, description + 'UpdateTenantEntry', {
      stateName: 'Update tenant entry with new details',
      lambdaFunction: props.updateTenantEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.detail.tier'), // Assign the new tier
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.stack.stackName'), // Assign the new stack name
        status: TenantStatus.Active, // Set the tenant to active
      }),
      resultPath: JsonPath.DISCARD,
    });

    const wasTenantPremiumChoice = new Choice(this, description + 'IsTenantPremium', {
      stateName: 'Was the tenant migrating from the premium tier?',
    });
    const wasTenantPremiumCondition = Condition.stringEquals('$.tenant.tier', TenantTier.Premium);
    const premiumYes = new Pass(this, description + 'PremiumYes', {
      stateName: 'Tenant was premium tier',
    });
    const premiumNo = new Pass(this, description + 'PremiumNo', {
      stateName: 'Tenant was not premium tier',
    });

    const deleteTenantFromOldStack = new EventBridgePutEvents(this, description + 'PutDeleteEvent', {
      stateName: 'Delete tenant from old stack (Send '+ControlPlaneEventBusDetailType.TenantDeleteRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDeleteRequest,
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

    const deleteOldStack = new EventBridgePutEvents(this, description + 'PutDeprovisioningEvent', {
      stateName: 'Delete old stack (Send '+ControlPlaneEventBusDetailType.DeprovisioningRequest+' to event bus)',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.DeprovisioningRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          stackName: JsonPath.stringAt('$.tenant.stackName'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const deleteOldTenantResources = wasTenantPremiumChoice
      .when(wasTenantPremiumCondition, premiumYes
        .next(deleteOldStack),
      )
      .otherwise(premiumNo
        .next(deleteTenantFromOldStack),
      )
      .afterwards();

    const deleteOldStackTenantMapping = new LambdaInvoke(this, description + 'DeleteOldStackTenantMapping', {
      stateName: 'Delete old stack-tenant mapping in tenant catalogue',
      lambdaFunction: props.deleteStackTenantMappingEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        stackName: JsonPath.stringAt('$.tenant.stackName'),
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
          stackName: JsonPath.stringAt('$.stack.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getTenantDetails
      .next(setTenantEntryMigrating)
      .next(provisionNewStack)
      .next(exportTenantFromCurrentStack)
      .next(importTenantToNewStack)
      .next(createNewStackTenantMapping)
      .next(updateTenantEntry)
      .next(deleteOldTenantResources)
      .next(deleteOldStackTenantMapping)
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

    props.eventBus.addStepFunctionTarget(detailTypeRequest, sfn);

  }
}

