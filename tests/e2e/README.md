# End-to-end deployment test

Deploys the workshop the way a self-deployer does, checks what participants touch first, tears it down and checks nothing is left. Design and the full list of checks: [docs/e2e-test.md](../../docs/e2e-test.md).

## Run it locally

Needs `aws`, `curl`, `jq` and credentials for a dedicated, empty test account. AWS internal (Isengard) accounts need the default `-x` deploy flag.

```bash
AWS_REGION=eu-central-1 tests/e2e/run.sh
```

About 20 minutes to deploy, 1 minute to verify, 10 minutes to tear down. The report lands in `./e2e-artifacts/report.md` together with the CodeBuild and IDE bootstrap logs. The IDE login token (`tkn=`) is redacted from every file in that folder.

| Variable | Default | Meaning |
|---|---|---|
| `E2E_DEPLOY_FLAGS` | `-x` | Flags for `deploy-workshop.sh`. `-x` skips the Lab 5 CloudTrail resources and is required in AWS internal (Isengard) accounts. |
| `E2E_KEEP` | `0` | `1` leaves the deployment in place after the checks. |
| `E2E_SKIP_DEPLOY` | `0` | `1` verifies an existing deployment instead of creating one. Implies `E2E_KEEP=1`; the test never deletes a deployment it did not create. |
| `REPO_URL`, `REPO_BRANCH_NAME` | upstream `main` | What CodeBuild clones. Push first. |
| `DEPLOY_TIMEOUT_MIN`, `DELETE_TIMEOUT_MIN` | `75`, `40` | Upper bounds for the deploy and the delete. |
| `SILO_TIMEOUT_MIN` | `15` | How long to wait for the `SiloedTenant1` and `PlatinumTestTenant` stacks, whose pipeline run finishes after `SaaSOps` is complete. |

Side effect in both modes: the login check sets the `PooledTenant1` and `SiloedTenant1` admin passwords to `Lab@12345` (permanent).

Exit code 0 only when every check passed and teardown left nothing behind.

## Scheduled run

`.github/workflows/e2e.yml` runs every Monday 03:00 UTC and on demand. One run at a time for the whole repository (`concurrency: e2e`), because every run uses the same account and stack name.

One-time setup in the test account:

```bash
aws cloudformation deploy --stack-name saasops-workshop-e2e-role \
  --template-file tests/e2e/cfn/github-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --stack-name saasops-workshop-e2e-role \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
```

One-time setup on GitHub (Settings):

1. Repository variable `E2E_ROLE_ARN` = the role ARN printed above.
2. Environment `e2e` with deployment branch policy **Selected branches and tags: `main`**. No required reviewers (they would block the unattended Monday run).

The role trusts only tokens issued for the `e2e` environment, so that branch policy is the control that keeps other branches off the admin role; a manual run from a feature branch fails at job start with "branch not allowed to deploy". The role is admin; the account must hold nothing else.

GitHub disables scheduled workflows after 60 days without repository activity. If the Monday run stops appearing, re-enable it under Actions.
