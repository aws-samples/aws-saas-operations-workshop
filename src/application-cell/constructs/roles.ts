import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class ApplicationRoles extends Construct {
  public readonly userRole: Role;
  public readonly adminRole: Role;
  public readonly authorizerRole: Role;
  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.authorizerRole = new Role(this, 'AuthorizerRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.adminRole = new Role(this, 'AdminRole', {
      assumedBy: this.authorizerRole,
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    this.adminRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:TagSession'],
        principals: [this.authorizerRole],
        conditions: {
          StringLike: {
            'aws:RequestTag/tenantId': '*',
          },
        },
      }),
    );

    this.userRole = new Role(this, 'UserRole', {
      assumedBy: this.authorizerRole,
    });
    this.userRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:TagSession'],
        principals: [this.authorizerRole],
        conditions: {
          StringLike: {
            'aws:RequestTag/tenantId': '*',
          },
        },
      }),
    );
  }
}
