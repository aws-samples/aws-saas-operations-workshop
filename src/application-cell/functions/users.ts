import { AdminCreateUserCommand, AdminCreateUserCommandInput, AdminDeleteUserCommand, AdminDeleteUserCommandInput, AdminSetUserPasswordCommand, AdminSetUserPasswordCommandInput, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';
import { sharedUserPassword, TenantUser, User } from '../../config';
import { getTenantCredentialsFromEvent } from '../application-cell';

export const deleteUsers = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(event);
  const username = event.pathParameters?.id as string;
  console.log(username);

  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const client = new CognitoIdentityProviderClient({ credentials: tenantCredentials });

  const input: AdminDeleteUserCommandInput = {
    UserPoolId: process.env.USER_POOL_ID,
    Username: username,
  };
  const command = new AdminDeleteUserCommand(input);

  try {
    await client.send(command);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'User deleted.', username: username }),
    };
  } catch (error) {
    console.log(username);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error deleting user.', username: username, error: error }),
    };
  }
};

export const postUsers = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tenantId = event.requestContext.authorizer?.tenantId;
  const user: User = JSON.parse(event.body as string);
  const tenantUser: TenantUser = {
    tenantId: tenantId,
    email: 'success+'+user.username+'@simulator.amazonses.com',
    username: user.username,
    role: user.role,
    tier: event.requestContext.authorizer?.tier,
  };

  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const client = new CognitoIdentityProviderClient({ credentials: tenantCredentials });

  const createInput: AdminCreateUserCommandInput = {
    UserPoolId: process.env.USER_POOL_ID,
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
    UserPoolId: process.env.USER_POOL_ID,
    Username: user.username,
    Password: sharedUserPassword,
    Permanent: true,
  };
  const setUserPasswordCommand = new AdminSetUserPasswordCommand(passwordInput);

  try {
    await client.send(createUserCommand);
    await client.send(setUserPasswordCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'User created.', username: tenantUser.username }),
    };
  } catch (error) {
    console.log(tenantUser.username);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error creating user.', username: tenantUser.username, error: error }),
    };
  }
};