import { CodeBuildClient, StartBuildCommand, StartBuildInput } from '@aws-sdk/client-codebuild';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';

const client = new CodeBuildClient();

async function provisionStack(stackName: string): Promise<APIGatewayProxyResult> {
  const input: StartBuildInput ={
    projectName: process.env.PROJECT_NAME,
    environmentVariablesOverride: [
      {
        name: 'STACK_NAME',
        value: stackName,
      },
    ],
  };
  const command = new StartBuildCommand(input);
  try {
    const response = await client.send(command);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Started provisioning.', stackName: stackName, res: response.build?.arn }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error provisioning.', stackName: stackName, error: error }),
    };
  }
}

export const putProvisioning = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const stackName = event.pathParameters?.id as string;
  return provisionStack(stackName);
};
//@ts-ignore
export const postProvisioning = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const stackName = 'pool'+Math.floor(Math.random() * 100).toString();
  return provisionStack(stackName);
};
