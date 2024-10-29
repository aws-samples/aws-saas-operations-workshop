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

export interface TenantDataExportProps {
  logGroup: LogGroup;
  archiveBucket: Bucket;
  temporaryBucket: Bucket;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Input
//  tenantId: string; - tenant to export
//  stackName: string; - stack to export from
//  exportType: ExportType; - which bucket to export to (Archive or temporary)
export class TenantDataExport extends Construct {
  constructor(scope: Construct, id: string, props: TenantDataExportProps) {
    super(scope, id);
    const description = 'TenantDataExport';

    const role = new Role(this, description + 'Role', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
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
    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack data table details',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        tableName: JsonPath.stringAt('$.Payload.cell.dataTableName'),
      },
      resultPath: '$.stack',
    });

    const dataExportFn = new NodejsFunction(this, description + 'DataExportFn', {
      entry: __dirname + '/tenant-data-mgmt.function.ts',
      runtime: runtime,
      handler: 'dataExport',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(15),
      logGroup: props.logGroup,
    });
    dataExportFn.role?.addToPrincipalPolicy(
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
    dataExportFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:Query',
        ],
        resources: [
          '*',
        ],
      }),
    );

    const dataExport = new LambdaInvoke(this, description + 'DataExport', {
      stateName: 'Export tenant data',
      lambdaFunction: dataExportFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tableName: JsonPath.stringAt('$.stack.tableName'),
        bucketName: JsonPath.stringAt('$.destination.bucketName'),
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

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send TENANT_DATA_EXPORT_SUCCESS to event bus',
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

    const sfnDefinition = chooseBucket
      .next(getStackDetails)
      .next(dataExport)
      .next(sendSuccessEvent)
      .next(callback);


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Export tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-' + description,
      role: role,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantDataExportRequest, sfn);

  }
}

export interface TenantDataImportProps {
  logGroup: LogGroup;
  archiveBucket: Bucket;
  temporaryBucket: Bucket;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Input
//  tenantId: string; - tenant to import
//  stackName: string; - stack to import to
//  exportType: ExportType; - which bucket to import from (Archive or temporary)
export class TenantDataImport extends Construct {
  constructor(scope: Construct, id: string, props: TenantDataImportProps) {
    super(scope, id);
    const description = 'TenantDataImport';

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
    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack data table details',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        tableName: JsonPath.stringAt('$.Payload.cell.dataTableName'),
      },
      resultPath: '$.stack',
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
    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send TENANT_DATA_IMPORT_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataImportSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
          stackName: JsonPath.stringAt('$.detail.stackName'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const dataImportFn = new NodejsFunction(this, description + 'DataImportFn', {
      entry: __dirname + '/tenant-data-mgmt.function.ts',
      runtime: runtime,
      handler: 'dataImport',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(15),
      logGroup: props.logGroup,
    });
    props.archiveBucket.grantRead(dataImportFn.role as Role);
    props.temporaryBucket.grantRead(dataImportFn.role as Role);
    dataImportFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:BatchWriteItem',
        ],
        resources: [
          'arn:aws:dynamodb:' + Aws.REGION + ':' + Aws.ACCOUNT_ID + ':table/SaaSOpsV2-cell-*',
        ],
      }),
    );

    const dataImport = new LambdaInvoke(this, description + 'DataImport', {
      stateName: 'Export tenant data',
      lambdaFunction: dataImportFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tableName: JsonPath.stringAt('$.stack.tableName'),
        bucketName: JsonPath.stringAt('$.destination.bucketName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = chooseBucket
      .next(getStackDetails)
      .next(dataImport)
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

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantDataImportRequest, sfn);
  }
}

export interface TenantDataDeleteProps {
  logGroup: LogGroup;
  eventBus: ControlPlaneEventBus;
  readStackEntry: NodejsFunction;
}

//Input:
//  tenantId: string; - tenant to delete
//  stackName: string; - stack to delete data from
export class TenantDataDelete extends Construct {
  constructor(scope: Construct, id: string, props: TenantDataDeleteProps) {
    super(scope, id);
    const description = 'TenantDataDelete';

    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack data table details',
      lambdaFunction: props.readStackEntry,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.detail.stackName'),
      }),
      resultSelector: {
        tableName: JsonPath.stringAt('$.Payload.cell.dataTableName'),
      },
      resultPath: '$.stack',
    });

    const dataDeleteFn = new NodejsFunction(this, description + 'DataDeleteFn', {
      entry: __dirname + '/tenant-data-mgmt.function.ts',
      runtime: runtime,
      handler: 'dataDelete',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.minutes(15),
      logGroup: props.logGroup,
    });
    dataDeleteFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:Query',
          'dynamodb:DeleteItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: [
          'arn:aws:dynamodb:' + Aws.REGION + ':' + Aws.ACCOUNT_ID + ':table/SaaSOpsV2-cell-*',
        ],
      }),
    );
    const dataDelete = new LambdaInvoke(this, description + 'DataDelete', {
      stateName: 'Delete tenant data',
      lambdaFunction: dataDeleteFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.detail.tenantId'),
        tableName: JsonPath.stringAt('$.stack.tableName'),
      }),
      resultPath: JsonPath.DISCARD,
    });

    const sendSuccessEvent = new EventBridgePutEvents(this, description + 'SendSuccessEvent', {
      stateName: 'Send TENANT_DATA_DELETE_SUCCESS to event bus',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.TenantDataDeleteSuccess,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          stackName: JsonPath.stringAt('$.detail.stackName'),
          tenantId: JsonPath.stringAt('$.detail.tenantId'),
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
          output: JsonPath.stringAt('$.detail.tenantId'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });

    const sfnDefinition = getStackDetails
      .next(dataDelete)
      .next(sendSuccessEvent)
      .next(taskTokenPresent
        .when(taskTokenPresentCondition, taskTokenPresentYes
          .next(sendSfnSuccessCallbackEvent),
        )
        .otherwise(taskTokenPresentNo)
        .afterwards(),
      );


    const sfn = new StateMachine(this, description + 'Sfn', {
      definitionBody: DefinitionBody.fromChainable(sfnDefinition),
      timeout: Duration.minutes(15),
      comment: 'Delete tenant data',
      logs: {
        destination: props.logGroup,
      },
      stateMachineName: applicationName + '-' + description,
      tracingEnabled: true,
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.TenantDataDeleteRequest, sfn);
  }
}