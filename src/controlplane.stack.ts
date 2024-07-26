import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AccessLogField, AccessLogFormat, LogGroupLogDestination, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { BuildSpec, ComputeType, LinuxArmLambdaBuildImage, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as S3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { ApiService } from './constructs/api-service.construct';

export interface ControlPlaneStackProps extends StackProps {
  applicationName: string;
}

export class ControlPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);


    const logGroup = new LogGroup(this, 'CodeBuildLogGroup', {
      logGroupName: '/'+props.applicationName+'/deploy',
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new RestApi(this, 'Api', {
      restApiName: 'api-controlplane',
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
        }),
        ),
      },
    });

    const codeBucket = new Bucket(this, 'CodeBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const bucketDeployment = new S3Deployment.BucketDeployment(this, 'CodeBucketDeployment', {
      destinationBucket: codeBucket,
      sources: [S3Deployment.Source.asset(__dirname + '/../', {
        exclude: [
          '.git*',
          'cdk.out',
          'coverage',
          'node_modules',
        ],
      })],
      extract: false,
      retainOnDelete: false,
    });

    const codebuild = new Project(this, 'CodeBuild', {
      projectName: props.applicationName,
      source: Source.s3({
        bucket: codeBucket,
        path: Fn.select(0, bucketDeployment.objectKeys),
      }),
      logging: {
        cloudWatch: { logGroup },
      },
      environment: {
        environmentVariables: {
          STACK_NAME: {
            value: 'tenant021',
          },
        },
        buildImage: LinuxArmLambdaBuildImage.AMAZON_LINUX_2_NODE_18,
        computeType: ComputeType.LAMBDA_2GB,
      },
      buildSpec: BuildSpec.fromObject({
        version: 0.2,
        phases: {
          build: {
            commands: [
              'chmod +x ./provision_applicationplane.sh',
              './provision_applicationplane.sh',
            ],
          },
        },
      }),
    });
    codebuild.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' });

    const provisioningRole = new Role(this, 'ProvisioningRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    provisioningRole.addToPolicy(new PolicyStatement({
      actions: ['codebuild:StartBuild'],
      resources: [codebuild.projectArn],
    }));
    new ApiService(this, 'ProvisioningService', {
      api: api,
      entry: __dirname + '/functions/provisioning.function.ts',
      serviceName: 'provisioning',
      environment: {
        PROJECT_NAME: props.applicationName,
      },
      stackDescription: {
        applicationName: props.applicationName,
        stackName: 'Provisioning',
      },
      methods: [HttpMethod.PUT, HttpMethod.POST],
      role: provisioningRole,
    });

    new CfnOutput(this, 'ApiUrl', {
      exportName: 'controlplaneApiUrl',
      key: 'ApiUrl',
      value: api.url,
    });
  }
}