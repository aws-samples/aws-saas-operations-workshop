import { Duration, StackProps } from 'aws-cdk-lib';
import { TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { AppLogGroup } from './log-group.construct';
import { StackDescription } from '../helper/helper.types';

export interface AuthorizerProps extends StackProps {
  adminRoleArn: string;
  userRoleArn: string;
  clientId: string;
  userPoolId: string;
  authorizerRole: Role;
  stackDescription: StackDescription;
}

export class Authorizer extends Construct {
  public readonly authorizer: TokenAuthorizer;
  constructor(scope: Construct, id: string, props: AuthorizerProps) {
    super(scope, id);
    const logGroup = new AppLogGroup(this, 'LogGroup', {
      name: 'tenantauthorizer',
      stackDescription: props.stackDescription,
    }).logGroup;
    const authorizerFn = new NodejsFunction(this, 'TenantAuthorizerFn', {
      entry: __dirname + '/../functions/authorizer.function.ts',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'handler',
      environment: {
        NODE_OPTIONS: '--enable-source-maps', // see https://docs.aws.amazon.com/lambda/latest/dg/typescript-exceptions.html
        TENANT_ADMIN_ROLE_ARN: props.adminRoleArn,
        TENANT_USER_ROLE_ARN: props.userRoleArn,
        USERPOOL_ID: props.userPoolId,
        CLIENT_ID: props.clientId,
        POWERTOOLS_SERVICE_NAME: 'authorizer',
        POWERTOOLS_METRICS_NAMESPACE: props.stackDescription.applicationName,
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: logGroup,
      role: props.authorizerRole,
    });
    this.authorizer = new TokenAuthorizer(this, 'Authorizer', {
      handler: authorizerFn,
    });
  }
}