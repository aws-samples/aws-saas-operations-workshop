import { CognitoIdentityProviderClient, InitiateAuthCommand, InitiateAuthCommandInput } from '@aws-sdk/client-cognito-identity-provider';
import { StatusCodes } from 'http-status-codes';
import { Tenant } from '../../config';
import { readCellEntry } from '../resource-mgmt/resource-mgmt.function';
import { getTenant } from '../tenant-mgmt/tenant-mgmt.function';

const cognitoClient = new CognitoIdentityProviderClient();

interface AuthUserRequest {
  clientId: string;
  tenantId: string;
  password: string;
}

interface AuthUserResponse {
  statusCode: StatusCodes;
  token?: string;
}

export const authAdminUser = async (event: AuthUserRequest): Promise<AuthUserResponse> => {
  console.log(event);
  const input: InitiateAuthCommandInput = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: event.clientId,
    AuthParameters: {
      USERNAME: event.tenantId+'-Admin',
      PASSWORD: event.password,
    },
  };
  try {
    const command = new InitiateAuthCommand(input);
    const response = await cognitoClient.send(command);
    console.log(response);
    return {
      statusCode: StatusCodes.OK,
      token: response.AuthenticationResult?.AccessToken as string,
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    };
  }
};

interface IteratorRequest {
  index: number;
  count: number;
  step?: number;
}

interface IteratorResponse {
  index: number;
  continue: boolean;
  count: number;
}

export const iterator = async (event: IteratorRequest): Promise<IteratorResponse> => {
  console.log(event);
  const count = event.count;
  const step = event.step ?? 1;
  let index = event.index + step;
  let response: IteratorResponse = {
    index: index,
    continue: false,
    count: count,
  };
  if (index < count ) {
    response.continue = true;
  }
  console.log(response);
  return response;
};

interface GetTenantDetailsRequest {
  tenantId: string;
}

interface GetTenantDetailsResponse {
  adminUsername: string;
  clientId: string;
  tenantId: string;
  url: string;
}

export const getTenantDetails = async (event: GetTenantDetailsRequest): Promise<GetTenantDetailsResponse> => {
  const tenantDetails: Tenant = (await getTenant({ tenantId: event.tenantId })).tenant as Tenant;
  const stackName = tenantDetails.stackName as string;
  const stack = (await readCellEntry({ stackName: stackName })).cell;
  const response: GetTenantDetailsResponse = {
    adminUsername: tenantDetails.tenantId+'-Admin',
    clientId: stack?.clientId as string,
    tenantId: tenantDetails.tenantId,
    url: stack?.url as string,
  };
  return response;
};