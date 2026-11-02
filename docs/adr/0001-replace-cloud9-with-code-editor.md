# ADR-0001: Replace AWS Cloud9 with AWS Code Editor as the workshop IDE

- Status: Accepted
- Date: 2026-11-02
- Deciders: Dave Roberts (Workshop owner)

## Context

The workshop IDE and build host was an AWS Cloud9 environment, created by a CDK app in `deployment/cloud9` from the CodeBuild project in `deployment/WorkshopStack.yaml`. Cloud9 has been closed to new AWS accounts since 2024-07-25 and is on the Workshop Studio unsupported-services list. Every fresh account, including every Workshop Studio event account, fails at `AWS::Cloud9::EnvironmentEC2`, so the workshop cannot be deployed at all.

The lab content refers to the repository at `~/environment/aws-saas-operations-workshop` on more than twenty pages, and the build scripts run on the IDE instance over SSM with an admin instance profile that is swapped for a restricted one once the build is done.

## Options considered

### Option 1: Workshop Studio Code Editor template
The Workshop Studio team publishes `code-editor.yaml` (AWS Code Editor, a Code-OSS fork, on EC2 behind CloudFront). It passed Content Security Review, is what new workshops use, and exposes a single `URL` output.
Pros: sanctioned, maintained by the Workshop Studio team, drop-in upgrades by replacing one file, works in Workshop Studio and in customer accounts. Cons: 1,400-line template vendored into the repo; the user and home folder differ from Cloud9 (`participant`, not `ec2-user`).

### Option 2: aws-samples/sample-code-server-on-aws (code-server)
Community code-server on EC2 behind CloudFront.
Pros: small template. Cons: not the Workshop Studio standard, third-party IDE build, no security review.

### Option 3: Plain EC2 build host, no IDE
Pros: simplest. Cons: participants need an IDE and terminal for every lab; would push them to CloudShell with a different file layout and break the content.

## Decision

Option 1. The template is vendored unchanged as `deployment/code-editor/code-editor.yaml` and deployed by `manage-workshop-stack.sh` with `aws cloudformation deploy`, replacing the CDK app. The IDE user is `participant` and the editor opens `/home/participant/environment`, so the repository still lives at `~/environment/aws-saas-operations-workshop` and the lab content keeps working. The participant and build instance roles move into `WorkshopStack.yaml`; the instance profile swap stays as it was. The IDE URL is returned to CloudFormation as custom resource data and surfaced as the `CodeEditorUrl` stack output, which Workshop Studio can show in Event Outputs.

## Consequences

- Deployment works again in new accounts and in Workshop Studio.
- The `deployment/cloud9` CDK app and `deployment/iam_policy.json` are removed; the participant policy lives inline in `WorkshopStack.yaml` without the `cloud9:*` and `ec2:ModifyVolume` actions.
- Tooling the Cloud9 AMI shipped (Node.js, SAM CLI, CDK, Docker) is now installed by `install_dependencies` on the instance. `sam build` runs on the host instead of in a container, which works because Amazon Linux 2023 ships Python 3.9.
- The Workshop Studio content (getting-started pages, lab pages mentioning Cloud9, `static/WorkshopStack.yaml`, `contentspec.yaml` output `CodeEditorUrl`) must be updated to match.
- Upgrading the IDE means replacing `code-editor.yaml` with a newer version from the Workshop Studio cookbook.
- Revisit if Workshop Studio provides a native IDE option that removes the need for a self-managed instance.
