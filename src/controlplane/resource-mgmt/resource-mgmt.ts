import { Aws, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { BuildSpec, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { AttributeType, ProjectionType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Role } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as S3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { CellDeprovisioning } from './resource-stack-deprovisioning';
import { CellProvisioning } from './resource-stack-provisioning';
import { applicationName, codeBuildBuildImage, codeBuildComputeType, runtime } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

/**
 * CellMgmt DynamoDB data model
 *
 * Stack description - getStack(stackName), getStacks()
 * pk: 'STACK#'+stackName,
 * sk: 'DESCRIPTION#',
 * status: Status,
 * clientId: string,
 * url: string,
 * userpoolId: string,
 * tier: 'TIER#'+cell.tier,
 * gsiTierSk: 'STACK#'+cell.stackName,
 *
 * GSI - Tier to Stack relationship - getStacks(tier)
 * pk: tier, // Tier
 * sk: gsiTierSk, // Stack
 *
 */

const description = 'ResourceMgmt';
const stackName = Aws.STACK_NAME;

export const cellMgmtGsi = 'gsiTier';

export interface CellMgmtProps {
  eventBus: ControlPlaneEventBus;
  tenantCatalog: TableV2;
}

export class ResourceMgmt extends Construct {
  public readonly deleteCellEntryFn: NodejsFunction;
  public readonly readCellEntryFn: NodejsFunction;
  public readonly updateCellEntryFn: NodejsFunction;
  constructor(scope: Construct, id: string, props: CellMgmtProps) {
    super(scope, id);

    const logGroup = new LogGroup(this, description + 'LogGroup', {
      logGroupName: '/' + stackName + '/' + description,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    props.tenantCatalog.addGlobalSecondaryIndex({
      indexName: cellMgmtGsi,
      partitionKey: { name: 'tier', type: AttributeType.STRING }, // Tier
      sortKey: { name: 'gsiTierSk', type: AttributeType.STRING }, // Stack
      projectionType: ProjectionType.KEYS_ONLY,
    });

    this.deleteCellEntryFn = new NodejsFunction(this, description + 'DeleteCellEntryFn', {
      functionName: stackName + '-' + description + '-DeleteCellEntry',
      entry: __dirname + '/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'deleteCellEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.deleteCellEntryFn.role as Role);

    this.readCellEntryFn = new NodejsFunction(this, description + 'ReadCellEntryFn', {
      functionName: stackName + '-' + description + '-ReadCellEntry',
      entry: __dirname + '/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'readCellEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadData(this.readCellEntryFn.role as Role);

    this.updateCellEntryFn = new NodejsFunction(this, description + 'UpdateCellEntryFn', {
      functionName: stackName + '-' + description + '-UpdateCellEntry',
      entry: __dirname + '/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'updateCellEntry',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
    });
    props.tenantCatalog.grantReadWriteData(this.updateCellEntryFn.role as Role);

    const codeBucket = new Bucket(this, description + 'Bucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const bucketDeployment = new S3Deployment.BucketDeployment(this, description + 'BucketDeployment', {
      destinationBucket: codeBucket,
      sources: [S3Deployment.Source.asset(__dirname + '/../../..', {
        exclude: [
          '.git*',
          'cdk.out',
          'coverage',
          'node_modules',
        ],
      })],
      extract: false,
      retainOnDelete: false,
    });
    const provisioningProject = new Project(this, description + 'ProvisioningProject', {
      projectName: applicationName + '-CellProvisioning',
      source: Source.s3({
        bucket: codeBucket,
        path: Fn.select(0, bucketDeployment.objectKeys),
      }),
      logging: {
        cloudWatch: {
          logGroup: logGroup,
        },
      },
      environment: {
        buildImage: codeBuildBuildImage,
        computeType: codeBuildComputeType,
      },
      buildSpec: BuildSpec.fromObject({
        version: 0.2,
        phases: {
          build: {
            commands: [
              'chmod +x ./provision_application-cell.sh',
              './provision_application-cell.sh',
            ],
          },
        },
      }),
    });
    provisioningProject.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' });
    new CellProvisioning(this, description + 'Provisioning', {
      eventBus: props.eventBus,
      logGroup: logGroup,
      project: provisioningProject,
      tenantCatalog: props.tenantCatalog,
      updateCellEntryFn: this.updateCellEntryFn,
    });
    const deprovisioningProject = new Project(this, description + 'DeprovisioningProject', {
      projectName: applicationName + '-CellDeprovisioning',
      source: Source.s3({
        bucket: codeBucket,
        path: Fn.select(0, bucketDeployment.objectKeys),
      }),
      logging: {
        cloudWatch: {
          logGroup: logGroup,
        },
      },
      environment: {
        buildImage: codeBuildBuildImage,
        computeType: codeBuildComputeType,
      },
      buildSpec: BuildSpec.fromObject({
        version: 0.2,
        phases: {
          build: {
            commands: [
              'chmod +x ./deprovision_application-cell.sh',
              './deprovision_application-cell.sh',
            ],
          },
        },
      }),
    });
    deprovisioningProject.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' });
    new CellDeprovisioning(this, description + 'Deprovisioning', {
      eventBus: props.eventBus,
      logGroup: logGroup,
      project: deprovisioningProject,
      tenantCatalog: props.tenantCatalog,
      deleteCellEntryFn: this.deleteCellEntryFn,
    });
  }
}