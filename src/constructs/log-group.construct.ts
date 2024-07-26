import { RemovalPolicy } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { StackDescription } from '../helper/helper.types';

export interface AppLogGroupProps {
  stackDescription: StackDescription;
  name: string;
}

export class AppLogGroup extends Construct {
  public readonly logGroup: LogGroup;
  constructor(scope: Construct, id: string, props: AppLogGroupProps) {
    super(scope, id);
    const lowerCaseName = props.name;
    const capitalisedName = lowerCaseName[0].toUpperCase() + lowerCaseName.slice(1);
    this.logGroup = new LogGroup(this, capitalisedName+'LogGroup', {
      logGroupName: '/'+props.stackDescription.applicationName+'/'+props.stackDescription.stackName+'/'+lowerCaseName,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
