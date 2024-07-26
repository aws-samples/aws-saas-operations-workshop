import { Duration, StackProps } from 'aws-cdk-lib';
import { LambdaIntegration, RestApi, TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { AppLogGroup } from './log-group.construct';
import { StackDescription } from '../helper/helper.types';

export interface ApiServiceProps extends StackProps {
  serviceName: string;
  api: RestApi;
  stackDescription: StackDescription;
  authorizer?: TokenAuthorizer;
  entry: string;
  environment?: { [key: string]: string };
  methods?: HttpMethod[];
  role?: Role;
}

export class ApiService extends Construct {
  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);
    const lowerCaseServiceName = props.serviceName.toLowerCase();
    const capitalisedServiceName = lowerCaseServiceName[0].toUpperCase() + lowerCaseServiceName.slice(1);
    const logGroup = new AppLogGroup(this, lowerCaseServiceName+'LogGroup', {
      name: props.serviceName,
      stackDescription: props.stackDescription,
    }).logGroup;
    const methods = props.methods ?? [HttpMethod.DELETE, HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT];
    const path = props.api.root.addResource(lowerCaseServiceName);
    const idPath = path.addResource('{id}');
    for (var index in methods) {
      let lowerCaseMethod = methods[index].toLowerCase();
      let capitalisedMethod = lowerCaseMethod[0].toUpperCase() + lowerCaseMethod.slice(1);
      let fn = new NodejsFunction(this, capitalisedServiceName+capitalisedMethod+'Fn', {
        entry: props.entry,
        runtime: Runtime.NODEJS_LATEST,
        handler: lowerCaseMethod+capitalisedServiceName,
        environment: {
          NODE_OPTIONS: '--enable-source-maps', // see https://docs.aws.amazon.com/lambda/latest/dg/typescript-exceptions.html
          POWERTOOLS_SERVICE_NAME: lowerCaseServiceName,
          POWERTOOLS_METRICS_NAMESPACE: props.stackDescription.applicationName,
          LOG_LEVEL: 'INFO',
          ...props?.environment,
        },
        timeout: Duration.seconds(30),
        logGroup: logGroup,
        role: props?.role,
      });
      let lambdaIntegration = new LambdaIntegration(fn);
      if (methods[index] == HttpMethod.POST || methods[index] == HttpMethod.GET) {
        path.addMethod(methods[index], lambdaIntegration, { authorizer: props?.authorizer });
      } else {
        idPath.addMethod(methods[index], lambdaIntegration, { authorizer: props?.authorizer });
      }
    }
  }
}