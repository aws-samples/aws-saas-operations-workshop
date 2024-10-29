import { CognitoIdentityProviderClient, InitiateAuthCommand, InitiateAuthCommandInput } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';

const clientId = process.env.CLIENT_ID;

const cognitoClient = new CognitoIdentityProviderClient();

interface PostAuthInput {
  username: string;
  password: string;
}

export const postAuth = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(event);
  const body: PostAuthInput = JSON.parse(event.body as string);
  const input: InitiateAuthCommandInput = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: body.username,
      PASSWORD: body.password,
    },
  };
  try {
    const command = new InitiateAuthCommand(input);
    const response = await cognitoClient.send(command);
    console.log(response);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({
        message: 'User authenticated.',
        accessToken: response.AuthenticationResult?.AccessToken as string,
      }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error authenticating user.', error: error }),
    };
  }
};