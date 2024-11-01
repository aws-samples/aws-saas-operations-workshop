import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { ApplicationCellStack } from './application-cell/application-cell';
import { applicationName } from './config';
import { ControlPlaneStack } from './controlplane/controlplane';

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();
Aspects.of(app).add(new AwsSolutionsChecks({}));

const controlplane = new ControlPlaneStack(app, applicationName+'-controlplane', {
  env: devEnv,
});
NagSuppressions.addStackSuppressions(controlplane, [
  { id: 'AwsSolutions-CB4', reason: 'No artifacts are created.' },
  { id: 'AwsSolutions-IAM4', reason: 'Managed policies are not bad all the time. Just something to be aware of.' },
  { id: 'AwsSolutions-IAM5', reason: 'Wildcards are used throughout SaaS. We need to make sure theyre locked down with IAM.' },
  { id: 'AwsSolutions-L1', reason: 'Uses the NODEJS_20X aligned with CodeBuild runtime.' },
  { id: 'AwsSolutions-S1', reason: 'Logs disabled for the workshop to reduce wastage.' },
  { id: 'AwsSolutions-S10', reason: 'No HTTP access is granted for S3.' },
  { id: 'AwsSolutions-SF1', reason: 'Logs disabled for the workshop to reduce wastage.' },
  { id: 'AwsSolutions-SF2', reason: 'Logs disabled for the workshop to reduce wastage.' },
]);

const stackName: string = app.node.tryGetContext('stackName');
const applicationStack = new ApplicationCellStack(app, stackName, {
  env: devEnv,
});
NagSuppressions.addStackSuppressions(applicationStack, [
  { id: 'AwsSolutions-APIG2', reason: 'Disable request validation for the workshop.' },
  { id: 'AwsSolutions-APIG3', reason: 'Disable WAF for the workshop.' },
  { id: 'AwsSolutions-APIG4', reason: 'The /auth method is the user authorizer.' },
  { id: 'AwsSolutions-APIG6', reason: 'Logs disabled for the workshop to reduce wastage.' },
  { id: 'AwsSolutions-COG1', reason: 'Disable password complexity for the workshop.' },
  { id: 'AwsSolutions-COG2', reason: 'Disable MFA for the workshop.' },
  { id: 'AwsSolutions-COG3', reason: 'Disable AdvancedSecurityMode for the workshop.' },
  { id: 'AwsSolutions-COG4', reason: 'Uses a Lambda authorizer.' },
  { id: 'AwsSolutions-IAM4', reason: 'Managed policies are not bad all the time. Just something to be aware of.' },
  { id: 'AwsSolutions-IAM5', reason: 'Wildcards are used throughout SaaS. We need to make sure theyre locked down with IAM.' },
  { id: 'AwsSolutions-L1', reason: 'Uses the NODEJS_20X runtime.' },
  { id: 'AwsSolutions-SF1', reason: 'Logs disabled for the workshop to reduce wastage.' },
  { id: 'AwsSolutions-SF2', reason: 'Logs disabled for the workshop to reduce wastage.' },
]);

app.synth();
