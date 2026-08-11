# Alfa A11y CI/CD

[![Accessibility audit (Alfa)](https://github.com/lsa-mis/a11ytestingCICD/actions/workflows/accessibility.yml/badge.svg)](https://github.com/lsa-mis/a11ytestingCICD/actions/workflows/accessibility.yml)

A small front-end project that demonstrates how to wire **[Siteimprove Alfa](https://github.com/siteimprove/alfa)**
— an open, standards-based accessibility conformance testing engine — into a
**GitHub Actions CI/CD pipeline**.

Every push and pull request renders the site in a real browser, audits the DOM
against WCAG (via Alfa's ACT rules), and **fails the build if there are
accessibility violations**.

> ### 🚀 Want to do this in your own project?
>
> - **[Step-by-step guide site](https://lsa-mis.github.io/a11ytestingCICD/a11ycicdguideforgithub/)** — the hosted, visual walkthrough (GitHub Pages)
> - **[Copy-paste checklist](docs/CHECKLIST.md)** — ~15 minutes, top to bottom
> - **[Full CI accessibility guide](docs/CI-ACCESSIBILITY-GUIDE.md)** — every piece explained, for React, Next.js, Vue, Angular, Svelte, Astro, static sites, or a deployed preview URL

## Stack

| Concern            | Tool                                                            |
| ------------------ | --------------------------------------------------------------- |
| Front-end          | [Vite](https://vitejs.dev/) + TypeScript (vanilla)              |
| Browser automation | [Playwright](https://playwright.dev/)                           |
| Accessibility      | `@siteimprove/alfa-test-utils` + `@siteimprove/alfa-playwright` |
| CI/CD              | GitHub Actions (`.github/workflows/accessibility.yml`)          |

## Project layout

```
.
├── index.html                          # Accessible landing page (Vite entry)
├── src/
│   ├── main.ts                         # Progressive-enhancement JS
│   └── style.css                       # High-contrast, keyboard-friendly styles
├── tests/
│   ├── accessibility.spec.ts           # The Alfa accessibility gate
│   └── support/report.ts               # Terminal guidance + CI report artifacts
├── playwright.config.ts                # Boots the dev server + runs the audit
├── .github/workflows/accessibility.yml # The CI/CD pipeline
├── a11ycicdguideforgithub/             # The hosted step-by-step guide site (GitHub Pages)
└── docs/
    ├── CHECKLIST.md                    # Copy-paste setup checklist
    ├── CI-ACCESSIBILITY-GUIDE.md       # Full framework-agnostic guide
    └── ACCESSIBILITY.md                # How this repo's gate works
```

## Quick start

```bash
npm install                       # install dependencies
npx playwright install chromium   # download the browser Alfa audits in
npm run dev                       # http://localhost:5173
```

## Run the accessibility audit locally

```bash
npm run test:a11y
```

Playwright starts the dev server automatically and Alfa audits the rendered page.
No report files are created locally. The default **enforcing** mode exits non-zero
when a rule fails—the same gate that runs in CI.

## Developer-focused reporting

Recent reporting changes make a failure actionable directly from the terminal.
For each failed rule, `npm run test:a11y` prints the affected source file and line
when it can be matched, the reason Alfa reported it, and a safe starting fix:

```text
[FAILED] violations.html (2 occurrence(s))
Why: The image does not have an accessible name
Code: violations.html:41  <img src="/vite.svg" width="48" height="48" />
Change to: <img src="image.svg" alt="Describe the image purpose">
```

The report also includes the Alfa rule link, occurrence count, and detailed Alfa
targets/diagnostics. Source-line matching is available for the file-backed markup
patterns covered by the report; dynamically generated DOM still includes Alfa's
target evidence and rule guidance rather than a guessed source location.

### Local runs versus CI artifacts

Local runs stay file-free and print the developer guidance above. In GitHub
Actions, the same audit additionally writes and uploads an `accessibility-reports`
artifact for each audited route at `reports/<route>/`:

| File | Purpose |
| --- | --- |
| `accessibility-report.xlsx` | Nine-sheet remediation and tracking workbook |
| `report.json` | Complete machine-readable audit evidence and Alfa outcomes |
| `summary.md` | Human-readable scan summary |
| `issues.csv` | Issue-level export |
| `rules.csv` | Rule-level export |

Artifacts are uploaded even when the audit fails, so the evidence remains
available from the failed workflow run.

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # type-check + production build
```

## How the CI/CD pipeline works

`.github/workflows/accessibility.yml` runs two jobs on every push/PR to `main`:

1. **Type-check & build** — `npm ci`, `npm run typecheck`, `npm run build`.
2. **Accessibility audit (Alfa)** — installs Chromium, runs the Alfa audit, and
   uploads both the Playwright HTML report and the generated accessibility report
   bundle (XLSX, Markdown, JSON, and CSV) as build artifacts. A WCAG violation
   fails this job and therefore blocks the merge.

To enforce the gate, mark the **Accessibility audit (Alfa)** check as required in
your branch protection / ruleset for `main`.

For a maintainer-only exception path or a temporary advisory rollout, see
[Accessibility gate overrides](docs/A11Y-OVERRIDES.md). Normal pull requests should
remain enforcing.

## How the gate works (in code)

The audit is scoped to **WCAG 2.1 level AA + Alfa Best Practices + ARIA**
(67 rules). See [`tests/accessibility.spec.ts`](tests/accessibility.spec.ts):

```ts
// A rule is included if it is WCAG 2.1 A/AA, a Best Practice, or an ARIA rule.
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) || Rules.bestPracticesFilter(rule) || Rules.ARIAFilter(rule);

await page.goto("/");
const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
const alfaResult = await Audit.run(alfaPage, { rules: { include: conformanceTarget } });

const failingRules = alfaResult.resultAggregates.filter((a) => a.failed > 0);
expect(failingRules.size).toBe(0);                          // fail on violations
```

## Documentation

| Doc                                                                                                   | Use it to…                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **[Step-by-step guide site](https://lsa-mis.github.io/a11ytestingCICD/a11ycicdguideforgithub/)**      | Follow a hosted, visual walkthrough                 |
| **[docs/CHECKLIST.md](docs/CHECKLIST.md)**                                                            | Copy-paste the setup into your project (~15 min)    |
| **[docs/CI-ACCESSIBILITY-GUIDE.md](docs/CI-ACCESSIBILITY-GUIDE.md)**                                  | Understand every piece + adapt to any framework     |
| **[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)**                                                    | See how the gate is configured in this repo         |
| **[docs/A11Y-OVERRIDES.md](docs/A11Y-OVERRIDES.md)**                                                   | Configure an audited bypass or advisory rollout     |

## Optional: publish results to Siteimprove

The audit runs fully offline by default. To also upload results to the
**Siteimprove Intelligence Platform**, add these repository secrets
(_Settings → Secrets and variables → Actions_):

| Secret          | Value                          |
| --------------- | ------------------------------ |
| `SI_USER_EMAIL` | Your Siteimprove account email |
| `SI_API_KEY`    | Your Siteimprove API key       |
| `SI_SITE_ID`    | The target site ID             |

When all three are present, the test uploads the audit and prints a link to the
online report. When they're absent, the local pass/fail gate still runs.

## Learn more

- Alfa engine — https://github.com/siteimprove/alfa
- Accessibility Code Checker docs — https://alfa.siteimprove.com/code-checker
- Worked examples — https://github.com/Siteimprove/alfa-examples
