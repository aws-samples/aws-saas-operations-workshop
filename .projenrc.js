const { awscdk } = require('projen');
const cdkVersion = '2.150.0';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: cdkVersion,
  defaultReleaseBranch: 'main',
  github: false,
  name: 'sopsv2',
  deps: [
    'aws-lambda',
    '@types/aws-lambda',
    'http-status-codes',
    '@aws-sdk/client-codebuild',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    'aws-jwt-verify',
    '@aws-sdk/client-cognito-identity-provider',
    'source-map-support',
    '@aws-sdk/client-sts',
  ],
});
project.tasks.tryFind('deploy')?.reset('cdk deploy --require-approval=never SaaSOpsV2-controlplane');
project.tasks.tryFind('destroy')?.reset('cdk destroy --force SaaSOpsV2-controlplane');
project.synth();