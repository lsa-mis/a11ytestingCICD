# reports/

**Generated output — not committed.** Everything in this folder except this README is
produced by the accessibility audit and ignored by git.

Each audited route gets its own subfolder (`/` → `reports/home/`):

| File | Audience | Contents |
| --- | --- | --- |
| `summary.md` | People | Verdict, metadata, issue table, rule table, what still needs a human. Paste into a PR or ticket. |
| `report.json` | Machines | Full structured result — verdict, summary counts, issues, rule-level counts, CI/commit context. For dashboards or trend tracking. |
| `issues.csv` | Spreadsheets | One row per issue: route, page, issue, occurrences. |
| `rules.csv` | Spreadsheets | One row per rule: route, rule id, rule URI, failed / can't-tell / passed counts. |

## Producing them

Locally:

```bash
npm test
```

In CI, `.github/workflows/accessibility.yml` runs the same audit and uploads this whole
folder as the **`accessibility-reports`** artifact — downloadable from the run's *Artifacts*
section, and retained for 30 days. It uploads even when the gate fails, which is exactly
when you want the detail.

## Notes

- The report is written on every run, pass or fail. A passing run still records the
  `cantTell` count — the checks a machine can't decide, which need human review.
- Report generation never changes the pass/fail verdict; the gate is still
  "any rule with `failed > 0` blocks the merge".
- Adding a route? Call `writeAccessibilityReport(...)` with a different `route` in
  [`tests/support/report.ts`](../tests/support/report.ts) and it lands in its own subfolder.
