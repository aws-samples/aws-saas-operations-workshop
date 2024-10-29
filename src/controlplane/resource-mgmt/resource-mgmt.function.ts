import { CloudFormationClient, DescribeStacksCommand, DescribeStacksCommandInput, Output, Stack } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { StatusCodes } from 'http-status-codes';
import { cellMgmtGsi } from './resource-mgmt';
import { Cell, CellStatus, TenantTier } from '../../config';

const tableName = process.env.TABLE_NAME;
const ddbClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cfnClient = new CloudFormationClient();

interface CellDdbSchema {
  pk: string;
  sk: string;
  status: string;
  tier: string;
  gsiTierSk: string;
  clientId?: string;
  dataTableArn?: string;
  dataTableName?: string;
  url?: string;
  userPoolId?: string;
}

function cellToDdb(cell: Cell): CellDdbSchema {
  return {
    pk: 'DESCRIPTION#',
    sk: 'STACK#' + cell.stackName,
    status: cell.status,
    tier: 'TIER#' + cell.tier,
    gsiTierSk: 'STACK#' + cell.stackName,
    clientId: cell.clientId,
    dataTableArn: cell.dataTableArn,
    dataTableName: cell.dataTableName,
    url: cell.url,
    userPoolId: cell.userPoolId,
  };
}

function ddbToCell(result: CellDdbSchema): Cell {
  return {
    stackName: result.sk.replace('STACK#', ''),
    status: result.status as CellStatus,
    tier: result.tier.replace('TIER#', '') as TenantTier,
    clientId: result.clientId,
    dataTableArn: result.dataTableArn,
    dataTableName: result.dataTableName,
    url: result.url,
    userPoolId: result.userPoolId,
  };
}
interface ReadCellEntryRequest {
  stackName: string;
}
export interface ReadCellEntryResponse {
  statusCode: StatusCodes;
  cell?: Cell;
}
export const readCellEntry = async (event: ReadCellEntryRequest): Promise<ReadCellEntryResponse> => {
  const getCommand = new GetCommand({
    TableName: tableName,
    Key: {
      pk: 'DESCRIPTION#',
      sk: 'STACK#'+event.stackName,
    },
  });
  try {
    const result = await docClient.send(getCommand);
    console.log(result);
    if (result.Item) {
      const cell = ddbToCell(result.Item as CellDdbSchema);
      console.log(cell);
      return {
        statusCode: StatusCodes.OK,
        cell: cell,
      };
    }
  } catch (error) {
    console.log(error);
  }
  return {
    statusCode: StatusCodes.NOT_FOUND,
  };
};

interface getStacksResponse {
  statusCode: StatusCodes;
  body: Cell[] | unknown;
}

export const getStacks = async (event: any): Promise<getStacksResponse> => {
  const command = new QueryCommand({
    TableName: tableName,
    IndexName: cellMgmtGsi,
    KeyConditionExpression: '#tier = :tier and begins_with(#gsiTierSk, :stack)',
    ExpressionAttributeNames: {
      '#tier': 'tier',
      '#gsiTierSk': 'gsiTierSk',
    },
    ExpressionAttributeValues: {
      ':tier': 'TIER#' + event.tier,
      ':stack': 'STACK#',
    },
  });
  try {
    let stacks: Cell[] = [];
    const result = (await docClient.send(command)).Items as CellDdbSchema[];
    result?.forEach( (stack) => {
      stacks.push(ddbToCell(stack));
      console.log(ddbToCell(stack));
    });
    console.log(stacks);
    return {
      statusCode: StatusCodes.OK,
      body: stacks,
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: error,
    };
  }
};

export const updateCellEntry = async (event: Cell) => {
  const cell = event;
  const putCommand = new PutCommand({
    TableName: tableName,
    Item: cellToDdb(cell),
  });
  try {
    await docClient.send(putCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Updated cell.', cell: cell }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error updating cell.', cell: cell, error: error }),
    };
  }
};

interface DeleteCellEntry {
  stackName: string;
}

export const deleteCellEntry = async (event: DeleteCellEntry) => {
  const deleteCommand = new DeleteCommand({
    TableName: tableName,
    Key: {
      pk: 'DESCRIPTION#',
      sk: 'STACK#'+event.stackName,
    },
  });
  try {
    await docClient.send(deleteCommand);
    return {
      statusCode: StatusCodes.OK,
      body: JSON.stringify({ message: 'Deleted cell entry.', stackName: event.stackName }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({ message: 'Error deleting cell entry.', stackName: event.stackName, error: error }),
    };
  }
};

interface GetStackDetailsRequest {
  stackName: string;
}

interface GetStackDetailsResponse {
  clientId: string;
  dataTableArn: string;
  dataTableName: string;
  url: string;
  userPoolId: string;
}

export const getStackDetails = async (event: GetStackDetailsRequest): Promise<GetStackDetailsResponse> => {
  let response: GetStackDetailsResponse = {
    clientId: '',
    dataTableArn: '',
    dataTableName: '',
    url: '',
    userPoolId: '',
  };
  const cfnInput: DescribeStacksCommandInput = {
    StackName: event.stackName,
  };
  const cfnCommand = new DescribeStacksCommand(cfnInput);
  try {
    const cfnResponse = await cfnClient.send(cfnCommand);
    console.log(cfnResponse);
    cfnResponse.Stacks?.forEach((stack: Stack) => {
      const outputs = stack.Outputs as Output[];
      outputs.forEach((output: Output) => {
        console.log(output);
        switch (output.OutputKey) {
          case 'ClientId':
            response.clientId = output.OutputValue as string;
            break;
          case 'ApiUrl':
            response.url = output.OutputValue as string;
            break;
          case 'DataTableArn':
            response.dataTableArn = output.OutputValue as string;
            break;
          case 'DataTableName':
            response.dataTableName = output.OutputValue as string;
            break;
          case 'UserPoolId':
            response.userPoolId = output.OutputValue as string;
            break;
        }
      });
    });
  } catch (error) {
    console.log(error);
    throw new Error('Stack not found');
  }
  return response;
};