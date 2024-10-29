import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';
import { getTenantCredentialsFromEvent, OrderInput, OrderInputLine, OrderLine, TenantOrderLine } from '../application-cell';

const tableName = process.env.TABLE_NAME;

function ddbToTenantOrderLine(result: any): OrderLine {
  const skSplit = result.sk.split('|');
  return {
    orderId: skSplit[0].replace('ORDER#', ''),
    lineNumber: skSplit[1].replace('LINE#', ''),
    productId: result.productId,
    quantity: result.quantity,
  };
}

function orderInputLineToTenantOrderLine(orderInputLine: OrderInputLine, orderId: string, tenantId: string, lineNumber: string): TenantOrderLine {
  return {
    tenantId: tenantId,
    orderId: orderId,
    productId: orderInputLine.productId,
    quantity: orderInputLine.quantity,
    lineNumber: lineNumber,
  };
}

function tenantOrderLineToDdb(tenantOrderLine: TenantOrderLine) {
  return {
    pk: tenantOrderLine.tenantId,
    sk: 'ORDER#'+tenantOrderLine.orderId+'|LINE#'+tenantOrderLine.lineNumber,
    productId: tenantOrderLine.productId,
    quantity: tenantOrderLine.quantity,
  };
}

async function createOrUpdateOrder(event: APIGatewayProxyEvent, orderId: string): Promise<APIGatewayProxyResult> {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const client = new DynamoDBClient({ credentials: tenantCredentials });
  const docClient = DynamoDBDocumentClient.from(client);
  const input: OrderInput = JSON.parse(event.body as string);
  try {
    let lineNumber = 1;
    for (var orderInputLine of input.lines) {
      const tenantOrderLine = orderInputLineToTenantOrderLine(orderInputLine, orderId, tenantId, lineNumber.toString());
      const putCommand = new PutCommand({
        TableName: tableName,
        Item: tenantOrderLineToDdb(tenantOrderLine),
      });
      await docClient.send(putCommand);
      lineNumber++;
    }
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Order created.', orderId: orderId }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error creating order.', orderId: orderId, error: error }),
    };
  }
}

async function readOrders(event: APIGatewayProxyEvent, orderId: string): Promise<APIGatewayProxyResult> {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const client = new DynamoDBClient({
    credentials: tenantCredentials,
  });
  const docClient = DynamoDBDocumentClient.from(client);
  const getCommand = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk',
    },
    ExpressionAttributeValues: {
      ':pk': tenantId,
      ':sk': 'ORDER#'+orderId,
    },
    Select: 'ALL_ATTRIBUTES',
  });
  try {
    const response = await docClient.send(getCommand);
    const ddbOrderLines = response?.Items;
    const orderLines: OrderLine[] = [];
    if (ddbOrderLines) {
      for (var ddbOrderLine of ddbOrderLines) {
        const orderLine = ddbToTenantOrderLine(ddbOrderLine);
        orderLines.push(orderLine);
      }
    }
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Retrieved orders.', orderLines: JSON.stringify(orderLines) }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error getting order', orderId: orderId, error: error }),
    };
  }
}

async function deleteOrderLine(docClient: DynamoDBDocumentClient, tenantId: string, orderId: string, lineNumber: string) {
  const deleteCommand = new DeleteCommand({
    TableName: tableName,
    Key: {
      pk: tenantId,
      sk: 'ORDER#'+orderId+'|LINE#'+lineNumber,
    },
  });
  try {
    await docClient.send(deleteCommand);
  } catch (error) {
    throw new Error('Error deleting line '+lineNumber+' from order '+orderId+'.');
  }
}

export const deleteOrders = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const orderId = event.pathParameters?.id as string;
  const client = new DynamoDBClient({ credentials: tenantCredentials });
  const docClient = DynamoDBDocumentClient.from(client);
  try {
    const orderLines = JSON.parse((await readOrders(event, orderId)).body).orderLines;
    console.log(orderLines);
    for (var orderLine of JSON.parse(orderLines)) {
      await deleteOrderLine(docClient, tenantId, orderId, orderLine.lineNumber);
    }
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Order deleted.', orderId: orderId }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error deleting order.', orderId: orderId, error: error }),
    };
  }
};

export const getOrders = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let orderId = '';
  if (event.queryStringParameters?.orderId) {
    orderId = event.queryStringParameters?.orderId as string;
  }
  return readOrders(event, orderId);
};

export const putOrders = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const orderId = event.pathParameters?.id as string;
  return createOrUpdateOrder(event, orderId);
};

export const postOrders = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const orderId = Math.floor(Math.random() * 1000).toString();
  return createOrUpdateOrder(event, orderId);
};
