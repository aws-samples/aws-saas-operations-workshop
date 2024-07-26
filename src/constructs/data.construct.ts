import { RemovalPolicy, StackProps } from 'aws-cdk-lib';
import { AttributeType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StackDescription } from '../helper/helper.types';

export interface ApplicationPlaneDataProps extends StackProps {
  stackDescription: StackDescription;
}

export class ApplicationPlaneData extends Construct {
  public readonly table: TableV2;
  constructor(scope: Construct, id: string, props: ApplicationPlaneDataProps) {
    super(scope, id);

    this.table = new TableV2(this, 'ApplicationPlaneData', {
      tableName: props.stackDescription.stackName,
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
  grantTenantWrite(role: Role) {
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:ConditionCheckItem',
          'dynamodb:PutItem',
          'dynamodb:DescribeTable',
          'dynamodb:DeleteItem',
          'dynamodb:GetItem',
          'dynamodb:Scan',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [
          this.table.tableArn,
        ],
        conditions: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': [
              '${aws:PrincipalTag/TenantID}',
            ],
          },
        },
      }),
    );
  }
}