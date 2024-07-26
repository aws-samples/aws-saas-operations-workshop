import { StackProps } from 'aws-cdk-lib';
import { AccessLogField, AccessLogFormat, LogGroupLogDestination, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { AppLogGroup } from './log-group.construct';
import { StackDescription } from '../helper/helper.types';

export interface AppApiProps extends StackProps {
  stackDescription: StackDescription;
}

export class AppApi extends Construct {
  public readonly api: RestApi;
  constructor(scope: Construct, id: string, props: AppApiProps) {
    super(scope, id);
    const logGroup = new AppLogGroup(this, 'LogGroup', {
      name: 'api',
      stackDescription: props.stackDescription,
    }).logGroup;
    this.api = new RestApi(this, 'Api', {
      restApiName: 'api-'+props.stackDescription.stackName,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: AccessLogFormat.custom(JSON.stringify({
          requestId: AccessLogField.contextRequestId(),
          sourceIp: AccessLogField.contextIdentitySourceIp(),
          method: AccessLogField.contextHttpMethod(),
          authorizerLatency: AccessLogField.contextAuthorizerIntegrationLatency(),
          integrationLatency: AccessLogField.contextIntegrationLatency(),
          responseLatency: AccessLogField.contextResponseLatency(),
          authorizerStatus: AccessLogField.contextAuthorizerStatus(),
          integrationStatus: AccessLogField.contextIntegrationStatus(),
          transactionId: AccessLogField.contextAuthorizer('transactionId'),
          tenantId: AccessLogField.contextAuthorizer('tenantId'),
          tier: AccessLogField.contextAuthorizer('tier'),
          role: AccessLogField.contextAuthorizer('role'),
        }),
        ),
      },
    });
  }
}