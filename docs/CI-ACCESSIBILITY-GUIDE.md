# Add Accessibility Testing to Your GitHub Actions Pipeline

A practical, framework-agnostic guide to doing what this repo does — **automatically
auditing your site against WCAG on every push and pull request, and failing the
build when there are accessibility violations** — in _your own_ project.

It uses [Siteimprove Alfa](https://github.com/siteimprove/alfa) (an open-source,
standards-based accessibility engine), [Playwright](https://playwright.dev/) (to
render your page in a real browser), and [GitHub Actions](https://docs.github.com/actions)
(to run the gate in CI).

> This repo is the working reference implementation (a Vite + TypeScript site).
> This guide generalizes it so you can drop the same gate into React, Next.js,
> Vue, Angular, Svelte, Astro, a plain static site, or an already-deployed URL.

---

## Contents

1. [The mental model (read this first)](#1-the-mental-model-read-this-first)
2. [What you're building](#2-what-youre-building)
3. [Prerequisites](#3-prerequisites)
4. [The moving parts](#4-the-moving-parts)
5. [Step-by-step setup](#5-step-by-step-setup)
6. [Adapting the server to your framework](#6-adapting-the-server-to-your-framework)
7. [Choosing your conformance target](#7-choosing-your-conformance-target)
8. [Auditing multiple pages and routes](#8-auditing-multiple-pages-and-routes)
9. [Understanding pass / fail](#9-understanding-pass--fail)
10. [The workflow file, explained](#10-the-workflow-file-explained)
11. [Enforcing the gate on merges](#11-enforcing-the-gate-on-merges)
12. [Optional: publish results to Siteimprove](#12-optional-publish-results-to-siteimprove)
13. [Troubleshooting](#13-troubleshooting)
14. [FAQ](#14-faq)
15. [Reference](#15-reference)

---

## 1. The mental model (read this first)

Everything in this setup follows from one idea:

> **Alfa audits whatever DOM Playwright hands it.** Playwright loads a URL in a
> real browser, waits for CSS and JavaScript to run, and gives Alfa the _final_
> rendered DOM. Alfa checks that DOM against a set of WCAG rules and reports
> pass / fail per rule.

So there are really only **three** things you configure:

| You decide…                        | …by setting                                             |
| ---------------------------------- | ------------------------------------------------------- |
| **Which app** gets audited         | how Playwright serves/reaches your app (a URL)          |
| **Which rules** you enforce        | the `include` filter passed to `Audit.run()`            |
| **When the build fails**           | the assertion on the audit result                       |

If you internalize that, the rest is boilerplate. Your **only real integration
work** is #1: _"how do I get my app running at a URL inside CI?"_ — and that's the
one part that differs per framework ([Section 6](#6-adapting-the-server-to-your-framework)).

### Why render in a real browser?

Because accessibility depends on the _computed_ result, not the source. Contrast
comes from resolved CSS. Accessible names come from the computed accessibility
tree. ARIA state changes at runtime. A static HTML linter can't see any of that;
a real browser can. This is why the pipeline uses Playwright + a real Chromium
rather than parsing files.

### What this catches — and what it doesn't

Automated ACT-rule testing reliably catches the **machine-detectable** slice of
WCAG: missing alt text, unlabeled controls, insufficient contrast, broken ARIA,
missing form labels, invalid roles, duplicate IDs, and so on. That's a large,
high-value slice — and it's the slice humans are worst at catching consistently.

It does **not** replace human judgment: logical reading order, meaningful alt
_text_ (vs. merely present), keyboard operability of custom widgets, focus
management, and "does this actually make sense to a screen-reader user" still
need manual review. Treat this gate as a **floor that never regresses**, not a
certificate of full conformance.

---

## 2. What you're building

```
                          GitHub Actions (on push / PR)
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                     │
   │   Job 1: Build            Job 2: Accessibility audit                │
   │   ┌──────────────┐        ┌────────────────────────────────────┐   │
   │   │ npm ci       │        │ npm ci                             │   │
   │   │ typecheck    │        │ playwright install chromium        │   │
   │   │ build        │        │ ┌────────────────────────────────┐ │   │
   │   └──────────────┘        │ │ start dev/preview server       │ │   │
   │                           │ │        │                       │ │   │
   │                           │ │        ▼                       │ │   │
   │                           │ │ Playwright → real Chromium     │ │   │
   │                           │ │        │  loads your URL       │ │   │
   │                           │ │        ▼                       │ │   │
   │                           │ │ live DOM ──► Alfa audit        │ │   │
   │                           │ │        │  (WCAG rule set)      │ │   │
   │                           │ │        ▼                       │ │   │
   │                           │ │ any rule failed? ─► exit 1 ✗   │ │   │
   │                           │ │ else            ─► exit 0 ✓    │ │   │
   │                           │ └────────────────────────────────┘ │   │
   │                           │ upload HTML report as artifact      │   │
   │                           └────────────────────────────────────┘   │
   │                                                                     │
   │   A failed audit → red check → (with branch protection) blocked    │
   │   merge.                                                            │
   └───────────────────────────────────────────────────────────────────┘
```

A failed audit turns the check red; combined with branch protection
([Section 11](#11-enforcing-the-gate-on-merges)) it **blocks the merge**.

---

## 3. Prerequisites

- A web project that can be **served at a local URL** (a dev server, a static
  build, or a preview server). If it renders in a browser, it can be audited.
- **Node.js 20 or newer.** This reference repo pins **Node 24** in CI.
- A **GitHub repository** with Actions enabled (on by default).
- A package manager. Examples below use `npm`; `pnpm`/`yarn`/`bun` work the same
  way — swap the install/run commands.

You do **not** need a Siteimprove account. The gate runs fully offline; the
Siteimprove platform upload is optional ([Section 12](#12-optional-publish-results-to-siteimprove)).

---

## 4. The moving parts

Five files do all the work. Here's each one's job and where to find the reference
version in this repo:

| File                                   | Role                                                      | Reference                                                              |
| -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `package.json`                         | Dev dependencies + `test` script                          | [`package.json`](../package.json)                                      |
| `playwright.config.ts`                 | Boots your server, points the browser at its URL          | [`playwright.config.ts`](../playwright.config.ts)                      |
| `tests/accessibility.spec.ts`          | The audit itself: render → hand DOM to Alfa → assert       | [`tests/accessibility.spec.ts`](../tests/accessibility.spec.ts)        |
| `.github/workflows/accessibility.yml`  | Runs the audit in CI on every push / PR                   | [`.github/workflows/accessibility.yml`](../.github/workflows/accessibility.yml) |
| _(optional)_ branch protection rule    | Makes the check **required** so it blocks merges          | GitHub repo settings                                                   |

---

## 5. Step-by-step setup

### 5.1 Install dependencies

```bash
npm install -D \
  @playwright/test \
  @siteimprove/alfa-playwright \
  @siteimprove/alfa-test-utils

# One-time browser download (Chromium is enough)
npx playwright install chromium
```

What each package does:

- **`@playwright/test`** — drives a real browser and provides the test runner.
- **`@siteimprove/alfa-playwright`** — a thin bridge that converts Playwright's
  live DOM handle into a page object Alfa understands.
- **`@siteimprove/alfa-test-utils`** — the audit runner (`Audit`), the built-in
  rule filters (`Rules`), the console reporter (`Logging`), and the optional
  Siteimprove upload (`SIP`).

### 5.2 Configure Playwright to serve your app

`playwright.config.ts` — the important block is `webServer`, which starts your
app before the tests and shuts it down after. **This is the one file you tailor
to your stack** ([Section 6](#6-adapting-the-server-to-your-framework)).

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;                         // ← your dev/preview port
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,            // no stray test.only in CI
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,                     // lets tests call page.goto("/")
    trace: "on-first-retry",               // trace a failing run for debugging
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",                // ← how to start YOUR app
    url: BASE_URL,                         // Playwright waits until this responds
    reuseExistingServer: !process.env.CI,  // reuse a running dev server locally
    timeout: 120_000,
  },
});
```

Why these choices matter:

- **`webServer`** means `npm test` works with a single command locally _and_ in
  CI — no separate "start the server" step, no race conditions. Playwright waits
  for `url` to respond before running anything.
- **`reuseExistingServer: !process.env.CI`** — locally, if you already have
  `npm run dev` running, Playwright reuses it (fast). In CI it always starts a
  fresh one (reproducible).
- **`baseURL`** lets your tests use relative paths like `page.goto("/")` and
  `page.goto("/pricing")`.

### 5.3 Write the accessibility test

`tests/accessibility.spec.ts` — this is the heart of the gate. It's the same for
every framework; only the URLs you visit change.

```ts
import { test, expect } from "@playwright/test";

import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules, SIP } from "@siteimprove/alfa-test-utils";
import { getCommitInformation } from "@siteimprove/alfa-test-utils/git";

/**
 * The conformance target: a rule is enforced if it is WCAG 2.1 A/AA, OR an
 * Alfa Best Practice, OR an ARIA conformance rule. Tune this in Section 7.
 */
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||
  Rules.bestPracticesFilter(rule) ||
  Rules.ARIAFilter(rule);

test("home page has no accessibility violations", async ({ page }) => {
  // 1. Render the page exactly as a user would receive it.
  await page.goto("/");

  // 2. Hand the live, fully-rendered DOM to Alfa.
  const documentHandle = await page.evaluateHandle("document");
  const alfaPage = await Playwright.toPage(documentHandle);

  // 3. Run the audit against your chosen rule set.
  const alfaResult = await Audit.run(alfaPage, {
    rules: { include: conformanceTarget },
  });

  // 4. (Optional) publish to the Siteimprove platform when credentials exist.
  const { SI_USER_EMAIL, SI_API_KEY, SI_SITE_ID } = process.env;
  const reportUrl =
    SI_USER_EMAIL && SI_API_KEY && SI_SITE_ID
      ? await SIP.upload(alfaResult, {
          userName: SI_USER_EMAIL,
          apiKey: SI_API_KEY,
          siteID: Number(SI_SITE_ID),
          commitInformation: await getCommitInformation(),
        })
      : undefined;

  // 5. Print a readable report to the job log.
  Logging.fromAudit(alfaResult, reportUrl).print();

  // 6. Fail the build if any rule reported a failure.
  const failingRules = alfaResult.resultAggregates.filter(
    (aggregate) => aggregate.failed > 0,
  );
  expect(
    failingRules.size,
    `The page has ${failingRules.size} failing accessibility rule(s). ` +
      `See the printed report above for details.`,
  ).toBe(0);
});
```

The six numbered steps are the entire pattern. To guard more pages, copy the
test and change the URL ([Section 8](#8-auditing-multiple-pages-and-routes)).

### 5.4 Add the npm script

In `package.json`:

```json
{
  "scripts": {
    "test:a11y": "playwright test"
  }
}
```

Now `npm run test:a11y` runs the exact same gate locally that CI runs.

### 5.5 Add the GitHub Actions workflow

Create `.github/workflows/accessibility.yml`. Full file explained in
[Section 10](#10-the-workflow-file-explained); here it is ready to copy:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  accessibility:
    name: Accessibility audit (Alfa)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # full history for commit metadata on upload

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Install Playwright browser (Chromium)
        run: npx playwright install --with-deps chromium

      - name: Run Alfa accessibility audit
        run: npm run test:a11y
        env:
          SI_USER_EMAIL: ${{ secrets.SI_USER_EMAIL }}   # optional
          SI_API_KEY: ${{ secrets.SI_API_KEY }}         # optional
          SI_SITE_ID: ${{ secrets.SI_SITE_ID }}         # optional

      - name: Upload Playwright report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

> The reference repo also has a separate **build** job (typecheck + build). Keep
> it if you want type-safety gated too; it's independent of the accessibility
> job. See [`accessibility.yml`](../.github/workflows/accessibility.yml).

### 5.6 Run it locally before you push

```bash
npm run test:a11y
```

Playwright boots your server, Alfa audits the page, and a readable report prints
to the console. The command **exits non-zero if any rule fails** — identical to
CI. Open the HTML report for a rich view:

```bash
npx playwright show-report
```

### 5.7 Commit, push, and make it required

Push the branch, open a PR, and confirm the **Accessibility audit (Alfa)** check
runs. Then make it a required status check ([Section 11](#11-enforcing-the-gate-on-merges))
so violations actually block merges.

---

## 6. Adapting the server to your framework

This is the **only** part that differs per stack. Change two things in
`playwright.config.ts`: the `webServer.command` and the `PORT`.

| Stack                     | `webServer.command`                     | Default port | Notes                                                     |
| ------------------------- | --------------------------------------- | ------------ | --------------------------------------------------------- |
| **Vite** (this repo)      | `npm run dev`                           | 5173         | Or audit the build: `vite preview` on `4173`.             |
| **Create React App**      | `npm start`                             | 3000         | Set `BROWSER=none` to stop it opening a tab.              |
| **Next.js**               | `npm run build && npm run start`        | 3000         | Prefer prod (`start`) over `dev` for real output.         |
| **Nuxt**                  | `npm run build && npm run preview`      | 3000         | `dev` also works but is slower/less faithful.             |
| **Vue CLI**               | `npm run serve`                         | 8080         |                                                           |
| **Angular**               | `npm start` (`ng serve`)                | 4200         |                                                           |
| **SvelteKit**             | `npm run build && npm run preview`      | 4173         | `npm run dev` uses 5173.                                  |
| **Astro**                 | `npm run build && npm run preview`      | 4321         |                                                           |
| **Plain static HTML**     | `npx serve . -l 5173`                   | 5173         | Any static server works (`http-server`, `python -m http.server`). |
| **Already deployed URL**  | _(omit `webServer` entirely)_           | —            | Set `baseURL` to the staging/preview URL. See below.      |

### Dev server vs. production build

The reference repo audits the **dev server** — simplest, and fine for most
sites. But dev servers can inject helper markup (HMR overlays, error boxes) and
skip minification. For the **highest fidelity**, audit what you actually ship:

```ts
webServer: {
  command: "npm run build && npm run preview",  // or your static-serve command
  url: "http://localhost:4173",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
},
```

Rule of thumb: **dev server** for speed and simplicity; **build + preview** when
you want to be sure you're testing production output.

### Auditing an already-deployed URL (no server to boot)

If your PRs get a deploy preview (Netlify, Vercel, GitHub Pages, a staging box),
you can skip `webServer` and point Playwright straight at it:

```ts
// playwright.config.ts
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: process.env.AUDIT_BASE_URL ?? "http://localhost:5173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // no webServer — we're auditing a live URL
});
```

```yaml
# in the workflow
- run: npm run test:a11y
  env:
    AUDIT_BASE_URL: ${{ steps.deploy.outputs.preview-url }}
```

This is powerful: you audit the _real_ deployed artifact, including CDN, real
asset paths, and server-rendered content. The trade-off is you need the deploy
to finish first (sequence the jobs with `needs:`).

---

## 7. Choosing your conformance target

`Audit.run()` takes an `include` predicate — a function that returns `true` for
each rule you want to enforce. Alfa ships composable filters on `Rules`, and you
combine them with `||`:

```ts
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||    // WCAG 2.1 levels A + AA
  Rules.bestPracticesFilter(rule) || // Alfa's best-practice rules
  Rules.ARIAFilter(rule);          // ARIA roles, states, accessible names
```

This repo's target resolves to **67 rules** (WCAG 2.1 A/AA + Best Practices +
ARIA). AAA-only rules (e.g. 7:1 enhanced contrast, 44px target size) are
deliberately excluded — they're stricter than most teams commit to.

Pick the target that matches the bar you're willing to enforce:

| Goal                            | Predicate                                          |
| ------------------------------- | -------------------------------------------------- |
| WCAG 2.1 AA only                | `Rules.wcag21aaFilter`                             |
| Latest AA (WCAG 2.2)            | `Rules.aaFilter`                                   |
| AA + best practices + ARIA      | the `\|\|` chain above _(this repo's default)_     |
| Everything, including AAA       | omit the `rules` option from `Audit.run()` entirely |
| Add or drop one set             | add/remove a filter in the `\|\|` chain            |

**Recommendation:** start with **WCAG 2.1 AA only** (`Rules.wcag21aaFilter`) if
you're retrofitting an existing site — it's the legal baseline most policies
reference (e.g. Section 508, EN 301 549), and it minimizes noise so the gate
turns green sooner. Add `bestPracticesFilter` and `ARIAFilter` once you're clean,
to ratchet the bar up. Moving to `aaFilter` (WCAG 2.2) is the natural next step.

> **Tip:** raise the bar _after_ you're passing, never before. A gate that's red
> on day one gets disabled by day three. Get to green, make it required, then
> tighten.

---

## 8. Auditing multiple pages and routes

The audit is scoped to whatever URL is loaded, so **one `test()` per page/route**.
Reuse the same `conformanceTarget`.

### One test per route

```ts
test("pricing page is accessible", async ({ page }) => {
  await page.goto("/pricing");
  const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
  const result = await Audit.run(alfaPage, { rules: { include: conformanceTarget } });
  expect(result.resultAggregates.filter((a) => a.failed > 0).size).toBe(0);
});
```

### Loop over a list of routes

Factor the six steps into a helper and drive it with a list — DRY, and each route
reports as its own test:

```ts
const ROUTES = ["/", "/pricing", "/about", "/faq"];

async function auditRoute(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
  const result = await Audit.run(alfaPage, { rules: { include: conformanceTarget } });
  Logging.fromAudit(result).print();
  const failing = result.resultAggregates.filter((a) => a.failed > 0);
  expect(failing.size, `${path} has ${failing.size} failing rule(s)`).toBe(0);
}

for (const path of ROUTES) {
  test(`accessible: ${path}`, async ({ page }) => auditRoute(page, path));
}
```

### Notes for real apps

- **SPAs / client-side routing:** `page.goto("/route")` triggers a full load,
  which is what you want. If a view only appears after interaction (a modal, an
  expanded menu, a wizard step), drive Playwright to open it **before** grabbing
  the document, then audit that state — Alfa sees the DOM as it is at that
  moment.
- **Authenticated pages:** use Playwright's
  [storage state / auth](https://playwright.dev/docs/auth) to sign in once, then
  audit the logged-in routes.
- **Dynamic content:** `await page.waitForLoadState("networkidle")` or wait on a
  specific selector before auditing, so you audit the settled DOM, not a spinner.

---

## 9. Understanding pass / fail

Alfa reports one of four outcomes per rule:

| Outcome          | Meaning                          | Effect on build       |
| ---------------- | -------------------------------- | --------------------- |
| **Passed**       | Rule satisfied                   | —                     |
| **Failed**       | Definite violation               | **Fails the build**   |
| **Can't Tell**   | Needs a human to judge           | Logged, does not fail |
| **Inapplicable** | Rule doesn't apply to this page  | —                     |

Only **Failed** blocks the merge — that's the meaning of:

```ts
const failingRules = alfaResult.resultAggregates.filter((a) => a.failed > 0);
expect(failingRules.size).toBe(0);
```

**"Can't Tell" is intentionally not a failure.** Some criteria (e.g. "is this
alt text _meaningful_?") can't be decided by a machine. Alfa surfaces them in the
log for human review rather than blocking automatically — which keeps the gate
trustworthy (no false positives forcing people to disable it). If your policy
requires a stricter stance, you can additionally assert on `cantTell`, but expect
manual-review noise.

---

## 10. The workflow file, explained

Line by line, so you can adapt it confidently.

```yaml
name: CI

on:
  push:
    branches: [main]        # audit trunk after every merge
  pull_request:
    branches: [main]        # audit every PR targeting main — the gate that matters
  workflow_dispatch:        # lets you run it manually from the Actions tab
```

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true  # a new push cancels the in-flight run on the same ref
```

Saves CI minutes: push twice quickly and only the latest run survives.

```yaml
jobs:
  accessibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0    # full git history
```

`fetch-depth: 0` matters **only** for the optional Siteimprove upload, which
attaches commit metadata via `getCommitInformation()`. If you're not using the
upload, `fetch-depth: 1` (the default) is fine and faster.

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm          # cache ~/.npm between runs for faster installs
      - run: npm ci           # clean, lockfile-exact install
```

Use `npm ci` (not `npm install`) in CI — it's reproducible and fails if the
lockfile is out of sync.

```yaml
      - name: Install Playwright browser (Chromium)
        run: npx playwright install --with-deps chromium
```

Downloads Chromium **and** its Linux system libraries (`--with-deps`). Only
Chromium is needed, so don't install all three browsers — it's slower for no
benefit here.

```yaml
      - name: Run Alfa accessibility audit
        run: npm run test:a11y
        env:
          SI_USER_EMAIL: ${{ secrets.SI_USER_EMAIL }}
          SI_API_KEY: ${{ secrets.SI_API_KEY }}
          SI_SITE_ID: ${{ secrets.SI_SITE_ID }}
```

The audit. The three `SI_*` env vars are **optional** — absent, the test skips
the upload and just runs the local gate. Missing secrets are simply empty
strings, so nothing breaks.

```yaml
      - name: Upload Playwright report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

`if: ${{ !cancelled() }}` uploads the HTML report **even when the audit
failed** — which is exactly when you want it. Download it from the run's
_Artifacts_ section to see every violation with the offending element.

---

## 11. Enforcing the gate on merges

A green/red check alone doesn't stop anyone. To actually **block merges** on
violations, make the check required:

1. GitHub repo → **Settings → Branches → Branch protection rules** (or
   **Rulesets**).
2. Add/edit a rule for `main`.
3. Enable **Require status checks to pass before merging**.
4. Search for and select **Accessibility audit (Alfa)** — the job's `name`.
5. Save.

> The check only appears in that list **after it has run at least once**, so push
> a branch and let the workflow run first, then configure protection.

Recommended companions: **Require branches to be up to date before merging** (so
the audit runs against the post-merge state) and **Require a pull request before
merging**.

---

## 12. Optional: publish results to Siteimprove

The gate is fully self-contained and needs no account. If your org uses the
**Siteimprove Intelligence Platform (SIP)** and you want trend dashboards and a
shareable online report, add three repository secrets:

_Settings → Secrets and variables → Actions → New repository secret_

| Secret          | Value                          |
| --------------- | ------------------------------ |
| `SI_USER_EMAIL` | Your Siteimprove account email |
| `SI_API_KEY`    | Your Siteimprove API key       |
| `SI_SITE_ID`    | The target site ID             |

When **all three** are present, `SIP.upload()` sends the audit (with commit
metadata) to your dashboard and prints a link in the job log. When **any** is
missing, that branch is skipped and only the local pass/fail gate runs — so
forks and external PRs (which don't get secrets) still work.

Never hardcode these values — always use Actions secrets.

---

## 13. Troubleshooting

| Symptom                                                     | Likely cause / fix                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Timed out waiting for http://localhost:PORT`               | `webServer.command`/`port` don't match your app. Confirm the command serves on that exact port; raise `timeout` for slow builds. |
| Passes locally, fails in CI (or vice-versa)                 | You're auditing the dev server in one place and the build in the other. Standardize on one ([Section 6](#6-adapting-the-server-to-your-framework)). |
| `browserType.launch: Executable doesn't exist`              | Missing browser. Run `npx playwright install --with-deps chromium` (the `--with-deps` matters on Linux/CI).                    |
| Audit finds nothing / audits a spinner                      | DOM not settled. Add `await page.waitForLoadState("networkidle")` or wait on a selector before `evaluateHandle("document")`.   |
| Too many failures to fix at once                            | Narrow the target to `Rules.wcag21aaFilter`, get to green, make it required, then ratchet up ([Section 7](#7-choosing-your-conformance-target)). |
| One specific rule is wrong for your case                    | Exclude it: `Audit.run(page, { rules: { include: target, exclude: (r) => r === Rules.SomeRule } })`, or refine the include filter. |
| Report artifact missing after a failure                     | Ensure the upload step has `if: ${{ !cancelled() }}` (not the default, which skips on failure).                               |
| `test.only` slips into CI                                   | `forbidOnly: !!process.env.CI` in the config fails the run if a `.only` is committed — keep it.                                |
| Flaky pass/fail                                             | Wait for real readiness instead of a fixed delay; `retries: 1` in CI absorbs genuine flakiness; inspect the `trace` from the failing run. |

---

## 14. FAQ

**Is this a replacement for manual accessibility testing?**
No. It's the automated floor — it catches machine-detectable WCAG issues on every
commit so they never regress. Keyboard testing, screen-reader passes, and content
review still need humans. See [Section 1](#1-the-mental-model-read-this-first).

**How is Alfa different from axe-core or Lighthouse?**
All three are ACT-rules-based automated engines and any of them can gate CI with
this same Playwright pattern. Alfa is fully open-source, maps rules explicitly to
WCAG success criteria and ACT, and reports the four-way outcome (including
"Can't Tell"). If you already standardize on axe or pa11y, the _architecture_ in
this guide is identical — swap the audit call.

**Do I need a Siteimprove account or license?**
No. The engine and the gate are open-source and run offline. The platform upload
([Section 12](#12-optional-publish-results-to-siteimprove)) is the only part that
needs an account, and it's optional.

**Can I run this on pull requests from forks?**
Yes — the gate runs. Secrets aren't exposed to fork PRs, so the Siteimprove
upload is skipped automatically (by design), but the pass/fail gate still works.

**Which browsers does it test?**
Chromium here, which is sufficient for DOM-based WCAG rules (the accessibility
tree is standardized). Add Firefox/WebKit projects in `playwright.config.ts` if
you want, but it rarely changes accessibility outcomes and roughly triples the run.

**Does it slow down CI a lot?**
The bulk of the time is the one-time Chromium download and `npm ci`, both cached
between runs. The audit itself is fast (sub-second per page). Auditing a handful
of routes adds little.

**Can I gate on a threshold instead of zero failures?**
You can (assert `failingRules.size <= N`), but a hard **zero** with a scoped rule
set is stronger and clearer — a threshold quietly normalizes regressions. Prefer
narrowing the _rule set_ over allowing a _failure budget_.

**My framework isn't in the table.**
It doesn't need to be. If you can serve it at a URL, set `webServer.command` to
whatever starts it (or point `baseURL` at a deploy). That's the whole integration.

---

## 15. Reference

- **This repo's implementation notes** — [`docs/ACCESSIBILITY.md`](./ACCESSIBILITY.md)
- **The test itself** — [`tests/accessibility.spec.ts`](../tests/accessibility.spec.ts)
- **The workflow** — [`.github/workflows/accessibility.yml`](../.github/workflows/accessibility.yml)
- Alfa engine — <https://github.com/siteimprove/alfa>
- Alfa Code Checker docs — <https://alfa.siteimprove.com/code-checker>
- Worked Alfa examples — <https://github.com/Siteimprove/alfa-examples>
- Playwright — <https://playwright.dev/>
- Playwright `webServer` — <https://playwright.dev/docs/test-webserver>
- GitHub Actions — <https://docs.github.com/actions>
- ACT Rules Community — <https://www.w3.org/WAI/standards-guidelines/act/rules/>
- WCAG 2.1 — <https://www.w3.org/TR/WCAG21/>
```
