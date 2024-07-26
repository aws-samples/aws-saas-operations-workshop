import { AdminCreateUserCommand, AdminCreateUserCommandInput, AdminSetUserPasswordCommand, AdminSetUserPasswordCommandInput, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';
import { getTenantCredentialsFromEvent } from '../helper/helper';
import { TenantUser, User } from '../helper/helper.types';

const sharedUserPassword = 'Well,aintThis5177y?';

export const postUsers = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tenantId = event.requestContext.authorizer?.tenantId;
  const user: User = JSON.parse(event.body as string);
  const tenantUser: TenantUser = {
    tenantId: tenantId,
    email: 'success+'+user.userName+'@simulator.amazonses.com',
    userName: user.userName,
    role: user.role,
    tier: event.requestContext.authorizer?.tier,
  };

  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const client = new CognitoIdentityProviderClient({ credentials: tenantCredentials });

  const createInput: AdminCreateUserCommandInput = {
    UserPoolId: process.env.USER_POOL_ID,
    Username: tenantUser.userName,
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
    UserPoolId: process.env.USER_POOL_ID,
    Username: user.userName,
    Password: sharedUserPassword,
    Permanent: true,
  };
  const setUserPasswordCommand = new AdminSetUserPasswordCommand(passwordInput);

  try {
    await client.send(createUserCommand);
    await client.send(setUserPasswordCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'User created.', userName: tenantUser.userName }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error creating user.', userName: tenantUser.userName, error: error }),
    };
  }
};