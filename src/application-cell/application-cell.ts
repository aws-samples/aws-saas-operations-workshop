import { Aws, CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { Construct } from 'constructs';
import { applicationName } from '../config';
import { ApplicationApi } from './constructs/api';
import { ApplicationAuthorizer } from './constructs/authorizer';
import { ApplicationTable } from './constructs/data';
import { ApplicationIdentityProvider } from './constructs/identity-provider';
import { ApplicationRoles } from './constructs/roles';

export interface ProductInput {
  category: string;
  name: string;
  price: number;
  sku: string;
}

export interface Product extends ProductInput {
  productId: string;
}

export interface TenantProduct extends Product {
  tenantId: string;
}
export interface TenantCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export interface OrderInputLine {
  productId: string;
  quantity: number;
}

export interface OrderInput {
  lines: OrderInputLine[];
}

export interface Order extends OrderInput {
  orderId: string;
}

export interface OrderLine extends OrderInputLine {
  lineNumber: string;
  orderId: string;
}

export interface TenantOrderLine extends OrderLine {
  tenantId: string;
}

export interface TenantContext {
  tenantId: string;
  role: string;
  tier: string;
}

export function getTenantCredentialsFromEvent(event: APIGatewayProxyEvent) {
  return {
    accessKeyId: event.requestContext.authorizer?.accessKeyId,
    secretAccessKey: event.requestContext.authorizer?.secretAccessKey,
    sessionToken: event.requestContext.authorizer?.sessionToken,
  } as TenantCredentials;
}

export function getTenantContext(event: APIGatewayProxyEvent) {
  return {
    tenantId: event.requestContext.authorizer?.tenantId,
    role: event.requestContext.authorizer?.role,
    tier: event.requestContext.authorizer?.tier,
  } as TenantContext;
}

export class ApplicationCellStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const cellId = Aws.STACK_NAME.replace(applicationName + '-cell-', '');

    const roles = new ApplicationRoles(this, 'Roles');

    const identity = new ApplicationIdentityProvider(this, 'Identity', { cellId: cellId });
    identity.grantTenantWrite(roles.adminRole);

    const authorizer = new ApplicationAuthorizer(this, 'TenantAuthorizer', {
      authorizerRole: roles.authorizerRole,
      adminRoleArn: roles.adminRole.roleArn,
      userRoleArn: roles.userRole.roleArn,
      userPoolId: identity.userPool.userPoolId,
      clientId: identity.userPoolClient.userPoolClientId,
      cellId: cellId,
    });

    const data = new ApplicationTable(this, 'Data', { cellId: cellId });
    data.grantWrite(roles.adminRole);
    data.grantWrite(roles.userRole);

    const api = new ApplicationApi(this, 'TenantApi', { cellId: cellId });
    api.addService(
      __dirname + '/functions/products.ts',
      'products',
      authorizer.authorizer,
      {
        TABLE_NAME: data.table.tableName,
      },
    );
    api.addService(
      __dirname + '/functions/orders.ts',
      'orders',
      authorizer.authorizer,
      {
        TABLE_NAME: data.table.tableName,
      },
    );
    api.addService(
      __dirname + '/functions/users.ts',
      'users',
      authorizer.authorizer,
      {
        USER_POOL_ID: identity.userPool.userPoolId,
      },
      [HttpMethod.POST, HttpMethod.DELETE],
    );
    api.addService(
      __dirname + '/functions/auth.ts',
      'auth',
      undefined,
      {
        CLIENT_ID: identity.userPoolClient.userPoolClientId,
      },
      [HttpMethod.POST],
    );

    new CfnOutput(this, 'ApiUrl', {
      key: 'ApiUrl',
      value: api.api.url,
    });
    new CfnOutput(this, 'UserPoolId', {
      key: 'UserPoolId',
      value: identity.userPool.userPoolId,
    });
    new CfnOutput(this, 'ClientId', {
      key: 'ClientId',
      value: identity.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'DataTableName', {
      key: 'DataTableName',
      value: data.table.tableName,
    });
    new CfnOutput(this, 'DataTableArn', {
      key: 'DataTableArn',
      value: data.table.tableArn,
    });
  }
}