import { Aws, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AccessLogField, AccessLogFormat, ApiKeySourceType, LambdaIntegration, LogGroupLogDestination, RestApi, TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { Unit } from 'aws-cdk-lib/aws-cloudwatch';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FilterPattern, LogGroup, MetricFilter } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CommonLogGroup } from './log-group';
import { applicationName } from '../../config';

export interface ApplicationApiProps {
  cellId: string;
}

export class ApplicationApi extends Construct {
  public readonly api: RestApi;
  public readonly cellId: string;
  public readonly logGroup: LogGroup;
  constructor(scope: Construct, id: string, props: ApplicationApiProps) {
    super(scope, id);
    this.cellId = props.cellId;
    this.logGroup = new CommonLogGroup(this, 'LogGroup', {
      name: 'api',
      cellId: props.cellId,
    }).logGroup;
    this.api = new RestApi(this, 'Api', {
      restApiName: applicationName+'-'+props.cellId,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
      apiKeySourceType: ApiKeySourceType.AUTHORIZER,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(this.logGroup),
        accessLogFormat: AccessLogFormat.custom(JSON.stringify({
          path: AccessLogField.contextResourcePath(),
          requestId: AccessLogField.contextRequestId(),
          sourceIp: AccessLogField.contextIdentitySourceIp(),
          method: AccessLogField.contextHttpMethod(),
          authorizerLatency: AccessLogField.contextAuthorizerIntegrationLatency(),
          integrationLatency: AccessLogField.contextIntegrationLatency(),
          responseLatency: AccessLogField.contextResponseLatency(),
          authorizerStatus: AccessLogField.contextAuthorizerStatus(),
          integrationStatus: AccessLogField.contextIntegrationStatus(),
          status: AccessLogField.contextStatus(),
          transactionId: AccessLogField.contextAuthorizer('transactionId'),
          tenantId: AccessLogField.contextAuthorizer('tenantId'),
          tier: AccessLogField.contextAuthorizer('tier'),
          role: AccessLogField.contextAuthorizer('role'),
          stackName: Aws.STACK_NAME,
        }),
        ),
      },
    });
  }
  addService(
    entry: string,
    serviceName: string,
    authorizer?: TokenAuthorizer,
    environment?: { [key: string]: string },
    methods?: HttpMethod[],
    role?: Role,
  ) {
    const lowerCaseServiceName = serviceName.toLowerCase();
    const capitalisedServiceName = lowerCaseServiceName[0].toUpperCase() + lowerCaseServiceName.slice(1);
    const logGroup = new CommonLogGroup(this, capitalisedServiceName+'LogGroup', {
      name: serviceName,
      cellId: this.cellId,
    }).logGroup;
    const serviceMethods = methods ?? [HttpMethod.DELETE, HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT];
    const path = this.api.root.addResource(lowerCaseServiceName);
    const idPath = path.addResource('{id}');
    for (var index in serviceMethods) {
      let lowerCaseMethod = serviceMethods[index].toLowerCase();
      let capitalisedMethod = lowerCaseMethod[0].toUpperCase() + lowerCaseMethod.slice(1);
      let fn = new NodejsFunction(this, capitalisedServiceName+capitalisedMethod+'Fn', {
        entry: entry,
        runtime: Runtime.NODEJS_LATEST,
        handler: lowerCaseMethod+capitalisedServiceName,
        environment: {
          POWERTOOLS_SERVICE_NAME: lowerCaseServiceName,
          POWERTOOLS_METRICS_NAMESPACE: applicationName,
          LOG_LEVEL: 'INFO',
          ...environment,
        },
        timeout: Duration.seconds(30),
        logGroup: logGroup,
        role: role,
      });
      let lambdaIntegration = new LambdaIntegration(fn);
      if (serviceMethods[index] == HttpMethod.POST || serviceMethods[index] == HttpMethod.GET) {
        path.addMethod(serviceMethods[index], lambdaIntegration, { authorizer: authorizer });
      } else {
        idPath.addMethod(serviceMethods[index], lambdaIntegration, { authorizer: authorizer });
      }
    }
    new MetricFilter(this, capitalisedServiceName+'MetricFilter', {
      logGroup: this.logGroup,
      metricNamespace: applicationName,
      metricName: lowerCaseServiceName,
      filterPattern: FilterPattern.any(
        FilterPattern.stringValue('$.path', '=', '/'+lowerCaseServiceName),
        FilterPattern.stringValue('$.path', '=', '/'+lowerCaseServiceName+'/{id}'),
      ),
      metricValue: '$.responseLatency',
      unit: Unit.MILLISECONDS,
      dimensions: {
        tenantId: '$.tenantId',
        status: '$.status',
        stackName: '$.stackName',
      },
    });
  }
}