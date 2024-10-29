import { RemovalPolicy } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { applicationName } from '../../config';

export interface CommonLogGroupProps {
  cellId: string;
  name: string;
}

export class CommonLogGroup extends Construct {
  public readonly logGroup: LogGroup;
  constructor(scope: Construct, id: string, props: CommonLogGroupProps) {
    super(scope, id);
    const lowerCaseName = props.name;
    const capitalisedName = lowerCaseName[0].toUpperCase() + lowerCaseName.slice(1);
    this.logGroup = new LogGroup(this, capitalisedName+'LogGroup', {
      logGroupName: '/'+applicationName+'/'+props.cellId+'/'+lowerCaseName,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
