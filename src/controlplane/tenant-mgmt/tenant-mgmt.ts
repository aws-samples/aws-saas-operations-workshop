import { Aws, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { TenantAPIUsagePlans } from './tenant-apiusageplans';
//@ts-ignore
import { TenantDataDelete, TenantDataExport, TenantDataImport } from './tenant-data-mgmt'; // eslint-disable-line
//@ts-ignore
import { TenantUserDelete, TenantUserExport, TenantUserImport } from './tenant-user-mgmt'; // eslint-disable-line
//@ts-ignore
import { TenantOffboarding } from './tenant-offboarding'; // eslint-disable-line
//@ts-ignore
import { TenantOnboarding } from './tenant-onboarding'; // eslint-disable-line
//@ts-ignore
import { TenantExport } from './tenant-export'; // eslint-disable-line
//@ts-ignore
import { TenantDelete } from './tenant-delete'; // eslint-disable-line
//@ts-ignore
import { TenantImport } from './tenant-import'; // eslint-disable-line
//@ts-ignore
import { TenantMigrate } from './tenant-migrate'; // eslint-disable-line
//@ts-ignore
import { TenantRestore } from './tenant-restore'; // eslint-disable-line
import { runtime, TenantTier } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'TenantMgmt';
const stackName = Aws.STACK_NAME;

/**
 * TenantMgmt DynamoDB data model
 *
 * Tenant description - getTenant(tenantId), getTenants()
 * pk: 'DESCRIPTION#',
 * sk: 'TENANT#'+tenantId,
 * apiKey: string,
 * tenantName: string,
 * tier: TenantTier,
 * stackName?: 'STACK#'+stackName,
 * status?: TenantStatus,
 * gsiStackSk: 'TENANT#'+tenantId,
 *
 * GSI - Stack to tenant relationship - getTenants(stackName)
 * pk: stackName,
 * sk: gsiStackSk,
 *
 */

export interface TenantMgmtProps {
  eventBus: ControlPlaneEventBus;
  tenantCatalog: TableV2;
  archiveBucket: Bucket;
  temporaryBucket: Bucket;
  readStackEntry: NodejsFunction;
}

export class TenantMgmt extends Construct {
  public readonly deleteStackTenantMappingEntry: NodejsFunction;
  public readonly updateStackTenantMappingEntry: NodejsFunction;
  public readonly deleteTenantEntry: NodejsFunction;
  public readonly readTenantEntry: NodejsFunction;
  public readonly updateTenantEntry: NodejsFunction;
  constructor(scope: Construct, id: string, props: TenantMgmtProps) {
    super(scope, id);

    const logGroup = new LogGroup(this, description + 'LogGroup', {
      logGroupName: '/' + stackName + '/' + description,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.deleteStackTenantMappingEntry = new NodejsFunction(this, description + 'DeleteStackTenantMappingFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'deleteStackTenantMapping',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.deleteStackTenantMappingEntry.role as Role);

    this.updateStackTenantMappingEntry = new NodejsFunction(this, description + 'UpdateStackTenantMappingFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'createStackTenantMapping',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.updateStackTenantMappingEntry.role as Role);

    this.deleteTenantEntry = new NodejsFunction(this, description + 'DeleteTenantEntryFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'deleteTenantEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.deleteTenantEntry.role as Role);

    this.readTenantEntry = new NodejsFunction(this, description + 'ReadTenantEntryFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'getTenant',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadData(this.readTenantEntry.role as Role);
    this.readTenantEntry.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:ListStacks',
          'cloudformation:DescribeStacks',
        ],
        resources: ['*'],
      }),
    );

    this.updateTenantEntry = new NodejsFunction(this, description + 'UpdateTenantEntryFn', {
      entry: __dirname + '/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'updateTenantEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.updateTenantEntry.role as Role);

    new TenantOnboarding(this, description + 'Onboarding', {
      eventBus: props.eventBus,
      tenantCatalog: props.tenantCatalog,
      logGroup: logGroup,
      updateStackTenantMappingEntry: this.updateStackTenantMappingEntry,
    });

    new TenantOffboarding(this, description + 'Offboarding', {
      eventBus: props.eventBus,
      tenantCatalog: props.tenantCatalog,
      logGroup: logGroup,
      deleteStackTenantMappingEntry: this.deleteStackTenantMappingEntry,
      deleteTenantEntry: this.deleteTenantEntry,
      readTenantEntry: this.readTenantEntry,
      readStackEntry: props.readStackEntry,
      updateTenantEntry: this.updateTenantEntry,
    });

    //LAB1-TODO-USEREXPORT
    //new TenantUserExport(this, description + 'TenantExportUsers', {
    //  eventBus: props.eventBus,
    //  archiveBucket: props.archiveBucket,
    //  temporaryBucket: props.temporaryBucket,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry,
    //});
    //LAB1-END

    //LAB1-TODO-DATAEXPORT
    //new TenantDataExport(this, description + 'TenantDataExport', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  archiveBucket: props.archiveBucket,
    //  temporaryBucket: props.temporaryBucket,
    //  readStackEntry: props.readStackEntry,
    //})
    //LAB1-END

    //LAB1-TODO-EXPORT
    //new TenantExport(this, description + 'TenantExport', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readTenantEntry: this.readTenantEntry,
    //})
    //LAB1-END

    //LAB2-TODO-OFFBOARDING
    //new TenantDataDelete(this, description + 'TenantDataDelete', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry
    //})
    //
    //new TenantUserDelete(this, description + 'TenantUserDelete', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry
    //})
    //
    //new TenantDelete(this, description + 'TenantDelete', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry
    //})
    //LAB2-END

    //LAB3-TODO-RESTORE
    //new TenantDataImport(this, description + 'TenantDataImport', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry,
    //  archiveBucket: props.archiveBucket,
    //  temporaryBucket: props.temporaryBucket,
    //})
    //
    //new TenantUserImport(this, description + 'TenantUserImport', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readStackEntry: props.readStackEntry,
    //  archiveBucket: props.archiveBucket,
    //  temporaryBucket: props.temporaryBucket,
    //})
    //
    //new TenantImport(this, description + 'TenantImport', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //})
    //
    //new TenantRestore(this, description + 'TenantRestore', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  readTenantEntry: this.readTenantEntry,
    //  updateTenantEntry: this.updateTenantEntry,
    //})
    //LAB3-END

    //LAB4-TODO-MIGRATE
    //new TenantMigrate(this, description + 'TenantMigrate', {
    //  eventBus: props.eventBus,
    //  logGroup: logGroup,
    //  deleteStackTenantMappingEntry: this.deleteStackTenantMappingEntry,
    //  readTenantEntry: this.readTenantEntry,
    //  updateTenantEntry: this.updateTenantEntry,
    //  tenantCatalog: props.tenantCatalog,
    //  updateStackTenantMappingEntry: this.updateStackTenantMappingEntry
    //})
    //LAB4-END

    const apiUsagePlans = new TenantAPIUsagePlans(this, description + 'APIUsagePlans', {
      plans: [
        {
          tier: TenantTier.Basic.toString(),
          requestPerSec: 5,
          concurrentRequests: 2,
          quota: {
            requests: 20000,
            period: 'DAY',
          },
        },
        {
          tier: TenantTier.Premium.toString(),
          requestPerSec: 20,
          concurrentRequests: 10,
        },
      ],
    });

    new AwsCustomResource(this, description + 'APIUsagePlanEntryCustomResource', {
      onCreate: {
        service: 'DynamoDB',
        action: 'batchWriteItem',
        parameters: {
          RequestItems: {
            [props.tenantCatalog.tableName]: [
              ...this.transformUsagePlanRecordsForDynamoDB(apiUsagePlans.usagePlanIds),
            ],
          },
        },
        physicalResourceId: PhysicalResourceId.of('APIUsagePlanEntryCustomResource'),
      },

      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [props.tenantCatalog.tableArn] }),

      onDelete: {
        service: 'DynamoDB',
        action: 'batchWriteItem',
        parameters: {
          RequestItems: {
            [props.tenantCatalog.tableName]: [
              ...Object.keys(apiUsagePlans.usagePlanIds).map((tier) => (
                {
                  DeleteRequest: {
                    Key: {
                      pk: { S: 'DESCRIPTION#' },
                      sk: { S: 'USAGEPLAN#' + tier },
                    },
                  },
                }
              )),
            ],
          },
        },
      },
    });

  }

  private transformUsagePlanRecordsForDynamoDB(usagePlanIds: { [tier: string]: string }) {
    return Object.keys(usagePlanIds).map((tier) => {
      return {
        PutRequest: {
          Item: {
            pk: { S: 'DESCRIPTION#' },
            sk: { S: 'USAGEPLAN#' + tier },
            planId: { S: usagePlanIds[tier] },
          },
        },
      };
    });
  }
}
