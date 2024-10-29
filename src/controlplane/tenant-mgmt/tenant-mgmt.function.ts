import { randomUUID } from 'crypto';
import { APIGatewayClient, CreateApiKeyCommand, CreateUsagePlanKeyCommand } from '@aws-sdk/client-api-gateway';
import { CloudFormationClient, DescribeStacksCommand, DescribeStacksCommandInput, Output, Stack } from '@aws-sdk/client-cloudformation';
import { AdminCreateUserCommand, AdminCreateUserCommandInput, AdminSetUserPasswordCommand, AdminSetUserPasswordCommandInput, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { StatusCodes } from 'http-status-codes';
import { applicationName, sharedUserPassword, Status, Tenant, TenantRole, TenantStatus, TenantTier, TenantUser } from '../../config';

const tableName = process.env.TABLE_NAME;
const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cognitoClient = new CognitoIdentityProviderClient();
const cfnClient = new CloudFormationClient();
const apigwClient = new APIGatewayClient();

interface TenantDdbEntry {
  pk: string;
  sk: string;
  tenantName: string;
  tier: TenantTier;
  apiKey: string;
  stackName?: string;
  status?: string;
  userPoolId?: string;
}

function tenantToDdb(tenant: Tenant): TenantDdbEntry {
  return {
    pk: 'DESCRIPTION#',
    sk: 'TENANT#' + tenant.tenantId,
    tenantName: tenant.tenantName,
    tier: tenant.tier,
    apiKey: tenant.apiKey,
    stackName: 'STACK#' + tenant.stackName,
    status: tenant.status,
    userPoolId: tenant.userPoolId,
  };
}

function ddbToTenant(result: TenantDdbEntry): Tenant {
  return {
    tenantId: result.sk.replace('TENANT#', ''),
    tenantName: result.tenantName,
    tier: result.tier,
    apiKey: result.apiKey,
    stackName: result.stackName?.replace('STACK#', ''),
    status: result.status as TenantStatus,
    userPoolId: result.userPoolId,
  };
}

export const updateTenantEntry = async (event: Tenant): Promise<void> => {
  const putCommand = new PutCommand({
    TableName: tableName,
    Item: tenantToDdb(event),
  });
  try {
    await docClient.send(putCommand);
  } catch (error) {
    console.log(error);
  }
};

interface DeleteTenantEntryRequest {
  tenantId: string;
}

export const deleteTenantEntry = async (event: DeleteTenantEntryRequest) => {
  const deleteCommand = new DeleteCommand({
    TableName: tableName,
    Key: {
      pk: 'DESCRIPTION#',
      sk: 'TENANT#'+event.tenantId,
    },
  });
  try {
    await docClient.send(deleteCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Deleted tenant entry.', stackName: event.tenantId }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error deleting tenant entry.', stackName: event.tenantId, error: error }),
    };
  }
};

interface CreateTenantRequest {
  tenantName: string;
  tier: TenantTier;
}

export const createTenant = async (event: CreateTenantRequest): Promise<Tenant> => {
  const tenantId = randomUUID(); // We should probably check for collisions
  const apiKey = await createApiKeyForTenant(tenantId, event.tier);

  const tenant: Tenant = {
    tenantId: tenantId,
    tenantName: event.tenantName,
    tier: event.tier,
    apiKey: apiKey,
    status: TenantStatus.Inactive,
  };
  await updateTenantEntry(tenant);
  return tenant;
};

const createApiKeyForTenant = async (tenantId: string, tier: string) => {
  const usagePlanId = await getUsagePlanIdForTier(tier);
  const apiKey = await createApiKeyForUsagePlan(tenantId, usagePlanId);
  return apiKey;
};


const getUsagePlanIdForTier = async (tier: string) => {
  const command = new GetCommand({
    TableName: tableName,
    Key: {
      pk: 'DESCRIPTION#',
      sk: 'USAGEPLAN#' + tier,
    },
  });

  try {
    const result = await docClient.send(command);
    return result.Item?.planId;
  } catch (error) {
    console.log(error);
  }

  return '';
};

const createApiKeyForUsagePlan = async (tenantId: string, usagePlanId: string) => {
  try {
    const response = await apigwClient.send(new CreateApiKeyCommand({
      name: 'ApiKey-' + tenantId,
      description: 'ApiKey for tenant ' + tenantId,
      enabled: true,
      generateDistinctId: true,
    }));

    const apiKeyId = response.id!;
    const apiKey = response.value!;

    await apigwClient.send(new CreateUsagePlanKeyCommand({
      usagePlanId: usagePlanId,
      keyId: apiKeyId,
      keyType: 'API_KEY',
    }));

    return apiKey;
  } catch (error) {
    console.log(error);
  }

  return '';
};


interface StackTenantMapping {
  tenantId: string;
  stackName: string;
}

function stackTenantMappingToDdb(stackTenantMapping: StackTenantMapping) {
  return {
    pk: 'STACK#' + stackTenantMapping.stackName,
    sk: 'TENANT#' + stackTenantMapping.tenantId,
  };
}

export const createStackTenantMapping = async (event: StackTenantMapping) => {
  const putCommand = new PutCommand({
    TableName: tableName,
    Item: stackTenantMappingToDdb(event),
  });
  try {
    await docClient.send(putCommand);
  } catch (error) {
    console.log(error);
  }
};

export const deleteStackTenantMapping = async (event: StackTenantMapping) => {
  const deleteCommand = new DeleteCommand({
    TableName: tableName,
    Key: stackTenantMappingToDdb(event),
  });
  try {
    await docClient.send(deleteCommand);
  } catch (error) {
    console.log(error);
  }
};

interface GetTenantRequest {
  tenantId: string;
}
export interface GetTenantResponse {
  status: Status;
  tenant?: Tenant;
}
export const getTenant = async (event: GetTenantRequest): Promise<GetTenantResponse> => {
  const getCommand = new GetCommand({
    TableName: tableName,
    Key: {
      pk: 'DESCRIPTION#',
      sk: 'TENANT#' + event.tenantId,
    },
  });
  try {
    const result = await docClient.send(getCommand);
    if (result.Item) {
      const tenant = ddbToTenant(result.Item as TenantDdbEntry);
      if (!tenant.userPoolId || tenant.userPoolId === '') {
        tenant.userPoolId = await getUserPoolIdForTenantStack(tenant.stackName!);
      }
      return { status: Status.Succeeded, tenant: tenant };
    }
  } catch (error) {
    console.log(error);
  }
  return { status: Status.Failed };
};

export const deactivateTenant = async ({ tenantId }: { tenantId: string }) => {
  try {
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: {
        pk: { S: 'DESCRIPTION#' },
        sk: { S: 'TENANT#' + tenantId },
      },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': { S: TenantStatus.Inactive },
      },
    });
    await ddbClient.send(command);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const getStackDataTableDetails = async ({ stackName }: { stackName: string }) => {
  const response = { tableName: '', tableArn: '' };
  const cfnCommand = new DescribeStacksCommand({
    StackName: stackName,
  });
  try {
    const cfnResponse = await cfnClient.send(cfnCommand);
    cfnResponse.Stacks?.forEach((stack: Stack) => {
      const outputs = stack.Outputs as Output[];
      outputs.forEach((output: Output) => {
        if (output.OutputKey === 'DataTableName') {
          response.tableName = output.OutputValue as string;
        } else if (output.OutputKey === 'DataTableArn') {
          response.tableArn = output.OutputValue as string;
        }
      });
    });
    return response;
  } catch (error) {
    console.log(error);
    throw error;
  }
};


const getUserPoolIdForTenantStack = async (stackName: string) => {
  const cfnInput: DescribeStacksCommandInput = {
    StackName: stackName,
  };
  const cfnCommand = new DescribeStacksCommand(cfnInput);
  let userPoolId = '';
  try {
    const cfnResponse = await cfnClient.send(cfnCommand);
    console.log(cfnResponse);
    cfnResponse.Stacks?.forEach((stack: Stack) => {
      const outputs = stack.Outputs as Output[];
      outputs.forEach((output: Output) => {
        if (output.OutputKey === 'UserPoolId') {
          userPoolId = output.OutputValue as string;
        }
      });
    });
  } catch (error) {
    console.log(error);
    throw new Error('Stack not found');
  } finally {
    return userPoolId;
  }

};

export const createTenantAdmin = async (event: Tenant): Promise<void> => {
  const tenant = (await getTenant({ tenantId: event.tenantId })).tenant;
  if (!tenant) throw new Error('Tenant not found');
  console.log(tenant);

  const userPoolId = await getUserPoolIdForTenantStack(tenant.stackName!);

  if (userPoolId === '') throw new Error('UserPoolId not found');

  const tenantUser: TenantUser = {
    tenantId: event.tenantId,
    email: 'success+' + event.tenantId + '-Admin@simulator.amazonses.com',
    username: event.tenantId + '-Admin',
    role: TenantRole.Admin,
    tier: event.tier,
  };

  const createInput: AdminCreateUserCommandInput = {
    UserPoolId: userPoolId,
    Username: tenantUser.username,
    MessageAction: 'SUPPRESS',
    UserAttributes: [
      { Name: 'email', Value: tenantUser.email },
      { Name: 'custom:tenantId', Value: tenantUser.tenantId },
      { Name: 'custom:tier', Value: tenantUser.tier },
      { Name: 'custom:role', Value: tenantUser.role },
    ],
  };
  const createUserCommand = new AdminCreateUserCommand(createInput);

  const passwordInput: AdminSetUserPasswordCommandInput = {
    UserPoolId: userPoolId,
    Username: tenantUser.username,
    Password: sharedUserPassword,
    Permanent: true,
  };
  const setUserPasswordCommand = new AdminSetUserPasswordCommand(passwordInput);

  try {
    await cognitoClient.send(createUserCommand);
    await cognitoClient.send(setUserPasswordCommand);
  } catch (error) {
    console.log(error);
  }
};
interface CreateStackNameRequest {
  tenantId: string;
  tier: TenantTier;
}

interface CreateStackNameResponse {
  statusCode: StatusCodes;
  body: {
    stackName: string;
  };
}

export const createStackName = async (event: CreateStackNameRequest): Promise<CreateStackNameResponse> => {
  console.log(event);
  let stackName: string;
  // if tier is basic, then return the default shared pool
  if (event.tier == TenantTier.Basic) {
    stackName = applicationName + '-cell-basic';
  } else {
    stackName = applicationName + '-cell-' + event.tenantId;
  }
  const response: CreateStackNameResponse = {
    statusCode: StatusCodes.OK,
    body: {
      stackName: stackName,
    },
  };
  console.log(response);
  return response;
};