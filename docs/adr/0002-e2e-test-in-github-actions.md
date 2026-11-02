# ADR-0002: Run the end-to-end test from GitHub Actions with OIDC

- Status: Accepted
- Date: 2026-11-02
- Deciders: Dave Roberts (Workshop owner)

## Context

The workshop broke silently when Cloud9 closed to new accounts; nobody deployed it for months. We want a scheduled deployment test (see `docs/e2e-test.md`) that runs the real `deploy-workshop.sh`, verifies the result and tears it down, in a dedicated AWS test account.

## Options considered

### Option 1: GitHub Actions on a schedule, OIDC role in the test account
Pros: results next to the code, PRs can trigger it by hand, no stored AWS keys, runner minutes are free for the public repo. Cons: the test account trusts GitHub's OIDC provider; the role needs admin rights, so the account must be a sandbox.

### Option 2: EventBridge schedule and CodeBuild inside the test account
Pros: nothing outside AWS, no OIDC trust. Cons: a second deployment to maintain, results only visible in the account, no link from a PR to a run.

### Option 3: Manual runs before events
Pros: nothing to build. Cons: this is what we had.

## Decision

Option 1. `tests/e2e/run.sh` holds all logic and runs locally too; the workflow only provides credentials and reporting. The OIDC provider and role come from `tests/e2e/cfn/github-oidc-role.yaml`, deployed once into the sandbox account.

## Consequences

- The sandbox account must stay free of other workloads, because teardown checks look for leftovers by name and the role is admin.
- The trust policy pins the repository and the `e2e` environment. A job in an environment always presents the environment subject, never the branch, so the environment's deployment branch policy (`main` only) is what keeps other branches off the role; required reviewers are not used because they would block the unattended schedule.
- Revisit if GitHub Actions is disabled for the organisation or the test needs access the sandbox cannot grant over OIDC.
