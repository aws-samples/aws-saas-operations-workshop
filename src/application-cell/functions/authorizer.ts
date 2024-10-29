import 'source-map-support/register';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { PolicyDocument, Statement } from 'aws-lambda';
import { APIGatewayAuthorizerResult, APIGatewayTokenAuthorizerEvent } from 'aws-lambda/trigger/api-gateway-authorizer';
import { TenantRole, TenantStatus } from '../../config';
import { TenantCredentials } from '../application-cell';

const userPolicySlugs = {
  'orders': [HttpMethod.GET, HttpMethod.POST],
  'orders/*': [HttpMethod.DELETE, HttpMethod.PUT],
  'products': [HttpMethod.GET, HttpMethod.POST],
  'products/*': [HttpMethod.DELETE, HttpMethod.PUT],
};
const adminPolicySlugs = {
  'users': [HttpMethod.POST],
  'users/*': [HttpMethod.PUT, HttpMethod.DELETE],
  ...userPolicySlugs,
};

const roleToPolicy = new Map();
roleToPolicy.set(TenantRole.Admin, adminPolicySlugs);
roleToPolicy.set(TenantRole.User, userPolicySlugs);

const stsClient = new STSClient();
const dynamoDBClient = new DynamoDBClient();


async function assumeTenantRole(tenantId: string, roleArn: string, transactionId: string): Promise<TenantCredentials> {
  const assumeRoleCommand = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: transactionId,
    Tags: [
      {
        Key: 'tenantId',
        Value: tenantId,
      },
    ],
  });
  const response = await stsClient.send(assumeRoleCommand);
  const creds = response.Credentials;
  return {
    accessKeyId: creds?.AccessKeyId,
    secretAccessKey: creds?.SecretAccessKey,
    sessionToken: creds?.SessionToken,
  } as TenantCredentials;
};

function getPolicyDocument(tenantRole: TenantRole, methodArn: string): PolicyDocument {
  const arnPrefix = methodArn.split('/')[0] + '/*';
  const policySlug = roleToPolicy.get(tenantRole);
  let resources: string[] = [];
  Object.keys(policySlug).forEach(key => {
    Object.keys(policySlug[key]).forEach(operation => {
      resources.push(arnPrefix + '/' + policySlug[key][operation] + '/' + key);
    });
  });
  const policy: Statement = {
    Action: 'execute-api:Invoke',
    Effect: 'Allow',
    Resource: resources,
  };
  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
      policy,
    ],
  };
  return policyDocument;
}

const roleToRoleArnMap = new Map();
roleToRoleArnMap.set(TenantRole.Admin, process.env.TENANT_ADMIN_ROLE_ARN as string);
roleToRoleArnMap.set(TenantRole.User, process.env.TENANT_USER_ROLE_ARN as string);

const defaultDenyAllPolicy: APIGatewayAuthorizerResult = {
  principalId: 'user',
  policyDocument: {
    Version: '2012-10-17',
    Statement: [
      {
        Action: '*',
        Effect: 'Deny',
        Resource: '*',
      },
    ],
  },
};

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USERPOOL_ID as string,
  tokenUse: 'access',
  clientId: process.env.CLIENT_ID,
});

const getApiKeyForTenant = async (tenantId: string) => {
  const input = {
    TableName: process.env.TENANT_CATALOG_TABLE as string,
    Key: {
      pk: { S: 'DESCRIPTION#' },
      sk: { S: 'TENANT#' + tenantId },
    },
  };
  const command = new GetItemCommand(input);
  const response = await dynamoDBClient.send(command);
  if (response.Item?.status?.S !== TenantStatus.Active) {
    return undefined;
  }
  return response.Item?.apiKey?.S;
};

export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const transactionId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
  const token = event.authorizationToken.split(' ');
  console.log('ARN ' + event.methodArn);
  if (token[0] !== 'Bearer') {
    return defaultDenyAllPolicy;
  }
  const jwt = token[1];
  try {
    // @ts-ignore
    const verifiedJwt = await verifier.verify(jwt);
    const parsedVerifiedJwt = JSON.parse(JSON.stringify(verifiedJwt));
    const tenantApiKey = await getApiKeyForTenant(parsedVerifiedJwt.tenantId);
    if (!tenantApiKey) {
      console.log('Active Tenant API Key not found');
      return defaultDenyAllPolicy;
    }
    const tenantRoleArn = roleToRoleArnMap.get(parsedVerifiedJwt.role);
    const tenantCredentials = await assumeTenantRole(parsedVerifiedJwt.tenantId, tenantRoleArn, transactionId);

    const context = {
      role: parsedVerifiedJwt.role,
      tenantId: parsedVerifiedJwt.tenantId,
      tier: parsedVerifiedJwt.tier,
      transactionId: transactionId,
      accessKeyId: tenantCredentials.accessKeyId,
      secretAccessKey: tenantCredentials.secretAccessKey,
      sessionToken: tenantCredentials.sessionToken,
    };

    const policyDocument = getPolicyDocument(parsedVerifiedJwt.role, event.methodArn);


    const response: APIGatewayAuthorizerResult = {
      principalId: parsedVerifiedJwt.sub,
      context,
      usageIdentifierKey: tenantApiKey,
      policyDocument,
    };
    console.log('Response: ', JSON.stringify(response));
    return response;
  } catch (error) {
    console.log('Token not valid!', error);
    return defaultDenyAllPolicy;
  }
};
