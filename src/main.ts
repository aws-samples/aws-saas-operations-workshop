import { App } from 'aws-cdk-lib';
import { ApplicationPlaneStack } from './applicationplane.stack';
import { ControlPlaneStack } from './controlplane.stack';

const applicationName = 'SaaSOpsV2';

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();
const stackName = app.node.tryGetContext('stackName');
new ControlPlaneStack(app, applicationName+'-controlplane', {
  applicationName: applicationName,
  env: devEnv,
});
new ApplicationPlaneStack(app, applicationName+'-'+stackName, {
  stackDescription: {
    applicationName: applicationName,
    stackName: stackName,
  },
});
app.synth();