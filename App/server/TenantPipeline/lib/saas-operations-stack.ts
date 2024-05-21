// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from 'constructs';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { Function, Runtime, AssetCode } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';


export class SaaSOperationsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const artifactsBucket = new s3.Bucket(this, "ArtifactsBucket", {
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
    });
    NagSuppressions.addResourceSuppressions(artifactsBucket, [
      { id: "AwsSolutions-S1", reason: "Used only for temporary artifact generation."}
    ]);


    //create IAM policy with lambda basic execution role, write access to s3 and read access to dynamodb
    const lambdaPolicy = new iam.PolicyStatement({
      actions: [
        "s3:*Object",
        "logs:CreateLogGroup",
        "logs:PutLogEvents",
        "logs:CreateLogStream",
        "logs:DescribeLogStreams"
      ],
      resources: [          
        `${artifactsBucket.bucketArn}/*`,    
        `arn:aws:logs:${this.region}:${this.account}`,            
      ]        
    })

    const lambdaFunctionPrep = new Function(this, "prep-deploy", {
        handler: "lambda-prepare-deploy.lambda_handler",
        runtime: Runtime.PYTHON_3_9,
        code: new AssetCode(`./resources`),
        memorySize: 512,
        timeout: Duration.seconds(10),
        environment: {
            BUCKET: artifactsBucket.bucketName,
        },
        initialPolicy: [lambdaPolicy],
    })

    lambdaFunctionPrep.addToRolePolicy(      
      new iam.PolicyStatement({
        actions: [
          "s3:ListBucket"
        ],
        resources: [
          artifactsBucket.bucketArn,
        ]
      })
    )


    lambdaFunctionPrep.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          "codepipeline:PutJobSuccessResult",
          "codepipeline:PutJobFailureResult",
          "kms:Decrypt",      
        ],
        resources: ["*"]
      })            
    )

    lambdaFunctionPrep.addToRolePolicy(      
      new iam.PolicyStatement({
        actions: [
          //dynamodb read items
          "dynamodb:Query",
          "dynamodb:Scan",      
          "dynamodb:GetItem",        
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/SaaSOperations-Settings`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/SaaSOperations-TenantStackMapping`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/SaaSOperations-TenantDetails`
        ]
      })
    )

    NagSuppressions.addResourceSuppressions(lambdaFunctionPrep, [
      { 
        id: "AwsSolutions-IAM4", 
        reason: "Lambda basic permission is enough for general logging and monitoring.",
        appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "Object level permission are provided to specific artifact bucket only.",
        appliesTo: ["Action::s3:*Object", "Resource::<ArtifactsBucket2AAC5544.Arn>/*"]
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "Used for CodePipeline and KMS. Keys and project names are not known ahead.",
        appliesTo: [`Resource::*`]
      },
      {
        id: "AwsSolutions-L1",
        reason: "Python 3.9 is not on the deprecated list."
      }
    ], true);


    // Pipeline creation starts
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'saas-operations-pipeline',
      artifactBucket: artifactsBucket,
      pipelineType: codepipeline.PipelineType.V1
    });

    // Import existing CodeCommit sam-app repository
    const codeRepo = codecommit.Repository.fromRepositoryName(
      this,
      'AppRepository', 
      'aws-saas-factory-saas-operations' 
    );

    // Declare source code as an artifact
    const sourceOutput = new codepipeline.Artifact();

    // Add source stage to pipeline
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.CodeCommitSourceAction({
          actionName: 'CodeCommit_Source',
          repository: codeRepo,
          branch: 'main',
          output: sourceOutput,
          variablesNamespace: 'SourceVariables'
        }),
      ],
    });

    // Declare build output as artifacts
    const buildOutput = new codepipeline.Artifact();

    //Declare a new CodeBuild project
    const buildProject = new codebuild.PipelineProject(this, 'Build', {
      buildSpec : codebuild.BuildSpec.fromSourceFilename("App/server/tenant-buildspec.yml"),
      environment: { buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4 },
      environmentVariables: {
        'PACKAGE_BUCKET': {
          value: artifactsBucket.bucketName
        }
      }
    });

    // Add the build stage to our pipeline
    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Build-SaaS-Operations',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    const deployOutput = new codepipeline.Artifact();

    //Add the Lambda function that will deploy the tenant stack in a multitenant way
    pipeline.addStage({
      stageName: 'PrepDeploy',
      actions: [
        new codepipeline_actions.LambdaInvokeAction({
          actionName: 'PrepareDeployment',
          lambda: lambdaFunctionPrep,
          inputs: [buildOutput],
          outputs: [deployOutput],
          userParameters: {
            'artifact': 'Artifact_Build_Build-SaaS-Operations',
            'template_file': 'packaged.yaml',
            'commit_id': '#{SourceVariables.CommitId}'
          }
        })
      ],
    });   
    
    const lambdaFunctionIterator = new Function(this, "WaveIterator", {
      handler: "iterator.lambda_handler",
      runtime: Runtime.PYTHON_3_9,
      code: lambda.Code.fromAsset("resources", {exclude: ['*.json']}),
      memorySize: 512,
      timeout: Duration.seconds(10),
  })

  const approvalQueue = new sqs.Queue(this, 'ApprovalQueue',{
    enforceSSL:true
  });

    const stepfunctionLogGroup = new logs.LogGroup(this,'stepFunctionLG');

    //Step function needs permissions to create resources
    const stepfunction_deploymentpolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3:ListBucket"
          ],
          resources: [
            artifactsBucket.bucketArn,
          ]
        }),
        new iam.PolicyStatement({
          resources: [
            `${artifactsBucket.bucketArn}/*`,             
          ],
          actions: [
                      "s3:DeleteObject",
                      "s3:GetObject",
                      "s3:PutObject",
                      "s3:ReplicateObject",
                      "s3:RestoreObject",
                  ],
          }),          
        new iam.PolicyStatement({
          resources: [
            approvalQueue.queueArn,            
          ],
          actions: [
                      "sqs:SendMessage"                      
                  ],
          }),
          new iam.PolicyStatement({
            resources: ["*"],                        
            actions: [
                        "logs:*",
                        "cloudformation:DescribeStacks",
                        "cloudformation:CreateStack",
                        "cloudformation:UpdateStack",
                        "cloudformation:CreateChangeSet",
                        "cloudwatch:PutMetricAlarm",
                        "lambda:*",
                        "apigateway:*",
                        "dynamodb:*",
                        "iam:GetRole",  
                        "iam:UpdateRole",
                        "iam:DeleteRole",
                        "iam:CreateRole",
                        "iam:ListRoles",
                        "iam:PassRole",
                        "iam:GetPolicy",
                        "iam:PassRole",
                        "iam:UpdatePolicy",
                        "iam:DetachRolePolicy",
                        "iam:AttachRolePolicy",
                        "iam:DeleteRolePolicy",
                        "iam:DeletePolicy",
                        "iam:PutRolePolicy", 
                        "iam:GetRolePolicy",                       
                        "codedeploy:*",                         
                    ],
            }),
        ],
      });

    const stepfunction_deploymentrole = new iam.Role(this, 'StepFunctionRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'Role assumed by deployment state machine',
      inlinePolicies: {
        deployment_policy: stepfunction_deploymentpolicy,
      },
    });

    const file = fs.readFileSync("./resources/deployemntstatemachine.asl.json");

    const deploymentstateMachine = new stepfunctions.CfnStateMachine(this, 'DeploymentCfnStateMachine', {
      roleArn: stepfunction_deploymentrole.roleArn,
      // the properties below are optional
      definitionString: file.toString(),    
      definitionSubstitutions: {
        ITERATOR_LAMBDA_ARN: lambdaFunctionIterator.functionArn,
        APPROVAL_QUEUE_URL: approvalQueue.queueUrl        
      },  
      stateMachineName: 'serverless-saas-deployment-machine',
      stateMachineType: 'STANDARD',
      tracingConfiguration: {
        enabled: true
      }, 
      loggingConfiguration: {         
        level: 'ALL',
        destinations: [
          {
            cloudWatchLogsLogGroup: {logGroupArn: stepfunctionLogGroup.logGroupArn}
          }
        ]
      }
    });

    const stateMachine = StateMachine.fromStateMachineName(this, 'DeploymentStateMachine', 'serverless-saas-deployment-machine');

    const stepFunctionAction = new codepipeline_actions.StepFunctionInvokeAction({
      actionName: 'InvokeStepFunc',
      stateMachine: stateMachine,
      stateMachineInput: codepipeline_actions.StateMachineInput.filePath(deployOutput.atPath('output.json'))

    });


    pipeline.addStage({
      stageName: 'InvokeStepFunctions',
      actions: [stepFunctionAction],
    });

    NagSuppressions.addResourceSuppressions(approvalQueue, [
      {
        id: "AwsSolutions-SQS3",
        reason: "Do not need a DLQ as the processing of the message is manual and can easily be reconstructed."
      },
    ]);

    NagSuppressions.addResourceSuppressions(pipeline, [
      {
        id: "AwsSolutions-IAM5", 
        reason: "Pipeline state machine operating on artifact bucket only.",
        appliesTo: [
          { regex: "/^Action::s3:(.*)$/" },
          "Resource::<ArtifactsBucket2AAC5544.Arn>/*",
          "Resource::arn:<AWS::Partition>:states:<AWS::Region>:<AWS::AccountId>:execution:serverless-saas-deployment-machine:*"
        ]
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "State machines needs access to the resources, not known ahead of time.",
        appliesTo: [
          "Resource::*", 
          "Resource::<prepdeploy39F96034.Arn>:*",
        ]
      },
    ], true);

    NagSuppressions.addResourceSuppressions(buildProject, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Build project needs to log, report, and execute.",
        appliesTo: [
          "Resource::arn:<AWS::Partition>:states:<AWS::Region>:<AWS::AccountId>:execution:serverless-saas-deployment-machine:*",
          "Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/codebuild/<Build45A36621>:*",
          "Resource::arn:<AWS::Partition>:codebuild:<AWS::Region>:<AWS::AccountId>:report-group/<Build45A36621>-*",
          "Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/codebuild/<Build45A36621>:*",
          "Resource::arn:<AWS::Partition>:codebuild:<AWS::Region>:<AWS::AccountId>:report-group/<Build45A36621>-*",
          "Resource::<ArtifactsBucket2AAC5544.Arn>/*",
          { regex: "/^Action::s3:(.*)$/" },
        ]
      },
      {
        id: "AwsSolutions-CB4",
        reason: "No custom KMS is needed, S3 objects are encrypted by S3 managed keys."
      }
    ], true);

    NagSuppressions.addResourceSuppressions(lambdaFunctionIterator, [
      {
        id: "AwsSolutions-IAM4",
        reason: "Basic execution is enough for lambda iterator"
      },
      {
        id: "AwsSolutions-L1",
        reason: "Python 3.9 is not on the deprecated list."
      },
    ], true);

    NagSuppressions.addResourceSuppressions(stepfunction_deploymentrole, [
      {
        id: "AwsSolutions-IAM5",
        reason: "StepFunction need to access dynamic resources",
        appliesTo: [
          "Resource::<ArtifactsBucket2AAC5544.Arn>/*",
          "Action::logs:*",
          "Action::lambda:*",
          "Action::apigateway:*",
          "Action::dynamodb:*",
          "Action::codedeploy:*",
          "Resource::*"
        ]
      }
    ], true)
  }
}
