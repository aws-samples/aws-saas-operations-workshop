import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StatusCodes } from 'http-status-codes';
import { getTenantCredentialsFromEvent, Product, ProductInput, TenantProduct } from '../application-cell';

const tableName = process.env.TABLE_NAME;

function ddbToProduct(result: any): Product {
  return {
    category: result.category,
    name: result.name,
    price: result.price,
    productId: result.sk.replace('PRODUCT#', ''),
    sku: result.sku,
  };
}

function inputToTenantProduct(putProductInput: ProductInput, productId: string, tenantId: string): TenantProduct {
  return {
    tenantId: tenantId,
    category: putProductInput.category,
    name: putProductInput.name,
    price: putProductInput.price,
    productId: productId,
    sku: putProductInput.sku,
  };
}

function tenantProductToDdb(tenantProduct: TenantProduct) {
  return {
    pk: tenantProduct.tenantId,
    sk: 'PRODUCT#'+tenantProduct.productId,
    category: tenantProduct.category,
    name: tenantProduct.name,
    price: tenantProduct.price,
    productId: tenantProduct.productId,
    sku: tenantProduct.sku,
  };
}

async function createOrUpdateProduct(event: APIGatewayProxyEvent, productId: string): Promise<APIGatewayProxyResult> {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const client = new DynamoDBClient({ credentials: tenantCredentials });
  const docClient = DynamoDBDocumentClient.from(client);
  const productInput: ProductInput = JSON.parse(event.body as string);
  const tenantProduct = inputToTenantProduct(productInput, productId, tenantId);
  const putCommand = new PutCommand({
    TableName: tableName,
    Item: tenantProductToDdb(tenantProduct),
  });
  try {
    await docClient.send(putCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Created product.', productId: productId }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error updating product.', productId: productId, error: error }),
    };
  }
}

async function readProducts(event: APIGatewayProxyEvent, productId: string): Promise<APIGatewayProxyResult> {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const client = new DynamoDBClient({
    credentials: tenantCredentials,
  });
  const docClient = DynamoDBDocumentClient.from(client);
  const queryCommand = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#sk': 'sk',
    },
    ExpressionAttributeValues: {
      ':pk': tenantId,
      ':sk': 'PRODUCT#'+productId,
    },
    Select: 'ALL_ATTRIBUTES',
  });
  try {
    const response = await docClient.send(queryCommand);
    const tenantProducts = response.Items as TenantProduct[];
    const products: Product[] = [];
    for (var tenantProduct of tenantProducts) {
      products.push(ddbToProduct(tenantProduct));
    }
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Retrieved products.', products: JSON.stringify(products) }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error getting all products.', error: error }),
    };
  }
}

async function deleteProduct(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tenantCredentials = getTenantCredentialsFromEvent(event);
  const tenantId = event.requestContext.authorizer?.tenantId;
  const productId = event.pathParameters?.id as string;
  const response = JSON.parse((await readProducts(event, productId)).body);
  console.log(response.products);
  if (response.products.length < 0) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Product not found.', productId: productId }),
    };
  }
  const client = new DynamoDBClient({ credentials: tenantCredentials });
  const docClient = DynamoDBDocumentClient.from(client);
  const deleteCommand = new DeleteCommand({
    TableName: tableName,
    Key: {
      pk: tenantId,
      sk: 'PRODUCT#'+productId,
    },
  });
  try {
    await docClient.send(deleteCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Deleted product.', productId: productId }),
    };
  } catch (error) {
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error deleting product: '+productId, error: error }),
    };
  }
}

export const deleteProducts = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return deleteProduct(event);
};

export const getProducts = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let productId = '';
  if (event.queryStringParameters?.productId) {
    productId = event.queryStringParameters?.productId as string;
  }
  return readProducts(event, productId);
};

export const putProducts = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const productId = event.pathParameters?.id as string;
  return createOrUpdateProduct(event, productId);
};

export const postProducts = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const productId = Math.floor(Math.random() * 1000).toString();
  return createOrUpdateProduct(event, productId);
};
