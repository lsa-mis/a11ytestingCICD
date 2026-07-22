# Accessibility gate overrides

The accessibility audit is **enforcing by default**: a failed Alfa rule fails the
`Accessibility audit (Alfa)` check and blocks a merge when that check is required.
Keep it that way for routine pull requests.

## One pull request: maintainer-only bypass

For a rare urgent exception, use a GitHub branch ruleset bypass instead of changing
the test or removing the required check. This keeps the failed check and all of its
evidence visible on the pull request.

An administrator configures it once:

1. Open **Settings → Rules → Rulesets**, then edit the ruleset that protects `main`.
2. In **Bypass list**, choose **Add bypass** and add a small maintainer team or role.
3. Set the bypass permission to **For pull requests only**. Do not use **Always allow**
   unless direct pushes are intentionally permitted.
4. Keep **Accessibility audit (Alfa)** in the required status checks.

An authorized maintainer can then use the pull request's GitHub merge control to
bypass the rule when necessary. Record the reason, owner, and remediation follow-up
in the pull request before merging. GitHub keeps the pull request and audit-log trail.

GitHub documents the ruleset bypass list and its pull-request-only option in
[Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

## Temporary rollout: advisory mode

Use advisory mode only when rolling the gate out across an existing codebase. The
audit still runs and, in CI, creates the workbook, JSON evidence, Playwright
attachments, and CI log links; it simply does not fail the test for Alfa rule
failures. Local runs remain terminal-only.

### One manual run

Open **Actions → CI → Run workflow** and select **advisory** under
**Whether this manually-run audit blocks on failed rules**. This does not change the
enforcement of pull-request runs.

### Temporary repository-wide setting

An administrator can open **Settings → Secrets and variables → Actions → Variables**
and set `A11Y_ENFORCEMENT` to `advisory`. Every audit will then be non-blocking until
the variable is changed back to `enforce` (or removed). Treat this as a time-bounded
rollout setting, not a per-pull-request escape hatch.

## Decision rule

- Use a **ruleset bypass** for one exceptional, reviewed pull request.
- Use **advisory mode** for a short, organization-approved rollout window.
- Restore **enforce** mode and fix the underlying issue as soon as possible.
