# End-to-end deployment test

Deploys the workshop the way a self-deployer does, checks what participants touch first, tears it down and checks nothing is left. Design and the full list of checks: [docs/e2e-test.md](../../docs/e2e-test.md).

## Run it locally

Needs `aws`, `curl`, `jq` and admin credentials for a test account; the region must hold no other `SaaSOps` deployment and the account no workshop buckets. AWS internal (Isengard) accounts need the default `-x` deploy flag.

```bash
AWS_REGION=eu-west-2 tests/e2e/run.sh
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

## When to run it

By hand, from a maintainer's shell, after changes to `deployment/` or `App/` and before an event. There is no GitHub Actions workflow on purpose: the test needs admin in the account it deploys into, and a workflow would hand that role to anyone who can push to the repository (ADR-0004). One run at a time per account: every run uses the same stack name and the workshop's buckets are account-wide.
