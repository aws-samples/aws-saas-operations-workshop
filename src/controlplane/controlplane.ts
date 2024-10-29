import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { BlockPublicAccess, Bucket, BucketEncryption, StorageClass } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { applicationName } from '../config';
import { Dashboards } from './dashboards/dashboards';
import { ControlPlaneEventBus } from './event-bus/event-bus';
//@ts-ignore
import { LoadTesting } from './load-testing/load-testing'; // eslint-disable-line
import { ResourceMgmt } from './resource-mgmt/resource-mgmt';
import { TenantMgmt } from './tenant-mgmt/tenant-mgmt';

export enum TenantActivationStatus {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
}

export class ControlPlaneStack extends Stack {
  public readonly tenantCatalog: TableV2;
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const description = 'Controlplane';

    this.tenantCatalog = new TableV2(this, description + 'Table', {
      tableName: applicationName + '-TenantCatalog',
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const eventBus = new ControlPlaneEventBus(this, description + 'EventBus');

    // archive offboarded tenants data
    const archiveBucket = new Bucket(this, description+'ArchiveBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      lifecycleRules: [{
        transitions: [
          {
            storageClass: StorageClass.GLACIER,
            transitionAfter: Duration.days(30),
          },
        ],
      }],
    });
    archiveBucket.addLifecycleRule({
      id: 'DeleteAfter7Years',
      expiration: Duration.days(365*7),
    });

    new CfnOutput(this, 'ArchiveBucketOutput', {
      key: 'ArchiveBucket',
      value: archiveBucket.bucketName,
    });

    // temporary bucket for tenant migration
    const temporaryBucket = new Bucket(this, description+'TempBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
    });
    temporaryBucket.addLifecycleRule({
      id: 'DeleteAfter1Day',
      expiration: Duration.days(1),
    });

    new CfnOutput(this, 'TemporaryBucketOutput', {
      key: 'TemporaryBucket',
      value: temporaryBucket.bucketName,
    });

    const resourceMgmt = new ResourceMgmt(this, 'RM', {
      eventBus: eventBus,
      tenantCatalog: this.tenantCatalog,
    });

    new TenantMgmt(this, 'TM', {
      eventBus: eventBus,
      tenantCatalog: this.tenantCatalog,
      archiveBucket: archiveBucket,
      temporaryBucket: temporaryBucket,
      readStackEntry: resourceMgmt.readCellEntryFn,
    });

    //LAB5-TODO-LOADTEST
    //new LoadTesting(this, 'LT', {
    //  eventBus: eventBus,
    //  tenantCatalog: this.tenantCatalog,
    //});
    //LAB5-END

    new Dashboards(this, 'DB');
  }
}