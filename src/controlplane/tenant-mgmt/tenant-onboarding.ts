import { Duration, Stack } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, runtime, Status, TenantStatus, TenantTier } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantProv';

export interface TenantOnboardingProps {
  eventBus: ControlPlaneEventBus;
  logGroup: LogGroup;
  tenantCatalog: TableV2;
  updateStackTenantMappingEntry: NodejsFunction;
}

// Input:
//  tenantName: string;
//  tier: TenantTier;
export class TenantOnboarding extends Construct {
  constructor(scope: Construct, id: string, props: TenantOnboardingProps) {
    super(scope, id);
    const role = new Role(this, description + 'Role', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    props.tenantCatalog.grantReadWriteData(role);

    const createTenantEntryFn = new NodejsFunction(this, description + 'CreateTenantEntryFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'createTenant',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });

    props.tenantCatalog.grantReadWriteData(createTenantEntryFn.role as Role);
    createTenantEntryFn.role?.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['apigateway:*'],
      resources: [
        `arn:${Stack.of(this).partition}:apigateway:${Stack.of(this).region}::/apikeys`,
        `arn:${Stack.of(this).partition}:apigateway:${Stack.of(this).region}::/apikeys/*`,
        `arn:${Stack.of(this).partition}:apigateway:${Stack.of(this).region}::/usageplans`,
        `arn:${Stack.of(this).partition}:apigateway:${Stack.of(this).region}::/usageplans/*`,
      ],
    }));

    const createTenant = new LambdaInvoke(this, description + 'CreateTenantEntry', {
      stateName: 'Create tenant entry in tenant catalogue',
      lambdaFunction: createTenantEntryFn,
      payload: TaskInput.fromObject({
        tenantName: JsonPath.stringAt('$.detail.tenantName'),
        tier: JsonPath.stringAt('$.detail.tier'),
      }),
      resultSelector: {
        'tenantId.$': '$.Payload.tenantId',
        'tenantName.$': '$.Payload.tenantName',
        'tier.$': '$.Payload.tier',
        'apiKey.$': '$.Payload.apiKey',
      },
      resultPath: '$.tenant',
    });

    const isTenantBasic = new Choice(this, description + 'IsTenantBasic', {
      stateName: 'Is the tenant in the basic tier?',
    });
    const isTenantBasicCondition = Condition.stringEquals('$.tenant.tier', TenantTier.Basic);
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
      stateName: 'Get all basic stacks from tenant catalogue',
      lambdaFunction: getBasicStacksFn,
      payload: TaskInput.fromObject({
        tier: JsonPath.stringAt('$.tenant.tier'),
      }),
      resultSelector: {
        stacks: JsonPath.objectAt('$.Payload.body'),
      },
      resultPath: JsonPath.stringAt('$.stacks'),
    });
    const doesBasicCellExist = new Choice(this, description + 'DoesBasicCellExist', {
      stateName: 'Does a basic stack exist?',
    });
    const doesBasicCellExistCondition = Condition.isPresent(JsonPath.stringAt('$.stacks.stacks[0].stackName'));
    const basicCellYes = new Pass(this, description + 'BasicCellYes', {
      stateName: 'Basic stack exists',
      parameters: {
        detail: JsonPath.stringAt('$.detail'),
        stack: JsonPath.stringAt('$.stacks.stacks[0]'),
        tenant: JsonPath.stringAt('$.tenant'),
      },
    });
    const basicCellNo = new Pass(this, description + 'BasicCellNo', {
      stateName: 'Basic stack does not exist',
    });

    const provisionCell = new EventBridgePutEvents(this, description + 'PutProvisioningEvent', {
      stateName: 'Provision tenant resources (Send PROVISIONING_REQUEST to event bus)',
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
    const createStackName = new LambdaInvoke(this, description + 'CreateStackName', {
      stateName: 'Create stack name',
      lambdaFunction: createStackNameFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.tenant.tenantId'),
        tier: JsonPath.stringAt('$.tenant.tier'),
      }),
      resultSelector: {
        stackName: JsonPath.stringAt('$.Payload.body.stackName'),
      },
      resultPath: '$.stack',
    })
      .next(provisionCell);

    const updateTenantEntryFn = new NodejsFunction(this, description + 'UpdateTenantEntryFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'updateTenantEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    props.tenantCatalog.grantReadWriteData(updateTenantEntryFn.role as Role);
    const updateTenantEntry = new LambdaInvoke(this, description + 'UpdateTenantEntry', {
      stateName: 'Update tenant entry in tenant catalogue',
      lambdaFunction: updateTenantEntryFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.tenant.tenantId'),
        tenantName: JsonPath.stringAt('$.tenant.tenantName'),
        tier: JsonPath.stringAt('$.tenant.tier'),
        apiKey: JsonPath.stringAt('$.tenant.apiKey'),
        stackName: JsonPath.stringAt('$.stack.stackName'),
        status: TenantStatus.Active,
      }),
      resultPath: JsonPath.DISCARD,
    });

    const createStackTenantMapping = new LambdaInvoke(this, description + 'CreateStackTenantMapping', {
      stateName: 'Create stack-tenant mapping in tenant catalogue',
      lambdaFunction: props.updateStackTenantMappingEntry,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.tenant.tenantId'),
        stackName: JsonPath.stringAt('$.stack.stackName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const createTenantAdminFn = new NodejsFunction(this, description + 'CreateTenantAdminFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'createTenantAdmin',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: props.logGroup,
    });
    createTenantAdminFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cloudformation:ListStacks',
          'cloudformation:DescribeStacks',
        ],
        resources: ['*'],
      }),
    );
    props.tenantCatalog.grantReadData(createTenantAdminFn.role as Role);
    const createTenantAdmin = new LambdaInvoke(this, description + 'CreateTenantAdmin', {
      stateName: 'Create tenant admin user',
      lambdaFunction: createTenantAdminFn,
      payload: TaskInput.fromJsonPathAt('$.tenant'),
      resultPath: JsonPath.DISCARD,
    });

    const sendOnboardingSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send ONBOARDING_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.OnboardingSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenant: JsonPath.stringAt('$.tenant'),
        }),
      }],
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
          output: JsonPath.objectAt('$.tenant'),
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

    const sfnDefinition = createTenant
      .next(isTenantBasic
        .when(isTenantBasicCondition, basicYes
          .next(getBasicStacks)
          .next(doesBasicCellExist
            .when(doesBasicCellExistCondition, basicCellYes)
            .otherwise(basicCellNo
              .next(createStackName),
            ),
          ),
        )
        .otherwise(basicNo
          .next(createStackName),
        )
        .afterwards(),
      )
      .next(updateTenantEntry)
      .next(createStackTenantMapping)
      .next(createTenantAdmin)
      .next(sendOnboardingSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Provision an application cell',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantOnboarding',
      role: role,
    });
    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.OnboardingRequest, sfn);
  }
}