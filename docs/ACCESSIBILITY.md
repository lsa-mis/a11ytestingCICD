# Accessibility Implementation (Alfa · WCAG 2.1 AA)

How this project enforces accessibility in CI using the
[Siteimprove Alfa](https://github.com/siteimprove/alfa) engine.

## Conformance target

Every push and pull request audits the rendered page against a scoped rule set:

| Included                          | Rules | Excluded                              |
| --------------------------------- | ----: | ------------------------------------- |
| WCAG 2.1 success criteria (A, AA) |    48 | WCAG AAA-only rules (e.g. enhanced    |
| Alfa Best Practice rules          |    13 | contrast 7:1, 44px target size)       |
| ARIA conformance rules            |     6 | WCAG 2.2-only criteria                |
| **Total**                         | **67** |                                      |

The build **fails on any rule that reports a failure**.

## How it works

```
Vite dev server → Playwright (headless Chromium) → Alfa audit → pass/fail gate
```

1. Playwright renders the page in a real browser (post-CSS, post-JS).
2. `Playwright.toPage()` hands the live DOM to Alfa.
3. `Audit.run()` evaluates the scoped rules against that DOM.
4. The test fails if any rule has `failed > 0`.

Packages (`devDependencies`):

- `@siteimprove/alfa-test-utils` — the audit runner, rule filters, and reporter
- `@siteimprove/alfa-playwright` — bridges the Playwright DOM into Alfa
- `@playwright/test` — browser automation

## The rule-scope setup (the key part)

`Audit.run()` accepts an `include` predicate. We OR the three built-in filters so
a rule is kept if it belongs to **any** of the three sets — see
[`tests/accessibility.spec.ts`](../tests/accessibility.spec.ts):

```ts
import { Audit, Rules } from "@siteimprove/alfa-test-utils";

// A rule is included if it is WCAG 2.1 A/AA, a Best Practice, or an ARIA rule.
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||   // WCAG 2.1 levels A + AA
  Rules.bestPracticesFilter(rule) || // Alfa best-practice rules
  Rules.ARIAFilter(rule);         // ARIA roles, states, accessible names

const alfaResult = await Audit.run(alfaPage, {
  rules: { include: conformanceTarget },
});
```

To change the target, swap the filters:

| Goal                    | Predicate                                    |
| ----------------------- | -------------------------------------------- |
| WCAG 2.1 AA only        | `Rules.wcag21aaFilter`                        |
| Latest AA (WCAG 2.2)    | `Rules.aaFilter`                              |
| Everything (incl. AAA)  | omit the `rules` option entirely             |
| Add / drop a set        | add or remove a filter from the `\|\|` chain |

## ARIA labels

The `ARIAFilter` rules enforce that ARIA is used correctly, including that
interactive elements expose an **accessible name**. Practical rules of thumb:

- **Prefer native semantics.** A `<button>Search</button>` or a `<label>` needs
  no ARIA — the visible text is already the accessible name.
- **Use `aria-label` when there is no visible text** (e.g. an icon-only button):

  ```html
  <button aria-label="Close dialog">✕</button>
  ```

- **Use `aria-labelledby` to reuse visible text** as the name:

  ```html
  <section aria-labelledby="pricing-heading">
    <h2 id="pricing-heading">Pricing</h2>
  </section>
  ```

- **Label in Name (WCAG 2.5.3):** if an element has visible text, its accessible
  name must contain that text. Don't let an `aria-label` contradict the label a
  sighted user reads.
- **Don't hide meaning from assistive tech:** only mark truly decorative content
  `aria-hidden="true"` (this project does so on the decorative hero SVG).

This project uses these patterns throughout `index.html`: labelled landmarks
(`nav aria-label="Primary"`), a `<label for="email">` bound to its input, and a
`role="status" aria-live="polite"` region for form feedback.

## Pass / fail semantics

Alfa reports four outcomes per rule:

| Outcome        | Meaning                        | Effect on build       |
| -------------- | ------------------------------ | --------------------- |
| **Passed**     | Rule satisfied                 | —                     |
| **Failed**     | Definite violation             | **Fails the build**   |
| **Can't Tell** | Needs a human to judge         | Logged, does not fail |
| **Inapplicable** | Rule doesn't apply to page   | —                     |

Only **Failed** blocks the merge. "Can't Tell" outcomes are printed to the job
log for manual review — automated testing covers roughly the machine-detectable
slice of WCAG, not all of it.

## CI wiring

[`.github/workflows/accessibility.yml`](../.github/workflows/accessibility.yml)
runs two jobs on push/PR to `main`:

1. **Type-check & build** — `npm run typecheck` + `npm run build`.
2. **Accessibility audit (Alfa)** — installs Chromium, runs the scoped audit,
   uploads the Playwright HTML report and the generated accessibility report
   bundle (XLSX, Markdown, JSON, and CSV) as artifacts. The bundle is generated
   only in CI; local runs print the actionable Alfa details in the terminal.

Mark **Accessibility audit (Alfa)** as a required status check (Settings →
Branches) to block merges on violations.

For the maintainer-only bypass list and the temporary non-blocking rollout mode,
see [Accessibility gate overrides](A11Y-OVERRIDES.md). The normal default remains
enforcing.

## Local commands

```bash
npm install                       # install dependencies
npx playwright install chromium   # one-time browser download
npm run dev                        # preview at http://localhost:5173
npm run test:a11y                  # run the same audit CI runs
```

## Extend

Guard another route by adding a `test(...)` block that navigates to it and
reuses `conformanceTarget`:

```ts
test("pricing page is accessible", async ({ page }) => {
  await page.goto("/pricing");
  const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
  const result = await Audit.run(alfaPage, { rules: { include: conformanceTarget } });
  expect(result.resultAggregates.filter((a) => a.failed > 0).size).toBe(0);
});
```
