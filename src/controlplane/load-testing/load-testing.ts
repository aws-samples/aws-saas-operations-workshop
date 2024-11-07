import { Aws, Duration, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { BuildEnvironmentVariableType, BuildSpec, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as S3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import { Choice, Condition, DefinitionBody, IntegrationPattern, JsonPath, Pass, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { CodeBuildStartBuild, EventBridgePutEvents, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { applicationName, codeBuildBuildImage, codeBuildComputeType, ControlPlaneEventBusDetailType, ControlPlaneEventBusEventSource, runtime, sharedUserPassword, Status } from '../../config';
import { ControlPlaneEventBus } from '../event-bus/event-bus';

const description = 'LoadTesting';
const stackName = Aws.STACK_NAME;

export interface LoadTestingProps {
  eventBus: ControlPlaneEventBus;
  tenantCatalog: TableV2;
}


// Input:
//  tier: TenantTier - the tier to test
//  count: number - the number of times to run the ten minute load test
//  maxVUsers: number - the number of virtual users to test with
export class LoadTesting extends Construct {
  public readonly logGroup: LogGroup;
  constructor(scope: Construct, id: string, props: LoadTestingProps) {
    super(scope, id);

    this.logGroup = new LogGroup(this, description + 'LogGroup', {
      logGroupName: '/' + stackName + '/' + description,
      retention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const codeBucket = new Bucket(this, description + 'Bucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const bucketDeployment = new S3Deployment.BucketDeployment(this, description + 'BucketDeployment', {
      destinationBucket: codeBucket,
      sources: [S3Deployment.Source.asset(__dirname + '/scripts')],
      extract: false,
      retainOnDelete: false,
    });
    const project = new Project(this, description + 'Project', {
      projectName: applicationName + '-LoadTesting',
      source: Source.s3({
        bucket: codeBucket,
        path: Fn.select(0, bucketDeployment.objectKeys),
      }),
      logging: {
        cloudWatch: {
          logGroup: this.logGroup,
        },
      },
      environment: {
        buildImage: codeBuildBuildImage,
        computeType: codeBuildComputeType,
      },
      buildSpec: BuildSpec.fromObject({
        version: 0.2,
        phases: {
          build: {
            commands: [
              'chmod +x ./load_test.sh',
              './load_test.sh',
            ],
          },
        },
      }),
    });
    project.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudwatch:*',
          'logs:*',
        ],
        resources: ['*'],
      }),
    );

    const onboardTestTenant = new EventBridgePutEvents(this, description + 'PutOnboardingEvent', {
      stateName: 'Onboard a test tenant',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.OnboardingRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tier: JsonPath.stringAt('$.detail.tier'),
          tenantName: 'TestTenant',
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultSelector: {
        tenantId: JsonPath.stringAt('$.output.tenantId'),
      },
      resultPath: '$.tenant',
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const getTenantDetailsFn = new NodejsFunction(this, description + 'GetTenantDetailsFn', {
      entry: __dirname + '/../tenant-mgmt/tenant-mgmt.function.ts',
      runtime: runtime,
      handler: 'getTenant',
      environment: {
        LOG_LEVEL: 'INFO',
        TABLE_NAME: props.tenantCatalog.tableName,
      },
      timeout: Duration.seconds(30),
      logGroup: this.logGroup,
    });
    props.tenantCatalog.grantReadData(getTenantDetailsFn.role as Role);
    const getTenantDetails = new LambdaInvoke(this, description + 'GetTenantDetails', {
      stateName: 'Get tenant details',
      lambdaFunction: getTenantDetailsFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.tenant.tenantId'),
      }),
      resultSelector: {
        tenantId: JsonPath.stringAt('$.Payload.tenant.tenantId'),
        stackName: JsonPath.numberAt('$.Payload.tenant.stackName'),
        tier: JsonPath.stringAt('$.Payload.tenant.tier'),
      },
      resultPath: '$.tenant',
    });

    const getStackDetailsFn = new NodejsFunction(this, description + 'GetStackDetailsFn', {
      entry: __dirname + '/../resource-mgmt/resource-mgmt.function.ts',
      runtime: runtime,
      handler: 'getStackDetails',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: this.logGroup,
    });
    getStackDetailsFn.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:ListStacks',
          'cloudformation:DescribeStacks',
        ],
        resources: ['*'],
      }),
    );
    const getStackDetails = new LambdaInvoke(this, description + 'GetStackDetails', {
      stateName: 'Get stack details',
      lambdaFunction: getStackDetailsFn,
      payload: TaskInput.fromObject({
        stackName: JsonPath.stringAt('$.tenant.stackName'),
      }),
      resultSelector: {
        clientId: JsonPath.stringAt('$.Payload.clientId'),
        url: JsonPath.stringAt('$.Payload.url'),
        userPoolId: JsonPath.stringAt('$.Payload.userPoolId'),
      },
      resultPath: '$.stack',
    });

    const authAdminUserFn = new NodejsFunction(this, description + 'AuthAdminUserFn', {
      entry: __dirname + '/load-testing.function.ts',
      runtime: runtime,
      handler: 'authAdminUser',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: this.logGroup,
    });
    const authAdminUser = new LambdaInvoke(this, description + 'AuthUser', {
      stateName: 'Authenticate admin user',
      lambdaFunction: authAdminUserFn,
      payload: TaskInput.fromObject({
        tenantId: JsonPath.stringAt('$.tenant.tenantId'),
        password: sharedUserPassword,
        clientId: JsonPath.stringAt('$.stack.clientId'),
      }),
      resultSelector: {
        token: JsonPath.stringAt('$.Payload.token'),
      },
      resultPath: '$.auth',
    });

    const initIterator = new Pass(this, description + 'InitIterator', {
      stateName: 'Initialize load config',
      parameters: {
        auth: JsonPath.stringAt('$.auth'),
        detail: JsonPath.stringAt('$.detail'),
        iterator: {
          index: 0,
          count: JsonPath.stringAt('$.detail.count'),
          continue: 'true',
        },
        tenant: JsonPath.stringAt('$.tenant'),
        stack: JsonPath.stringAt('$.stack'),
        loadTest: {
          maxVUsers: JsonPath.stringAt('$.detail.maxVUsers'),
          duration: '120', // the length in seconds of each load test phase. There are five phases. Default is 120s x 5 = 600s = 10 mins. The total should be less than 15 mins because this is Lambda based.
        },
      },
    });

    const runLoadTest = new CodeBuildStartBuild(this, description + 'RunLoadTest', {
      stateName: 'Run load test',
      project: project,
      integrationPattern: IntegrationPattern.RUN_JOB,
      environmentVariablesOverride: {
        ADMIN_TOKEN: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.auth.token'),
        },
        TENANT_ID: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.tenant.tenantId'),
        },
        TENANT_TIER: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.tenant.tier'),
        },
        URL: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.stack.url'),
        },
        LT_COUNT: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.loadTest.maxVUsers'),
        },
        LT_DURATION: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: JsonPath.stringAt('$.loadTest.duration'),
        },
        REGION: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: Aws.REGION,
        },
      },
      resultPath: JsonPath.DISCARD,
    });
    //loadTestingRole.addToPolicy(new PolicyStatement({
    //  actions: ['codebuild:StartBuild'],
    //  resources: [project.projectArn],
    //}));

    const iteratorFn = new NodejsFunction(this, description + 'IteratorFn', {
      entry: __dirname + '/load-testing.function.ts',
      runtime: runtime,
      handler: 'iterator',
      environment: {
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: this.logGroup,
    });
    const iterator = new LambdaInvoke(this, description + 'Iterator', {
      stateName: 'Iterate count',
      lambdaFunction: iteratorFn,
      payload: TaskInput.fromObject({
        index: JsonPath.numberAt('$.iterator.index'),
        count: JsonPath.numberAt('$.iterator.count'),
      }),
      resultSelector: {
        index: JsonPath.numberAt('$.Payload.index'),
        continue: JsonPath.stringAt('$.Payload.continue'),
        count: JsonPath.numberAt('$.Payload.count'),
      },
      resultPath: '$.iterator',
    });

    const sendSfnSuccessCallbackEvent = new EventBridgePutEvents(this, description + 'SendSfnSuccessCallbackEvent', {
      stateName: 'Send successful SFN_CALLBACK event',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.SfnCallback,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          status: Status.Succeeded,
          taskToken: JsonPath.stringAt('$.detail.taskToken'),
          output: JsonPath.objectAt('$.cell'),
        }),
      }],
      resultPath: JsonPath.DISCARD,
    });
    const taskTokenPresent = new Choice(this, description+'TaskTokenPresent', {
      stateName: 'Is another step function waiting on a callback?',
    });
    const taskTokenPresentCondition = Condition.isPresent(JsonPath.stringAt('$.detail.taskToken'));
    const taskTokenPresentNo = new Pass(this, description+'TaskTokenPresentNo', {
      stateName: 'No task token present',
    });
    const taskTokenPresentYes = new Pass(this, description+'TaskTokenPresentYes', {
      stateName: 'Task token present',
    });
    const callback = taskTokenPresent
      .when(taskTokenPresentCondition, taskTokenPresentYes
        .next(sendSfnSuccessCallbackEvent),
      )
      .otherwise(taskTokenPresentNo)
      .afterwards();

    const offboardTestTenant = new EventBridgePutEvents(this, description + 'PutOffboardingEvent', {
      stateName: 'Offboard the test tenant',
      entries: [{
        eventBus: props.eventBus.eventBus,
        detailType: ControlPlaneEventBusDetailType.OffboardingRequest,
        source: ControlPlaneEventBusEventSource.controlPlane,
        detail: TaskInput.fromObject({
          tenantId: JsonPath.stringAt('$.tenant.tenantId'),
          taskToken: JsonPath.taskToken,
        }),
      }],
      resultPath: JsonPath.DISCARD,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
    });

    const runLoadTestChoice = new Choice(this, description + 'RunLoadTestChoice', {
      stateName: 'Run load test?',
    }).when(
      Condition.booleanEquals(JsonPath.stringAt('$.iterator.continue'), true),
      runLoadTest,
    )
      .otherwise(offboardTestTenant.next(callback))
      .afterwards();

    const definition = onboardTestTenant
      .next(getTenantDetails)
      .next(getStackDetails)
      .next(authAdminUser)
      .next(initIterator)
      .next(runLoadTest)
      .next(iterator)
      .next(runLoadTestChoice);

    const sfn = new StateMachine(this, description + 'Sfn', {
      stateMachineName: applicationName + '-' + description,
      definitionBody: DefinitionBody.fromChainable(definition),
    });

    props.eventBus.addStepFunctionTarget(ControlPlaneEventBusDetailType.LoadTestingRequest, sfn);

  }
}