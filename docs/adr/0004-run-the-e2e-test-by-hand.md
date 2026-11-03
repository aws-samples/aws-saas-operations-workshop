# ADR-0004: Run the end-to-end test by hand, not from GitHub Actions

- Status: Accepted
- Date: 2026-11-03
- Deciders: Dave Roberts (Workshop owner)

## Context

ADR-0002 put the end-to-end test (`tests/e2e`) in a GitHub Actions workflow with an OIDC role in the test account, on a weekly schedule. Setting it up showed what that role means: the deployment creates IAM roles, CloudFront distributions, Cognito pools and CloudTrail trails, so the role has to be `AdministratorAccess`. The workflow runs whatever is on `main`, and `main` of this public repository has no branch protection. Anyone with write access could therefore push a workflow change and run arbitrary code as admin in the test account. The only available test account is also shared with other workloads, which ADR-0002 ruled out.

## Options considered

### Option 1: Keep the workflow, add controls
Branch protection with required reviews, `CODEOWNERS` for `.github/workflows/` and `tests/e2e/`, required reviewers on the `e2e` environment, a dedicated empty account. Pros: results next to the code, one click to run. Cons: four controls to set up and keep; the admin role still exists in an account reachable from GitHub; a new dedicated account is needed.

### Option 2: Run the test by hand
A maintainer runs `tests/e2e/run.sh` from their own shell with their own admin credentials, after changes to `deployment/` or `App/` and before an event. Pros: no role for GitHub, no OIDC trust, no account tied to the repository, nothing to protect. Cons: nobody is reminded to run it; results live in the maintainer's shell and the artifact folder.

### Option 3: CodeBuild inside the test account on an EventBridge schedule
Pros: nothing outside AWS. Cons: a second deployment to maintain; the shared-account problem stays.

## Decision

Option 2. The workflow (`.github/workflows/e2e.yml`) and the role template (`tests/e2e/cfn/github-oidc-role.yaml`) are removed; the `e2e` GitHub environment and the `E2E_ROLE_ARN` variable are deleted. `tests/e2e/run.sh` is unchanged and is the test.

## Consequences

- Running the test is a maintainer habit, documented in `tests/e2e/README.md` and `AGENTS.md`: after changes to `deployment/` or `App/`, and before an event.
- No account trusts GitHub for this repository. There is nothing in the repository that can deploy or delete anything on its own.
- Revisit if the repository gets branch protection and a dedicated, empty test account; Option 1 then becomes workable.
