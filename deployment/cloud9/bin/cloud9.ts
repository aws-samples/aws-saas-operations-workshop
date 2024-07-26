#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Cloud9Stack } from '../lib/cloud9-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const env = { account, region };
const participantAssumedRoleArn = process.env.PARTICIPANT_ASSUMED_ROLE_ARN;
const workshop = app.node.tryGetContext('workshop') || 'workshop';

new Cloud9Stack(app, workshop+'-C9', {
  workshop: workshop,
  ownerArn: participantAssumedRoleArn,
  env: env,
});
