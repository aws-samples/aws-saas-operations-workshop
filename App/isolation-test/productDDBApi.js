const { v4: uuidv4 } = require('uuid');
const DDB = require("@aws-sdk/client-dynamodb");


const createProduct = async (region, credentials, tableName, tenantId, productId, data) => {
    const config = {
        region: region,
        credentials: {
            accessKeyId: credentials.AccessKeyId,
            secretAccessKey: credentials.SecretKey,
            sessionToken: credentials.SessionToken,
        },
    };

    const ddbClient = new DDB.DynamoDBClient(config);
    const input = {
        TableName: tableName,
        Item: {
            shardId: {
                S: `${tenantId}-1`,
            },
            productId: {
                S: productId,
            },
            data: {
                S: data,
            },
        },
    };
    const command = new DDB.PutItemCommand(input);
    try {
        const response = await ddbClient.send(command);
        return response.$metadata.httpStatusCode;
    } catch (e) {
        throw new Error(e.__type);
    }
};

const getProduct = async (region, credentials, tableName, tenantId, productId,) => {
    const config = {
        region: region,
        credentials: {
            accessKeyId: credentials.AccessKeyId,
            secretAccessKey: credentials.SecretKey,
            sessionToken: credentials.SessionToken,
        },
    };

    const ddbClient = new DDB.DynamoDBClient(config);
    const input = {
        TableName: tableName,
        Key: {
            'shardId': {
                S: `${tenantId}-1`,
            },
            'productId': {
                S: productId
            }
        },
    };

    const command = new DDB.GetItemCommand(input);
    try {
        const response = await ddbClient.send(command);
        return response;
    } catch (e) {
        throw new Error(e.__type);
    }
};

const updateProduct = async (region, credentials, tableName, tenantId, productId) => {
    const config = {
        region: region,
        credentials: {
            accessKeyId: credentials.AccessKeyId,
            secretAccessKey: credentials.SecretKey,
            sessionToken: credentials.SessionToken,
        },
    };

    const ddbClient = new DDB.DynamoDBClient(config);
    const input = {
        ExpressionAttributeValues: {
            ":v": {
                S: uuidv4(),
            },
        },
        TableName: tableName,
        Key: {
            shardId: {
                S: `${tenantId}-1`,
            },
            productId: {
                S: productId
            }
        },
        "UpdateExpression": "SET dt = :v"
    };
    const command = new DDB.UpdateItemCommand(input);
    try {
        const response = await ddbClient.send(command);
        return response.$metadata.httpStatusCode;
    } catch (e) {
        throw new Error(e.__type);
    }
}

const deleteProduct = async (region, credentials, tableName, tenantId, productId) => {
    const config = {
        region: region,
        credentials: {
            accessKeyId: credentials.AccessKeyId,
            secretAccessKey: credentials.SecretKey,
            sessionToken: credentials.SessionToken,
        },
    };

    const ddbClient = new DDB.DynamoDBClient(config);

    const input = {
        TableName: tableName,
        Key: {
            'shardId': {
                S: `${tenantId}-1`,
            },
            'productId': {
                S: productId
            }
        },
    };
    const command = new DDB.DeleteItemCommand(input);
    try {
        const response = await ddbClient.send(command);
        return response.$metadata.httpStatusCode;
    } catch (e) {
        throw new Error(e.__type);
    }
}

exports.createProduct = createProduct;
exports.getProduct = getProduct;
exports.updateProduct = updateProduct;
exports.deleteProduct = deleteProduct;