import * as cdk from 'aws-cdk-lib';
import { CfnEnvironmentEC2 } from 'aws-cdk-lib/aws-cloud9';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { CompositePrincipal, InstanceProfile, ManagedPolicy, PolicyDocument, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';

export interface Cloud9StackProps extends cdk.StackProps {
  workshop: string;
  ownerArn?: string;
  imageId?: string;
  instanceType?: string;
  vpc?: Vpc;
}

export class Cloud9Stack extends cdk.Stack {
  readonly c9: CfnEnvironmentEC2;
  constructor(scope: Construct, id: string, props: Cloud9StackProps) {
    super(scope, id, props);
    // Use the default VPC unless one is supplied
    const vpc =
      props?.vpc ??
      Vpc.fromLookup(this, "VPC", { isDefault: true, })
      ;
    
    // Create the Cloud9 environment
    this.c9 = new CfnEnvironmentEC2(this, props.workshop+'-C9Instance', {
      imageId: props?.imageId ?? 'amazonlinux-2023-x86_64',
      instanceType: props?.instanceType ?? 'm6i.large',
      description: props.workshop+" Cloud9",
      ownerArn: props.ownerArn,
      subnetId: vpc.publicSubnets[0].subnetId,
      automaticStopTimeMinutes: 180,
      tags: [{ key: 'Workshop', value: props.workshop }],
    });

    const participantPolicy = new ManagedPolicy(this, 'WsPolicy', {
      document: PolicyDocument.fromJson(JSON.parse(readFileSync(`${__dirname}/../../iam_policy.json`, 'utf-8'))),
    });
    const participantCloud9Role = new Role(this, "ParticipantC9Role", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('ec2.amazonaws.com'),
        new ServicePrincipal('ssm.amazonaws.com')
      ),
      managedPolicies: [
        participantPolicy,
        ManagedPolicy.fromAwsManagedPolicyName("ReadOnlyAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentAdminPolicy"),
      ],
    });
    const participantCloud9InstanceProfile = new InstanceProfile(
      this,
      "ParticipantC9RoleC9InstanceProfile",
      {
        role: participantCloud9Role,
      }
    );
    const participantCloud9InstanceProfileName = '/'+props.workshop+'/Cloud9/ParticipantInstanceProfileName';
    new StringParameter(this, "ParticipantC9RoleC9InstanceProfileNameSSMParameter", {
      parameterName: participantCloud9InstanceProfileName,
      stringValue: participantCloud9InstanceProfile.instanceProfileName,
    });
    
    const buildCloud9Role = new Role(this, "BuildC9Role", {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('ec2.amazonaws.com'),
        new ServicePrincipal('ssm.amazonaws.com')
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });
    const buildCloud9InstanceProfile = new InstanceProfile(
      this,
      "BuildC9RoleC9InstanceProfile",
      {
        role: buildCloud9Role,
      }
    );
    const buildCloud9InstanceProfileName = '/'+props.workshop+'/Cloud9/BuildInstanceProfileName';
    new StringParameter(this, "BuildC9RoleC9InstanceProfileNameSSMParameter", {
      parameterName: buildCloud9InstanceProfileName,
      stringValue: buildCloud9InstanceProfile.instanceProfileName,
    }); 
  }
}
