# Alfa Accessibility CI — Copy-Paste Setup Checklist

Add an automated **WCAG accessibility gate** to any web project's GitHub Actions
CI using [Siteimprove Alfa](https://github.com/siteimprove/alfa) +
[Playwright](https://playwright.dev/). Every push and pull request renders your
site in a real browser, audits the DOM against WCAG, and **fails the build on
violations**.

⏱️ **~15 minutes.** Work top to bottom — every code block is copy-paste.
The **only** thing you customize is how your app is served at a URL (**Step 2**).

> Want the _why_ behind each piece (multi-page/SPA/auth patterns, deployed-URL
> auditing, Siteimprove publishing)? See
> **[CI-ACCESSIBILITY-GUIDE.md](./CI-ACCESSIBILITY-GUIDE.md)**.

---

## ☐ 0 · Prerequisites

- [ ] **Node 20+** installed — check with `node -v`
- [ ] Your app runs locally at a URL — note the **start command** and **port**
      (e.g. `npm run dev` on port `5173`)
- [ ] Code is in a **GitHub repository** with **Actions enabled** (the default)

## ☐ 1 · Install dependencies

```bash
npm install -D @playwright/test @siteimprove/alfa-playwright @siteimprove/alfa-test-utils
npx playwright install chromium
```

<sub>Using pnpm/yarn/bun? Swap `npm install -D` for your equivalent.</sub>

## ☐ 2 · Add `playwright.config.ts` (project root)

Paste this, then change the **two ⬅ lines** to match your app. Leave the rest.

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;                          // ⬅ your app's port
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",                 // ⬅ how to start YOUR app
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**Pick your `command` / `PORT`:**

| Stack          | `command`                          | `PORT` |
| -------------- | ---------------------------------- | ------ |
| Vite           | `npm run dev`                      | 5173   |
| Next.js        | `npm run build && npm run start`   | 3000   |
| Create React App | `npm start`                      | 3000   |
| Angular        | `npm start`                        | 4200   |
| SvelteKit      | `npm run build && npm run preview` | 4173   |
| Astro          | `npm run build && npm run preview` | 4321   |
| Static files   | `npx serve . -l 5173`              | 5173   |

## ☐ 3 · Add the test `tests/accessibility.spec.ts`

```ts
import { test, expect } from "@playwright/test";
import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules } from "@siteimprove/alfa-test-utils";

// Enforce WCAG 2.1 A/AA + Alfa Best Practices + ARIA. (See Step 8 to change scope.)
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||
  Rules.bestPracticesFilter(rule) ||
  Rules.ARIAFilter(rule);

test("home page has no accessibility violations", async ({ page }) => {
  await page.goto("/");

  const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
  const result = await Audit.run(alfaPage, { rules: { include: conformanceTarget } });

  Logging.fromAudit(result).print(); // readable report in the console / job log

  const failing = result.resultAggregates.filter((a) => a.failed > 0);
  expect(
    failing.size,
    `${failing.size} accessibility rule(s) failed — see the report above.`,
  ).toBe(0);
});
```

<sub>Guard more pages: copy the <code>test(...)</code> block and change the <code>page.goto()</code> path.</sub>

## ☐ 4 · Add the npm script to `package.json`

```json
{
  "scripts": {
    "test:a11y": "playwright test"
  }
}
```

## ☐ 5 · Run it locally

```bash
npm run test:a11y
```

- [ ] It passes ✔ — or it lists **real violations**: fix them, or narrow the
      scope in **Step 8**
- [ ] Inspect the full report: `npx playwright show-report`

## ☐ 6 · Add the workflow `.github/workflows/accessibility.yml`

```yaml
name: Accessibility

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: a11y-${{ github.ref }}
  cancel-in-progress: true

jobs:
  accessibility:
    name: Accessibility audit (Alfa)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install Playwright browser (Chromium)
        run: npx playwright install --with-deps chromium

      - name: Run Alfa accessibility audit
        run: npm run test:a11y

      - name: Upload Playwright report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

<sub>Note: the CI step uses <code>--with-deps</code> (installs Linux libs); your local Step 1 does not.</sub>

## ☐ 7 · Commit, push, and open a PR

```bash
git checkout -b ci/alfa-a11y
git add playwright.config.ts tests/accessibility.spec.ts package.json package-lock.json .github/workflows/accessibility.yml
git commit -m "ci: add Alfa accessibility gate"
git push -u origin ci/alfa-a11y
```

- [ ] Open a **pull request into `main`** — the **Accessibility audit (Alfa)**
      check runs on it automatically

## ☐ 8 · Make the check **required** (so it blocks merges)

Do this in the GitHub UI **after the check has run at least once** (it only
appears in the list once it exists):

- [ ] Repo → **Settings → Rules → Rulesets → New branch ruleset**
      (or **Settings → Branches → Add rule**)
- [ ] Target branch: **`main`**
- [ ] Enable **Require status checks to pass**
- [ ] Search for and select **Accessibility audit (Alfa)**
- [ ] Enable **Require a pull request before merging** _(recommended)_
- [ ] **Save**

✅ Any PR with a WCAG violation is now blocked from merging.

## ☐ 9 · (Recommended) Prove the gate actually blocks

- [ ] On a scratch branch, add a broken element — e.g. an image with no alt text:
      `<img src="logo.png">`
- [ ] Push and open a PR → confirm the check turns **red** and merge is blocked
- [ ] Delete the scratch branch

---

## Change the strictness (edits Step 3)

| Goal                       | Replace the `conformanceTarget` body with     |
| -------------------------- | --------------------------------------------- |
| WCAG 2.1 AA only           | `Rules.wcag21aaFilter(rule)`                  |
| Latest AA (WCAG 2.2)       | `Rules.aaFilter(rule)`                        |
| Everything, including AAA  | omit the `rules` option in `Audit.run()`      |

> **Tip:** if you're retrofitting an existing site, start at **WCAG 2.1 AA only**,
> get the gate green, mark it required, _then_ ratchet the scope up. A gate that's
> red on day one gets disabled by day three.

---

**Full reference:** [CI-ACCESSIBILITY-GUIDE.md](./CI-ACCESSIBILITY-GUIDE.md) ·
**How this repo does it:** [ACCESSIBILITY.md](./ACCESSIBILITY.md)
