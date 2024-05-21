const cf = require('@aws-sdk/client-cloudformation');
const DDB = require("@aws-sdk/client-dynamodb");

const cfClient = new cf.CloudFormationClient();
const ddbClient = new DDB.DynamoDBClient();

const convertToOutputObject = (outputs) => {
    const obj = {};
    outputs.forEach(x => {
        obj[x.OutputKey] = x.OutputValue
    });

    return obj;
}

const loadStackOutputs = async (stackName) => {
    const response = await cfClient.send(new cf.DescribeStacksCommand({
        StackName: stackName
    }));

    return convertToOutputObject(response.Stacks[0].Outputs);
};

const loadStackResources = async (stackName) => {
    const response = await cfClient.send(new cf.ListStackResourcesCommand({
        StackName: stackName,
    }));

    return response.StackResourceSummaries;
};

const getStackNameFromArn = (stackArn) => {
    if(!stackArn)
        return stackArn;

    let lastSlash = stackArn.lastIndexOf("/");
    let str = stackArn.substring(0, lastSlash);
    lastSlash = str.lastIndexOf("/");
    str = str.substring(lastSlash+1);
    return str;
};

const loadBasicTenantIdentityConfig = async () => {
    const resources = await loadStackResources("saas-operations-controlplane");
    
    const logicalToStackNameMap = {};
    resources.forEach(x => { logicalToStackNameMap[x.LogicalResourceId] = getStackNameFromArn(x.PhysicalResourceId); })

    const outputs = await loadStackOutputs(logicalToStackNameMap["Cognito"]);
    const identityPoolId = outputs['CognitoIdentityPoolId'];
    const clientId = outputs['CognitoUserPoolClientId'];
    const userPoolId = outputs['CognitoUserPoolId'];

    return {identityPoolId, clientId, userPoolId};
};

const loadPlatinumTenantIdentityConfig = async (tenantId) => {
    const result = await ddbClient.send(new DDB.GetItemCommand({
        TableName: "SaaSOperations-TenantDetails",
        Key: {
            "tenantId": {
                S: tenantId
            }
        }
    }));

    return {identityPoolId: result.Item['identityPoolId'].S, userPoolId: result.Item['userPoolId'].S, clientId: result.Item['appClientId'].S};
};


exports.loadBasicTenantIdentityConfig = loadBasicTenantIdentityConfig;
exports.loadPlatinumTenantIdentityConfig = loadPlatinumTenantIdentityConfig;