import { Aws, Duration } from 'aws-cdk-lib';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Choice, Condition, DefinitionBody, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, runtime, Status, ExportType } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

export interface TenantUserExportProps {
  logGroup: LogGroup;
  archiveBucket: Bucket;
  temporaryBucket: Bucket;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Lab1-INFO
//Input:
//  tenantId: string;
//  stackName: string;
//  exportType: ExportType;
export class TenantUserExport extends Construct {
  constructor(scope: Construct, id: string, props: TenantUserExportProps) {
    super(scope, id);

    const description = 'TenantUserExport';

    const role = new Role(this, description + 'Role', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack userPoolId',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        userPoolId: JsonPath.stringAt('$.Payload.cell.userPoolId'),
      },
      resultPath: '$.stack',
    });

    const typeOfExport = new Choice(this, description + 'ChoiceDestination', {
      stateName: 'Choose a destination bucket',
    });
    const archiveDataCondition = Condition.stringEquals('$.detail.exportType', ExportType.Archive);
    const useArchiveBucket = new Pass(this, description + 'LongTermBucket', {
      stateName: 'Use long term bucket (archive)',
      result: TaskInput.fromObject({
        bucketName: props.archiveBucket.bucketName,
      }),
      resultPath: '$.destination',
    });
    const useTemporaryBucket = new Pass(this, description + 'ShortTermBucket', {
      stateName: 'Use short term bucket',
      result: TaskInput.fromObject({
        bucketName: props.temporaryBucket.bucketName,
      }),
      resultPath: '$.destination',
    });
    const chooseBucket = typeOfExport
      .when(archiveDataCondition, useArchiveBucket)
      .otherwise(useTemporaryBucket)
      .afterwards();

    const userExportFn = new NodejsFunction(this, description + 'UserExportFn', {
      entry: __dirname + '/tenant-user-mgmt.function.ts',
      runtime: runtime,
      handler: 'userExport',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(5),
      logGroup: props.logGroup,
    });
    userExportFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:ListUsers',
        ],
        resources: [
          'arn:' + Aws.PARTITION + ':cognito-idp:' + Aws.REGION + ':' + Aws.ACCOUNT_ID + ':userpool/*',
        ],
      }),
    );
    userExportFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:PutObject',
        ],
        resources: [
          props.archiveBucket.bucketArn,
          `${props.archiveBucket.bucketArn}/*`,
          props.temporaryBucket.bucketArn,
          `${props.temporaryBucket.bucketArn}/*`,
        ],
      }),
    );
    const userExport = new LambdaInvoke(this, description + 'UserExport', {
      stateName: 'Export users',
      lambdaFunction: userExportFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
        bucketName: JsonPath.stringAt('$.destination.bucketName'),
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
          output: JsonPath.stringAt('$.destination.bucketName'),
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

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendUserExportEvent', {
      stateName: 'Send TENANT_EXPORT_DATA_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataExportSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          bucketName: JsonPath.stringAt('$.destination.bucketName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getStackDetails
      .next(chooseBucket)
      .next(userExport)
      .next(sendSuccessEvent)
      .next(callback);


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Export tenant users',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantUserExport',
      role: role,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantUserExportRequest, sfn);

  }
}

export interface TenantUserImportProps {
  logGroup: LogGroup;
  archiveBucket: Bucket;
  temporaryBucket: Bucket;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Input:
//  tenantId: string;
//  stackName: string;
//  exportType: ExportType;
export class TenantUserImport extends Construct {
  constructor(scope: Construct, id: string, props: TenantUserImportProps) {
    super(scope, id);

    const description = 'TenantUserImport';

    const typeOfExport = new Choice(this, description + 'ChoiceDestination', {
      stateName: 'Choose a destination bucket',
    });
    const archiveDataCondition = Condition.stringEquals('$.detail.exportType', ExportType.Archive);
    const useArchiveBucket = new Pass(this, description + 'LongTermBucket', {
      stateName: 'Use long term bucket (archive)',
      result: TaskInput.fromObject({
        bucketName: props.archiveBucket.bucketName,
      }),
      resultPath: '$.destination',
    });
    const useTemporaryBucket = new Pass(this, description + 'ShortTermBucket', {
      stateName: 'Use short term bucket',
      result: TaskInput.fromObject({
        bucketName: props.temporaryBucket.bucketName,
      }),
      resultPath: '$.destination',
    });
    const chooseBucket = typeOfExport
      .when(archiveDataCondition, useArchiveBucket)
      .otherwise(useTemporaryBucket)
      .afterwards();

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
      stateName: 'Send TENANT_USER_IMPORT_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantUserImportSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack userPoolId',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        tier: JsonPath.stringAt('$.Payload.cell.tier'),
        userPoolId: JsonPath.stringAt('$.Payload.cell.userPoolId'),
      },
      resultPath: '$.stack',
    });

    const userImportFn = new NodejsFunction(this, description + 'UserImportFn', {
      entry: __dirname + '/tenant-user-mgmt.function.ts',
      runtime: runtime,
      handler: 'userImport',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(5),
      logGroup: props.logGroup,
    });
    props.archiveBucket.grantRead(userImportFn.role as Role);
    props.temporaryBucket.grantRead(userImportFn.role as Role);
    userImportFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
        ],
        resources: [
          'arn:' + Aws.PARTITION + ':cognito-idp:' + Aws.REGION + ':' + Aws.ACCOUNT_ID + ':userpool/*',
        ],
      }),
    );

    const userImport = new LambdaInvoke(this, description + 'UserImport', {
      stateName: 'Delete tenant users from user pool',
      lambdaFunction: userImportFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tier: JsonPath.stringAt('$.stack.tier'),
        userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
        bucketName: JsonPath.stringAt('$.destination.bucketName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getStackDetails
      .next(chooseBucket)
      .next(userImport)
      .next(sendSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Import tenant users',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-' + description,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantUserImportRequest, sfn);
  }
}


export interface TenantUserDeleteProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Input:
//  tenantId: string;
//  stackName: string;
export class TenantUserDelete extends Construct {
  constructor(scope: Construct, id: string, props: TenantUserDeleteProps) {
    super(scope, id);

    const description = 'TenantUserDelete';

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
      stateName: 'Send TENANT_USER_DELETE_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantUserDeleteSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack userPoolId',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        userPoolId: JsonPath.stringAt('$.Payload.cell.userPoolId'),
      },
      resultPath: '$.stack',
    });

    const userDeleteFn = new NodejsFunction(this, description + 'UserDeleteFn', {
      entry: __dirname + '/tenant-user-mgmt.function.ts',
      runtime: runtime,
      handler: 'userDelete',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(5),
      logGroup: props.logGroup,
    });
    userDeleteFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:ListUsers',
        ],
        resources: [
          'arn:' + Aws.PARTITION + ':cognito-idp:' + Aws.REGION + ':' + Aws.ACCOUNT_ID + ':userpool/*',
        ],
      }),
    );

    const userDelete = new LambdaInvoke(this, description + 'UserDelete', {
      stateName: 'Delete tenant users from user pool',
      lambdaFunction: userDeleteFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        userPoolId: JsonPath.stringAt('$.stack.userPoolId'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getStackDetails
      .next(userDelete)
      .next(sendSuccessEvent)
      .next(callback);

    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Delete tenant users',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-TenantUserDelete',
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantUserDeleteRequest, sfn);
  }
}