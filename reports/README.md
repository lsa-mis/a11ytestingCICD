# reports/

**Generated output — not committed.** Everything in this folder except this README is
produced by the accessibility audit and ignored by git.

Each audited route gets its own subfolder (`/` → `reports/home/`):

| File | Audience | Contents |
| --- | --- | --- |
| `accessibility-report.xlsx` | Remediation teams | Nine-sheet workbook matching the house format: summary, issue/worklist views, page references, coverage, manual test tracking, and evidence. |
| `summary.md` | People | Verdict, metadata, issue table, rule table, what still needs a human. Paste into a PR or ticket. |
| `report.json` | Machines / investigators | Full structured result — verdict, summary counts, rule-level counts, CI context, and Alfa's exact serialized outcomes (targets and diagnostics). |
| `issues.csv` | Spreadsheets | One row per issue: route, page, issue, occurrences. |
| `rules.csv` | Spreadsheets | One row per rule: route, rule id, rule URI, failed / can't-tell / passed counts. |

The `npm run test:a11y` report index also explains the merge choices: enforce by default, manually choose advisory for a controlled audit run, or use the configured maintainer-only ruleset bypass for one pull request. See [`docs/A11Y-OVERRIDES.md`](../docs/A11Y-OVERRIDES.md) for the guardrails.

## Producing them

The bundle is **CI-only**. A local `npm run test:a11y` is terminal-first: it prints the
verdict, page, failed rule, occurrence count, rule-guidance URL, detailed Alfa trail,
and the Figma architecture link—but creates no XLSX, JSON, Markdown, or CSV files.

In CI, `.github/workflows/accessibility.yml` runs the same audit and uploads this whole
folder as the **`accessibility-reports`** artifact — downloadable from the run's *Artifacts*
section, and retained for 30 days. It uploads even when the gate fails, which is exactly
when you want the detail.

## Notes

- CI writes the report on every CI run, pass or fail. A passing run still records the
  `cantTell` count — the checks a machine can't decide, which need human review.
- The audit defaults to **enforce** mode. An administrator can set the GitHub Actions
  repository variable `A11Y_ENFORCEMENT` to `advisory` during a controlled rollout;
  failures still appear in every report, but do not fail the test. A manually dispatched
  workflow can also choose advisory for that one run. See
  [`docs/A11Y-OVERRIDES.md`](../docs/A11Y-OVERRIDES.md) before using either option.
- Report generation never changes the pass/fail verdict; the gate is still
  "any rule with `failed > 0` blocks the merge".
- Adding a route? Call `writeAccessibilityReport(...)` with a different `route` in
  [`tests/support/report.ts`](../tests/support/report.ts) and it lands in its own subfolder.
