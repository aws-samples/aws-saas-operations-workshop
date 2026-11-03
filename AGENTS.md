# Agent notes for aws-saas-operations-workshop

Read this before changing or deploying anything in this repository.

## What this repository is

Source for the [AWS SaaS Operations workshop](https://catalog.workshops.aws/saas-operations). Workshop Studio and self-deployers both run `deployment/WorkshopStack.yaml`, which starts a CodeBuild project that runs `deployment/manage-workshop-stack.sh`. That script builds the SaaS application in CodeBuild with `deployment/create-workshop.sh` and, in parallel, deploys the IDE (AWS Code Editor, `deployment/code-editor/code-editor.yaml`), switches it to the participant instance profile, clones this repository onto it at `~/environment/aws-saas-operations-workshop` and installs the lab tooling with `deployment/bootstrap-ide.sh`. The IDE instance never runs with admin permissions: it starts on the Code Editor template's bootstrap role (ReadOnlyAccess, CodeCommit, Amazon Q Developer, `sts:AssumeRole` on `cdk-*`) for the few minutes until the swap, and the participant role from then on, before the URL is handed out. Design decisions live in `docs/adr/`.

## Deploying for a test

- Run `deployment/deploy-workshop.sh` with credentials for a **non-production** test account. It creates the `SaaSOps` stack and waits for it.
- **AWS internal (Isengard) accounts must pass `-x`**: `./deploy-workshop.sh -x`. Isengard accounts do not allow CloudTrail data events for DynamoDB, which Lab 5 needs. Without `-x` the `saas-operations-controlplane` stack fails with `The AWS::DynamoDB::Table data resource type is not supported` and rolls back. Workshop Studio accounts and most customer accounts do not need `-x`.
- To deploy from a branch or fork: `REPO_URL=... REPO_BRANCH_NAME=... ./deploy-workshop.sh -x`. CodeBuild clones that ref, so push first.
- A full deployment takes about 20 minutes (36 when the build still ran on the IDE, measured 2026-11-02 in eu-central-1). The IDE (~12 min including tooling) and the SaaS application (~18 min) are built side by side; the control plane stack and the pipeline run that creates the pooled tenant stack set the floor. The CodeBuild project times out at 60 minutes, which is also the CloudFormation custom-resource maximum.
- Registering the two Platinum tenants starts two more pipeline runs (~5 min each) that create their silo stacks; they may finish a few minutes after `SaaSOps` reports CREATE_COMPLETE. Check for `stack-*` stacks in UPDATE_COMPLETE before testing `SiloedTenant1`.
- Tear down by deleting the `SaaSOps` stack. That triggers `deployment/delete-workshop.sh` through CodeBuild, which empties buckets and removes tenant stacks, the control plane, the pipeline, the IDE stack, the template bucket and the SAM CLI managed stack (`aws-sam-cli-managed-default`, created by `sam sync` in Lab 2).

## Where to look when a deployment fails

- CodeBuild log group `/aws/codebuild/install-workshop-stack-codebuild`: stream `<build-id>` for the orchestration and the application build (lines prefixed `[app]`) and the IDE preparation (`[ide]`); stream `<instance-id>` for `bootstrap-ide.sh` running on the IDE instance (shipped by the CloudWatch agent).
- Parallel steps are collected with `wait_for_jobs`, which names the failed step (`Job 'admin-ui' FAILED`). Steps are safe to re-run: stack deploys converge, existing tenants and users are skipped.
- `SaaSOps-CodeEditor` stack events for IDE problems; `saas-operations-controlplane` and its nested stacks for application problems.
- The `CodeEditorUrl` output of `SaaSOps` carries the login token. Do not paste it into tickets or chat.

## Conventions

- Shell scripts in `deployment/` are sourced into one another; keep functions in the `_*.sh` files and entry points in the files without the underscore. `create-workshop.sh` runs in CodeBuild (or any admin shell); `bootstrap-ide.sh` runs on the IDE instance over SSM. Do not put deploy steps on the IDE: it only has the participant role.
- `deployment/code-editor/code-editor.yaml` is vendored unchanged from the Workshop Studio cookbook. Upgrade it by replacing the file, not by editing it.
- The lab content expects the repository at `~/environment/aws-saas-operations-workshop` on the IDE instance. Do not move it.
- Lambda functions in `App/` use `python3.9`. It is deprecated; function creation is blocked from 2027-07-29. Plan the upgrade before then.
- Record decisions that are hard to reverse as an ADR in `docs/adr/` (one file per decision, update the index in the same commit).
