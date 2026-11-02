# ADR-0003: Build the SaaS application in CodeBuild, not on the IDE instance

- Status: Accepted
- Date: 2026-11-02
- Deciders: Dave Roberts (Workshop owner)

## Context

Since the Cloud9 days the workshop was built *on* the IDE instance: the CodeBuild project started by `WorkshopStack.yaml` created the IDE, attached an admin instance profile, ran `create-workshop.sh` there over SSM, then swapped the profile for the participant one and rebooted. A measured run on 2026-11-02 took 36 minutes, of which the IDE stack (6 min), two profile swaps with reboots (4 min), tool installation on the instance (1.5 min) and SSM round trips were on the critical path, and the two heavy steps that are independent of each other, the tenant pipeline CDK deploy and the control plane SAM deploy, ran one after the other. Failures in parallel steps were invisible: `wait_for_background_jobs` only waited, it did not check exit codes, and the retry loop in `manage-workshop-stack.sh` could re-register tenants.

The participant instance also carried `AdministratorAccess` for the whole build.

## Options considered

### Option 1: Keep building on the IDE, parallelise inside `create-workshop.sh`
Pros: smallest change. Cons: IDE creation, profile swaps and reboots stay on the critical path (~12 min); the admin role stays on the participant box.

### Option 2: Build in the CodeBuild project, prepare the IDE in parallel
The CodeBuild project already runs with an admin service role and has Node.js, Python and the AWS CLI. `create-workshop.sh` runs there; the IDE only gets the participant role, the repository clone and the lab tooling (`bootstrap-ide.sh`), in parallel.
Pros: ~10 min off the critical path, no admin role on the IDE, build log in one CodeBuild stream, `create-workshop.sh` runnable from any admin shell. Cons: the CodeBuild image has Node.js 22, not the Node.js 20 the IDE uses, so the Angular 14 UIs are built on 22; larger CodeBuild compute (`BUILD_GENERAL1_LARGE`) for the parallel builds.

### Option 3: Replace the bash orchestration with a Step Functions state machine
Pros: per-step retries and visibility, natural DAG. Cons: a rewrite of ~600 lines of bash and of the pages that quote its output; no time gain beyond Option 2, because the DAG is the same.

## Decision

Option 2. `_manage-workshop-stack.sh` runs `prepare_ide` (IDE stack, participant profile, clone, `bootstrap-ide.sh`) and `create-workshop.sh` as two background jobs and fails if either fails. Inside `create-workshop.sh` the tenant pipeline and the control plane deploy in parallel, then the pipeline run, the three UIs and the dashboards. `wait_for_jobs` replaces `wait_for_background_jobs` wherever a failure must fail the build. The build instance role and the reboot are gone; the one remaining profile swap is verified by asking the instance which role it runs as. Tenant registration and user creation skip what already exists, so the retry loop in `manage-workshop-stack.sh` is safe; user names are deterministic (`<tenant>_user_<n>`) instead of `date +%s`, which also removes the one-second sleep per user. Option 3 stays open as the next step once the end-to-end test (ADR-0002) exists to prove it.

## Consequences

- Expected deployment time ~20 minutes (to be confirmed by the e2e test), down from 36.
- The IDE instance never has admin permissions; `WorkshopStack.yaml` loses `BuildInstanceRole`, `BuildInstanceProfile` and the matching SSM parameter. For the few minutes before the swap it runs the Code Editor template's bootstrap role (ReadOnlyAccess, CodeCommit, Amazon Q Developer, `sts:AssumeRole` on `cdk-*`, which `cdk bootstrap` creates in the other track at about the same time); the URL is not handed out until the swap has been verified.
- Lab scripts are unchanged: they still find the repository at `~/environment/aws-saas-operations-workshop` with Node.js 20, CDK, SAM CLI, artillery and the isolation-test packages installed. Two artefacts the on-IDE build used to leave behind are now produced by `bootstrap-ide.sh` instead: the compiled tenant pipeline CDK app (`App/server/TenantPipeline`, for `cdk deploy` from the IDE) and a `samconfig-bootstrap.toml` that names this account's SAM bucket. The bucket name is deterministic (`sam-bootstrap-bucket-<account>-<region>`) so both sides resolve the same one without talking to each other.
- `create-workshop.sh` no longer removes `~/.aws/credentials` or configures the CloudWatch agent; `bootstrap-ide.sh` does that on the instance.
- The CodeBuild image alias moves from `amazonlinux2-x86_64-standard:5.0` to its current name `amazonlinux-x86_64-standard:5.0` (same Amazon Linux 2023 image).
- Revisit if the Angular 14 builds misbehave on Node.js 22 (fallback: install Node.js 20 from nodesource in `install_build_tools`) or when the orchestration moves to Step Functions.
