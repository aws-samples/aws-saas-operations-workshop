# End-to-end test design

Status: implemented 2026-11-02 in `tests/e2e/`, run by hand (ADR-0002 chose GitHub Actions; ADR-0004 superseded it).

## Goal

Prove, in a test account, that the workshop still deploys from `main`, that what participants touch first works, and that teardown leaves nothing behind. A red run means a participant would hit the same wall at an event.

## Scope

In: deployment through `WorkshopStack.yaml` exactly as a self-deployer does, the IDE, the control plane API, one pooled and one siloed tenant login and API call, the three static sites, the dashboards stack, the build log, teardown.
Out: lab exercises themselves (load simulator, dashboards content, isolation tests, Lab 5 CloudTrail), browser automation, Workshop Studio provisioning.

## Shape

```
maintainer shell with admin credentials for the test account
   tests/e2e/run.sh
     1 preflight   account, region, no SaaSOps leftovers
     2 deploy      deploy-workshop.sh $E2E_DEPLOY_FLAGS   (default -x)      ~20 min
     3 verify      35 checks, see table
     4 teardown    wait for a settled status, delete SaaSOps, wait, assert nothing left   ~10 min
     5 report      report.md + logs in the artifact folder, exit 1 on any failed check
```

`run.sh` is plain bash, AWS CLI, curl and jq, like the deployment scripts: `AWS_PROFILE=<test-account> AWS_REGION=<empty region> tests/e2e/run.sh`.

## Checks

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Stack created | `describe-stacks SaaSOps`, after waiting for a status that is not `*_IN_PROGRESS` | CREATE_COMPLETE within 75 min |
| 2 | IDE URL published | output `CodeEditorUrl` | present, host is `*.cloudfront.net` |
| 3 | IDE healthy | `GET /healthz` on that host | 200 |
| 4 | IDE auth enforced | `GET /` without token | 403 |
| 5 | IDE token works | `GET` the full URL | 302 or 200 |
| 6 | Participant role | instance profile of the IDE instance | name from SSM `/SaaSOps/IDE/ParticipantInstanceProfileName` |
| 7 | Build finished | `/aws/codebuild/install-workshop-stack-codebuild`: stream `<build-id>` of the latest build (via `list-builds-for-project`) and stream `<instance-id>` | build stream contains `Success - Workshop created!`; instance stream contains `Success - IDE ready!` |
| 8 | Control plane exports | `list-exports` | AdminApiGatewayUrl, AdminAppSite, ApplicationSite, LandingApplicationSite present |
| 9 | Static sites | `GET` the three site URLs | 200 |
| 10 | Tenant bootstrap | `GET {admin}/tenant/init/PooledTenant1` and `/SiloedTenant1` | JSON with userPoolId, appClientId, apiGatewayUrl |
| 11 | Tenant admin user | `cognito-idp list-users` for `success+PooledTenant1@simulator.amazonses.com` | one user |
| 12 | Tenant login | `admin-set-user-password` then `initiate-auth USER_PASSWORD_AUTH` | IdToken returned |
| 13 | Tenant API | `GET {tenantApi}/products` and `/orders` with the token | 200, JSON array |
| 14 | Siloed tenant API | same as 10-13 for SiloedTenant1, after waiting up to 15 min for its `apiGatewayUrl` (the silo stack is created by a pipeline run that starts when the tenant is registered and usually finishes after `SaaSOps` is CREATE_COMPLETE) | 200 |
| 15 | Tenant stacks | `list-stacks` filtered on `stack-*`, after waiting for the `SiloedTenant1` and `PlatinumTestTenant` APIs | exactly `stack-pooled` and two silo stacks, all `CREATE_COMPLETE` or `UPDATE_COMPLETE` (the pipeline run updates `stack-pooled` and ends with an update of each silo stack; the check waits up to 5 min for in-progress updates). Both Platinum tenants are provisioned by one pipeline run; a silo stack that rolled back leaves the other tenant working, so SiloedTenant1 alone does not show it |
| 16 | Dashboards | stack `saasOpsWorkshop-saasOperationsDashboard` | CREATE_COMPLETE |
| 17 | Teardown | wait until the status is not `*_IN_PROGRESS` (a failed deploy is still rolling back and cannot be deleted yet), `delete-stack SaaSOps`, wait | gone within 40 min |
| 18 | Nothing the workshop owns is left | stacks `stack-*`, `saas-operations-*`, `saasOpsWorkshop-*`, `SaaSOps*`, `aws-sam-cli-managed-default` (left by `sam sync` in Lab 2, removed by `delete-workshop.sh`) in any non-deleted status; buckets `saas-operations-*`, `sam-bootstrap-*`, `aws-sam-cli-managed-default-*`; user pools `*-SaaSOperationsUserPool` | none. Not covered because `delete-workshop.sh` does not own them: the CDK bootstrap (`CDKToolkit`, `cdk-hnb659fds-*`) and the CodeBuild and Lambda log groups |

Checks 10-14 reuse the logic of `scripts/init-test.sh`; check 12 sets the two tenant admin passwords permanently. Teardown always runs, also after a failed check, unless `E2E_KEEP=1` is set for debugging; `E2E_SKIP_DEPLOY=1` implies `E2E_KEEP=1`. The IDE token (`tkn=`) is redacted from every artifact before the report is written.

## Contracts the test depends on

- Stack name `SaaSOps`, output `CodeEditorUrl` (`deployment/WorkshopStack.yaml`).
- Export names `SaaS-Operations-*` (`App/server/bootstrap-template.yaml`).
- Tenant names and emails created by `create_tenants` (`deployment/_create-workshop.sh`).
- SSM parameter names `/SaaSOps/IDE/*` (`deployment/_workshop-conf.sh`).
- IDE stack `SaaSOps-CodeEditor` with logical resource `CodeEditorInstance` (`deployment/code-editor/code-editor.yaml`).
- Log group `/aws/codebuild/install-workshop-stack-codebuild` with the `Success - Workshop created!` line in the CodeBuild stream (`deployment/_manage-workshop-stack.sh`) and `Success - IDE ready!` in the `<instance-id>` stream (`deployment/bootstrap-ide.sh`).

A change to any of these must update the test in the same PR.

## Runner

- A maintainer runs `tests/e2e/run.sh` from a shell with admin credentials for the test account, after changes to `deployment/` or `App/` and before an event. The deployment creates IAM roles, CloudFront, Cognito and CloudTrail, so the credentials must be admin; that is why no CI system holds them (ADR-0004).
- Output: `report.md` (pass/fail table) and the full logs (CodeBuild and instance stream, paged with `filter-log-events`, IDE token redacted) in `$E2E_ARTIFACT_DIR`, default `./e2e-artifacts`.

## Cost and time

One run: about 35 minutes wall clock, roughly 1 EC2 hour (m5.xlarge), one CloudFront distribution, a few hundred Lambda and API calls. Low single-digit dollars per run.

## Open points

1. Isengard needs `-x`; a Workshop Studio-style account should also be tested without `-x` eventually. Separate run.
2. A test for the load simulator (`scripts/init-initialize.sh`) needs the IDE instance, which the sandbox cannot reach over SSM. Left out for now.
