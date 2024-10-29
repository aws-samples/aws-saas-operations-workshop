import { AdminCreateUserCommand, AdminCreateUserCommandInput, AdminDeleteUserCommand, AdminDeleteUserRequest, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, ListUsersCommand, ListUsersCommandOutput, UserType } from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, PutObjectCommand, ListObjectsV2CommandInput, ListObjectsV2Command, GetObjectRequest, GetObjectCommand } from '@aws-sdk/client-s3';
import { sharedUserPassword, TenantTier } from '../../config';

const cognitoClient = new CognitoIdentityProviderClient();
const s3Client = new S3Client();

interface UserExportRequest {
  tenantId: string;
  userPoolId: string;
  bucketName: string;
};

//Lab1-INFO
export const userExport = async (event: UserExportRequest) => {
  let counter = 1;
  let paginationToken = undefined;
  let command: ListUsersCommand, response: ListUsersCommandOutput;
  try {
    do {
      command = new ListUsersCommand({ UserPoolId: event.userPoolId, PaginationToken: paginationToken });
      response = await cognitoClient.send(command);
      const users = response.Users?.filter(x => tenantUserFilter(x, event.tenantId)) || [];
      if (users.length > 0) {
        const key = `${event.tenantId}/cognito/${counter++}.json`;
        await s3Client.send(new PutObjectCommand({
          Bucket: event.bucketName,
          Key: key,
          Body: JSON.stringify(users),
        }));
      }
      paginationToken = response.PaginationToken;

    } while (paginationToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

interface UserImportRequest {
  tenantId: string;
  tier: TenantTier;
  userPoolId: string;
  bucketName: string;
};

export const userImport = async (event: UserImportRequest) => {
  console.log(event);
  let nextContinuationToken = undefined;
  let input: ListObjectsV2CommandInput;
  try {
    do {
      input = {
        Bucket: event.bucketName,
        Prefix: `${event.tenantId}/cognito`,
        ContinuationToken: nextContinuationToken,
      };
      const command = new ListObjectsV2Command(input);
      const response = await s3Client.send(command);
      nextContinuationToken = response.NextContinuationToken;
      if (response.Contents && response.Contents.length > 0) {
        for (const content of response.Contents) {
          const getObjectInput: GetObjectRequest = {
            Bucket: event.bucketName,
            Key: content.Key,
          };
          const getObjectCommand = new GetObjectCommand(getObjectInput);
          const getObjectResponse = await s3Client.send(getObjectCommand);
          const users = JSON.parse(await getObjectResponse.Body?.transformToString() as string);

          for (const user of users) {
            const createInput: AdminCreateUserCommandInput = {
              UserPoolId: event.userPoolId,
              Username: user.Username,
              MessageAction: 'SUPPRESS',
              UserAttributes: [
                { Name: 'email', Value: user.Attributes.find((x: any) => x.Name == 'email').Value },
                { Name: 'custom:tenantId', Value: event.tenantId },
                { Name: 'custom:tier', Value: event.tier },
                { Name: 'custom:role', Value: user.Attributes.find((x: any) => x.Name == 'custom:role').Value },
              ],
            };
            const createUserCommand = new AdminCreateUserCommand(createInput);
            await cognitoClient.send(createUserCommand);

            const setUserPasswordCommand = new AdminSetUserPasswordCommand({
              UserPoolId: event.userPoolId,
              Username: user.Username,
              Password: sharedUserPassword,
              Permanent: true,
            });
            await cognitoClient.send(setUserPasswordCommand);
          }
        }
      }
    } while (nextContinuationToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const tenantUserFilter = (x: UserType, tenantId: string) => {
  return x.Attributes?.some(attr => attr.Name === 'custom:tenantId' && attr.Value == tenantId);
};

interface UserDeleteRequest {
  tenantId: string;
  userPoolId: string;
};

export const userDelete = async (event: UserDeleteRequest) => {
  console.log(event);
  let paginationToken = undefined;
  let command: ListUsersCommand, response: ListUsersCommandOutput;
  try {
    do {
      command = new ListUsersCommand({ UserPoolId: event.userPoolId, PaginationToken: paginationToken });
      response = await cognitoClient.send(command);
      const users = response.Users?.filter(x => tenantUserFilter(x, event.tenantId)) || [];
      if (users.length > 0) {
        for (const user of users) {
          const input: AdminDeleteUserRequest = {
            UserPoolId: event.userPoolId, // required
            Username: user.Username, // required
          };
          const deleteCommand = new AdminDeleteUserCommand(input);
          await cognitoClient.send(deleteCommand);
        }
      }
      paginationToken = response.PaginationToken;
    } while (paginationToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};