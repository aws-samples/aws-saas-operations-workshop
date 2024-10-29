import { Duration, StackProps } from 'aws-cdk-lib';
import { TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { CommonLogGroup } from './log-group';
import { applicationName } from '../../config';

export interface ApplicationAuthorizerProps extends StackProps {
  adminRoleArn: string;
  userRoleArn: string;
  clientId: string;
  userPoolId: string;
  authorizerRole: Role;
  cellId: string;
}

export class ApplicationAuthorizer extends Construct {
  public readonly authorizer: TokenAuthorizer;
  constructor(scope: Construct, id: string, props: ApplicationAuthorizerProps) {
    super(scope, id);
    const logGroup = new CommonLogGroup(this, 'LogGroup', {
      name: 'tenantauthorizer',
      cellId: props.cellId,
    }).logGroup;

    const tenantCatalog = TableV2.fromTableName(this, 'TenantCatalog', applicationName + '-TenantCatalog');
    tenantCatalog.grantReadData(props.authorizerRole);

    const authorizerFn = new NodejsFunction(this, 'TenantAuthorizerFn', {
      entry: __dirname + '/../functions/authorizer.ts',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'handler',
      environment: {
        TENANT_ADMIN_ROLE_ARN: props.adminRoleArn,
        TENANT_USER_ROLE_ARN: props.userRoleArn,
        USERPOOL_ID: props.userPoolId,
        CLIENT_ID: props.clientId,
        POWERTOOLS_SERVICE_NAME: 'authorizer',
        POWERTOOLS_METRICS_NAMESPACE: applicationName,
        LOG_LEVEL: 'INFO',
        TENANT_CATALOG_TABLE: tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
      role: props.authorizerRole,
    });
    this.authorizer = new TokenAuthorizer(this, 'Authorizer', {
      handler: authorizerFn,
      resultsCacheTtl: Duration.hours(1),
    });
  }
}