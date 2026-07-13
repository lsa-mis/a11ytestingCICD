import { test, expect } from "@playwright/test";

import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules, SIP } from "@siteimprove/alfa-test-utils";
import { getCommitInformation } from "@siteimprove/alfa-test-utils/git";

/**
 * Accessibility gate powered by Siteimprove Alfa (https://github.com/siteimprove/alfa).
 *
 * Playwright renders the page in a real browser, Alfa scrapes the resulting DOM
 * and audits it against the ACT rules, and the test fails the CI job if any rule
 * reports a failure.
 *
 * Add one test per page/route you want to guard.
 */

/**
 * The conformance target for this project.
 *
 * We include a rule if it maps to a WCAG 2.1 level A/AA success criterion, OR is
 * one of Alfa's Best Practice rules, OR is an ARIA conformance rule (correct
 * roles, states, and accessible names such as `aria-label`/`aria-labelledby`).
 * AAA-only rules (e.g. enhanced contrast, 44px target size) are excluded.
 */
const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||
  Rules.bestPracticesFilter(rule) ||
  Rules.ARIAFilter(rule);

test("home page has no accessibility violations", async ({ page }) => {
  // 1. Render the page exactly as a user would receive it.
  await page.goto("/");

  // 2. Hand the live DOM to Alfa.
  const documentHandle = await page.evaluateHandle("document");
  const alfaPage = await Playwright.toPage(documentHandle);

  // 3. Run the audit against WCAG 2.1 AA + Best Practices + ARIA.
  const alfaResult = await Audit.run(alfaPage, {
    rules: { include: conformanceTarget },
  });

  // 4. Optionally publish results to the Siteimprove Intelligence Platform.
  //    Only runs when credentials are provided (e.g. via GitHub Actions secrets),
  //    so the gate works fully offline by default.
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

  // 5. Print a readable report to the job log (with a link if it was uploaded).
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
