# Alfa A11y CI/CD

A small front-end project that demonstrates how to wire **[Siteimprove Alfa](https://github.com/siteimprove/alfa)** — an open, standards-based accessibility conformance testing engine — into a **GitHub Actions CI/CD pipeline**.

Every push and pull request renders the site in a real browser, audits the DOM against WCAG (via Alfa's ACT rules), and **fails the build if there are accessibility violations**.

> **Want to do this in your own project?** Start with the **[copy-paste Setup Checklist](docs/CHECKLIST.md)** (~15 min), or read the full **[CI Accessibility Guide](docs/CI-ACCESSIBILITY-GUIDE.md)** — a framework-agnostic walkthrough covering React, Next.js, Vue, Angular, Svelte, Astro, plain static sites, and auditing a deployed preview URL.

## Stack

| Concern            | Tool                                                        |
| ------------------ | ----------------------------------------------------------- |
| Front-end          | [Vite](https://vitejs.dev/) + TypeScript (vanilla)          |
| Browser automation | [Playwright](https://playwright.dev/)                       |
| Accessibility      | `@siteimprove/alfa-test-utils` + `@siteimprove/alfa-playwright` |
| CI/CD              | GitHub Actions (`.github/workflows/accessibility.yml`)      |

## Project layout

```
.
├── index.html                     # Accessible landing page (Vite entry)
├── src/
│   ├── main.ts                    # Progressive-enhancement JS (form, footer year)
│   └── style.css                  # High-contrast, keyboard-friendly styles
├── tests/
│   └── accessibility.spec.ts      # The Alfa accessibility gate
├── playwright.config.ts           # Boots the dev server + runs the audit
├── vite.config.ts
└── .github/workflows/accessibility.yml   # The CI/CD pipeline
```

## Getting started

```bash
npm install                       # install dependencies
npx playwright install chromium   # download the browser Alfa audits in
npm run dev                        # http://localhost:5173
```

## Running the accessibility audit locally

```bash
npm test
```

Playwright starts the dev server automatically, Alfa audits the rendered page,
and a readable report is printed to the console. The command exits non-zero if
any rule fails — the same gate that runs in CI.

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # type-check + production build
```

## How the CI/CD pipeline works

`.github/workflows/accessibility.yml` runs two jobs on every push/PR to `main`:

1. **Type-check & build** — `npm ci`, `npm run typecheck`, `npm run build`.
2. **Accessibility audit (Alfa)** — installs Chromium, runs the Alfa audit, and
   uploads the Playwright HTML report as a build artifact. A WCAG violation
   fails this job and therefore blocks the merge.

To enforce the gate on merges, mark the **Accessibility audit (Alfa)** check as
required in your branch protection rules.

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

See **[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)** for the full setup: the
conformance target, ARIA-label guidance, pass/fail semantics, and how to change
the target. To guard more pages, add another `test(...)` block that navigates to
the route and reuses `conformanceTarget`.

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

- **[Setup Checklist](docs/CHECKLIST.md)** — copy-paste steps to add the gate to your own project (~15 min)
- **[Add this to your own project](docs/CI-ACCESSIBILITY-GUIDE.md)** — the framework-agnostic setup guide
- **[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)** — how the gate works in this repo
- Alfa engine — https://github.com/siteimprove/alfa
- Accessibility Code Checker docs — https://alfa.siteimprove.com/code-checker
- Worked examples — https://github.com/Siteimprove/alfa-examples
