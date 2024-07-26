import { APIGatewayProxyEvent } from 'aws-lambda';
import { TenantContext, TenantCredentials } from './helper.types';

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