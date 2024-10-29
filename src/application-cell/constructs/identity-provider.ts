import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AdvancedSecurityMode, ClientAttributes, LambdaVersion, StringAttribute, UserPool, UserPoolClient, UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { Effect, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { CommonLogGroup } from './log-group';
import { applicationName } from '../../config';

export interface ApplicationIdentityProviderProps {
  cellId: string;
}

export class ApplicationIdentityProvider extends Construct {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  constructor(scope: Construct, id: string, props: ApplicationIdentityProviderProps) {
    super(scope, id);
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: props.cellId,
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
      userPoolClientName: props.cellId,
      authFlows: { userPassword: true },
      readAttributes: new ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes(...['tenantId', 'tier', 'role']),
      writeAttributes: new ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes(...['tenantId', 'tier', 'role']),
      accessTokenValidity: Duration.days(1),
      idTokenValidity: Duration.days(1),
      refreshTokenValidity: Duration.days(3),
    });
    const preTokenGenerationLogGroup = new CommonLogGroup(this, 'LogGroup', {
      name: 'pretokengeneration',
      cellId: props.cellId,
    }).logGroup;
    const preTokenGenerationFn = new NodejsFunction(this, 'PreTokenGenerationFn', {
      entry: __dirname + '/../functions/pre-token-generation.ts',
      runtime: Runtime.NODEJS_LATEST,
      handler: 'handler',
      environment: {
        POWERTOOLS_SERVICE_NAME: 'pretokengenerator',
        POWERTOOLS_METRICS_NAMESPACE: applicationName,
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
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminSetUserPassword',
        ],
        resources: [this.userPool.userPoolArn],
      }),
    );
  }
}
