import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct } from 'constructs';
import { ApiService } from './constructs/api-service.construct';
import { AppApi } from './constructs/api.construct';
import { Authorizer } from './constructs/authorizer.construct';
import { ApplicationPlaneData } from './constructs/data.construct';
import { IdentityProvider } from './constructs/identity-provider.construct';
import { ApplicationPlaneRoles } from './constructs/roles.construct';
import { StackDescription } from './helper/helper.types';

export interface ApplicationPlaneStackProps extends StackProps {
  stackDescription: StackDescription;
}

export class ApplicationPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationPlaneStackProps) {
    super(scope, id, props);

    const roles = new ApplicationPlaneRoles(this, 'Roles');

    const identity = new IdentityProvider(this, 'Identity', { stackDescription: props.stackDescription });
    identity.grantTenantWrite(roles.adminRole);

    const data = new ApplicationPlaneData(this, 'Data', { stackDescription: props.stackDescription });
    data.grantTenantWrite(roles.adminRole);
    data.grantTenantWrite(roles.userRole);

    const api = new AppApi(this, 'TenantApi', { stackDescription: props.stackDescription });

    const authorizer = new Authorizer(this, 'TenantAuthorizer', {
      authorizerRole: roles.authorizerRole,
      adminRoleArn: roles.adminRole.roleArn,
      userRoleArn: roles.userRole.roleArn,
      userPoolId: identity.userPool.userPoolId,
      clientId: identity.userPoolClient.userPoolClientId,
      stackDescription: props.stackDescription,
    });

    new ApiService(this, 'ProductsService', {
      api: api.api,
      authorizer: authorizer.authorizer,
      entry: __dirname + '/functions/products.function.ts',
      serviceName: 'products',
      environment: {
        TENANT_DATA: data.table.tableName,
      },
      stackDescription: props.stackDescription,
    });

    new ApiService(this, 'OrdersService', {
      api: api.api,
      authorizer: authorizer.authorizer,
      entry: __dirname + '/functions/orders.function.ts',
      serviceName: 'orders',
      environment: {
        TENANT_DATA: data.table.tableName,
      },
      stackDescription: props.stackDescription,
    });

    new ApiService(this, 'UsersService', {
      api: api.api,
      authorizer: authorizer.authorizer,
      entry: __dirname + '/functions/users.function.ts',
      serviceName: 'users',
      environment: {
        USER_POOL_ID: identity.userPool.userPoolId,
      },
      stackDescription: props.stackDescription,
      methods: [HttpMethod.POST],
    });

    new CfnOutput(this, 'ApiUrl', {
      exportName: props.stackDescription.stackName+'ApiUrl',
      key: 'ApiUrl',
      value: api.api.url,
    });
    new CfnOutput(this, 'UserPoolId', {
      exportName: props.stackDescription.stackName+'UserPoolId',
      key: 'UserPoolId',
      value: identity.userPool.userPoolId,
    });
    new CfnOutput(this, 'ClientId', {
      exportName: props.stackDescription.stackName+'ClientId',
      key: 'ClientId',
      value: identity.userPoolClient.userPoolClientId,
    });
  }
}