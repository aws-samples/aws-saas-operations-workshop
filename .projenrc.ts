import { awscdk } from 'projen';
const cdkVersion = '2.164.1';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: cdkVersion,
  defaultReleaseBranch: 'main',
  github: false,
  name: 'aws-saas-operations-workshop-v2',
  projenrcTs: true,
  deps: [
    '@aws-lambda-powertools/jmespath',
    '@aws-sdk/client-api-gateway',
    '@aws-sdk/client-cloudformation',
    '@aws-sdk/client-codebuild',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-sfn',
    '@aws-sdk/client-sts',
    '@aws-sdk/lib-dynamodb',
    '@types/artillery',
    '@types/aws-lambda',
    'aws-jwt-verify',
    'aws-lambda',
    'cdk-nag',
    'http-status-codes',
    'source-map-support',
  ],
  context: {
    '@aws-cdk/customresources:installLatestAwsSdkDefault': false,
  },
});
project.tasks.tryFind('deploy')?.reset('cdk deploy --require-approval=never SaaSOpsV2-controlplane');
project.tasks.tryFind('destroy')?.reset('cdk destroy --force SaaSOpsV2-controlplane');
project.synth();