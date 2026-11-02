# Agent notes for aws-saas-operations-workshop

Read this before changing or deploying anything in this repository.

## What this repository is

Source for the [AWS SaaS Operations workshop](https://catalog.workshops.aws/saas-operations). Workshop Studio and self-deployers both run `deployment/WorkshopStack.yaml`, which starts a CodeBuild project that runs `deployment/manage-workshop-stack.sh`. That script deploys the IDE (AWS Code Editor, `deployment/code-editor/code-editor.yaml`), clones this repository onto the IDE instance at `~/environment/aws-saas-operations-workshop`, and runs `deployment/create-workshop.sh` there to build the SaaS application. Design decisions live in `docs/adr/`.

## Deploying for a test

- Run `deployment/deploy-workshop.sh` with credentials for a **non-production** test account. It creates the `SaaSOps` stack and waits for it.
- **AWS internal (Isengard) accounts must pass `-x`**: `./deploy-workshop.sh -x`. Isengard accounts do not allow CloudTrail data events for DynamoDB, which Lab 5 needs. Without `-x` the `saas-operations-controlplane` stack fails with `The AWS::DynamoDB::Table data resource type is not supported` and rolls back. Workshop Studio accounts and most customer accounts do not need `-x`.
- To deploy from a branch or fork: `REPO_URL=... REPO_BRANCH_NAME=... ./deploy-workshop.sh -x`. CodeBuild clones that ref, so push first.
- A full deployment takes about 36 minutes (measured 2026-11-02 in eu-central-1): ~6 min for the IDE stack, the rest for the SaaS application. The CodeBuild project times out at 60 minutes, which is also the CloudFormation custom-resource maximum.
- Tear down by deleting the `SaaSOps` stack. That triggers `deployment/delete-workshop.sh` through CodeBuild, which empties buckets and removes tenant stacks, the control plane, the pipeline, the IDE stack and the template bucket.

## Where to look when a deployment fails

- CodeBuild log group `/aws/codebuild/install-workshop-stack-codebuild`: stream `<build-id>` for the orchestration, stream `<instance-id>` for `create-workshop.sh` running on the IDE instance (shipped by the CloudWatch agent).
- `SaaSOps-CodeEditor` stack events for IDE problems; `saas-operations-controlplane` and its nested stacks for application problems.
- The `CodeEditorUrl` output of `SaaSOps` carries the login token. Do not paste it into tickets or chat.

## Conventions

- Shell scripts in `deployment/` are sourced into one another; keep functions in the `_*.sh` files and entry points in the files without the underscore.
- `deployment/code-editor/code-editor.yaml` is vendored unchanged from the Workshop Studio cookbook. Upgrade it by replacing the file, not by editing it.
- The lab content expects the repository at `~/environment/aws-saas-operations-workshop` on the IDE instance. Do not move it.
- Lambda functions in `App/` use `python3.9`. It is deprecated; function creation is blocked from 2027-07-29. Plan the upgrade before then.
- Record decisions that are hard to reverse as an ADR in `docs/adr/` (one file per decision, update the index in the same commit).
