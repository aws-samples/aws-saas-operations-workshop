import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AdvancedSecurityMode, ClientAttributes, LambdaVersion, StringAttribute, UserPool, UserPoolClient, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { Effect, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { AppLogGroup } from './log-group.construct';
import { StackDescription } from '../helper/helper.types';

export interface IdentityProviderProps {
  stackDescription: StackDescription;
}

export class IdentityProvider extends Construct {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  constructor(scope: Construct, id: string, props: IdentityProviderProps) {
    super(scope, id);
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'tenant-'+props.stackDescription.stackName,
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      signInAliases: { email: true, username: true },
      customAttributes: {
        tenantId: new StringAttribute({ minLen: 1, maxLen: 36, mutable: false }), // Don't let anyone change the tenantId after creation!
        tier: new StringAttribute({ minLen: 1, maxLen: 12, mutable: true }),
        role: new StringAttribute({ minLen: 1, maxLen: 12, mutable: true }),
      },
      removalPolicy: RemovalPolicy.DESTROY,
      advancedSecurityMode: AdvancedSecurityMode.AUDIT,
    });
    this.userPoolClient = this.userPool.addClient('UserPoolClient', {
      userPoolClientName: props.stackDescription.stackName,
      authFlows: { userPassword: true },
      readAttributes: new ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes(...['tenantId', 'tier', 'role']),
      writeAttributes: new ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes(...['tenantId', 'tier', 'role']),
    });
    const preTokenGenerationLogGroup = new AppLogGroup(this, 'LogGroup', {
      name: 'pretokengeneration',
      stackDescription: props.stackDescription,
    }).logGroup;
    const preTokenGenerationFn = new NodejsFunction(this, 'PreTokenGenerationFn', {
      entry: __dirname + '/../functions/pre-token-generation.function.ts',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'handler',
      environment: {
        NODE_OPTIONS: '--enable-source-maps', // see https://docs.aws.amazon.com/lambda/latest/dg/typescript-exceptions.html
        POWERTOOLS_SERVICE_NAME: 'pretokengenerator',
        POWERTOOLS_METRICS_NAMESPACE: props.stackDescription.applicationName,
        LOG_LEVEL: 'INFO',
      },
      timeout: Duration.seconds(30),
      logGroup: preTokenGenerationLogGroup,
    });
    this.userPool.addTrigger(UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG, preTokenGenerationFn, LambdaVersion.V2_0);
  }
  grantTenantWrite(role: Role) {
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
        ],
        resources: [this.userPool.userPoolArn],
      }),
    );
  }
}
