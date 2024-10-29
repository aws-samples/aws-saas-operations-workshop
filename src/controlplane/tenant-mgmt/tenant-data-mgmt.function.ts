import { BatchWriteItemCommand, DynamoDBClient, QueryCommand, ReturnConsumedCapacity } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, ListObjectsV2CommandInput, ListObjectsV2Command, GetObjectRequest, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client();
const dynamoDbClient = new DynamoDBClient();

interface DataExportRequest {
  tenantId: string;
  tableName: string;
  bucketName: string;
};

export const dataExport = async (event: DataExportRequest) => {
  let previousToken = undefined;
  let command: QueryCommand;
  let counter = 1;
  try {
    do {
      command = new QueryCommand({
        TableName: event.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: event.tenantId },
        },
        ReturnConsumedCapacity: ReturnConsumedCapacity.NONE,
        Limit: 25,
        ExclusiveStartKey: previousToken,
      });

      const response = await dynamoDbClient.send(command);
      previousToken = response.LastEvaluatedKey;
      if (response.Items && response.Items.length > 0) {
        const key = `${event.tenantId}/dynamodb/${counter++}.json`;
        await putDataToS3Bucket(event.bucketName, key, JSON.stringify(response.Items));
      }
    } while (previousToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

interface DataImportRequest {
  tenantId: string;
  tableName: string;
  bucketName: string;
};

export const dataImport = async (event: DataImportRequest) => {
  let nextContinuationToken = undefined;
  let input: ListObjectsV2CommandInput;
  try {
    do {
      input = {
        Bucket: event.bucketName,
        Prefix: `${event.tenantId}/dynamodb`,
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
          const records = JSON.parse(await getObjectResponse.Body?.transformToString() as string);
          await dynamoDbClient.send(new BatchWriteItemCommand({
            RequestItems: {
              [event.tableName]: records.map((record: any) => {
                return {
                  PutRequest: {
                    Item: record,
                  },
                };
              }),
            },
          }));
        }
      }

    } while (nextContinuationToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

interface DataDeleteRequest {
  tenantId: string;
  tableName: string;
};

export const dataDelete = async (event: DataDeleteRequest) => {
  let previousToken = undefined;
  let command: QueryCommand;
  try {
    do {
      command = new QueryCommand({
        TableName: event.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: event.tenantId },
        },
        ReturnConsumedCapacity: ReturnConsumedCapacity.NONE,
        Limit: 25,
        ExclusiveStartKey: previousToken,
      });

      const response = await dynamoDbClient.send(command);
      previousToken = response.LastEvaluatedKey;
      if (response.Items && response.Items.length > 0) {
        const deleteRequests = response.Items.map(item => ({
          DeleteRequest: {
            Key: {
              pk: item.pk,
              sk: item.sk,
            },
          },
        }));
        await dynamoDbClient.send(new BatchWriteItemCommand({
          RequestItems: {
            [event.tableName]: deleteRequests,
          },
        }));
      }
    } while (previousToken);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const putDataToS3Bucket = async (bucketName: string, key: string, body: string) => {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
  }));
};
