# End-to-end deployment test

Deploys the workshop the way a self-deployer does, checks what participants touch first, tears it down and checks nothing is left. Design and the full list of checks: [docs/e2e-test.md](../../docs/e2e-test.md).

## Run it locally

Needs `aws`, `curl`, `jq` and credentials for a dedicated, empty test account.

```bash
AWS_PROFILE=pg AWS_REGION=eu-central-1 tests/e2e/run.sh
```

About 50 minutes to deploy, 1 minute to verify, 10 minutes to tear down. The report lands in `./e2e-artifacts/report.md` together with the CodeBuild and IDE build logs.

| Variable | Default | Meaning |
|---|---|---|
| `E2E_DEPLOY_FLAGS` | `-x` | Flags for `deploy-workshop.sh`. `-x` skips the Lab 5 CloudTrail resources and is required in AWS internal (Isengard) accounts. |
| `E2E_KEEP` | `0` | `1` leaves the deployment in place after the checks. |
| `E2E_SKIP_DEPLOY` | `0` | `1` verifies an existing deployment instead of creating one. |
| `REPO_URL`, `REPO_BRANCH_NAME` | upstream `main` | What CodeBuild clones. Push first. |

Exit code 0 only when every check passed and teardown left nothing behind.

## Scheduled run

`.github/workflows/e2e.yml` runs every Monday 03:00 UTC and on demand. One-time setup in the test account:

```bash
aws cloudformation deploy --stack-name saasops-workshop-e2e-role \
  --template-file tests/e2e/cfn/github-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --stack-name saasops-workshop-e2e-role \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
```

Put that ARN into the repository variable `E2E_ROLE_ARN` and create a GitHub environment named `e2e` (manual runs from branches other than `main` go through it, so a reviewer can approve them). The role is admin; the account must hold nothing else.
