import { test, expect } from "@playwright/test";

import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules, SIP } from "@siteimprove/alfa-test-utils";
import { getCommitInformation } from "@siteimprove/alfa-test-utils/git";

import { writeAccessibilityReport } from "./support/report";

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

/**
 * Advisory mode keeps the audit and all evidence intact, but does not block the
 * test on failures. It is intended for a controlled rollout, not per-PR bypasses.
 * Any value other than the explicit string "advisory" remains enforcing.
 */
const enforcement = process.env.A11Y_ENFORCEMENT === "advisory" ? "advisory" : "enforce";

for (const route of ["/", "/violations.html"]) {
test(`${route} has no accessibility violations`, async ({ page }, testInfo) => {
  // 1. Render the page exactly as a user would receive it.
  await page.goto(route);

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

  // 6. Print a detailed terminal guide in every run. GitHub Actions additionally
  //    writes the XLSX / JSON / Markdown / CSV bundle and uploads it as an artifact.
  const report = await writeAccessibilityReport(alfaResult, {
    route,
    url: page.url(),
    title: await page.title(),
    conformance: "WCAG 2.1 AA + Best Practices + ARIA",
    reportUrl,
  });
  if (report.artifactsGenerated) {
    console.log(`Accessibility CI report written to ${report.directory}/`);
  } else {
    console.log("Accessibility local run: terminal details only; no report files created.");
  }
  console.log(`Accessibility enforcement: ${enforcement.toUpperCase()}`);

  // 7. Attach durable files only in CI. Local runs intentionally remain file-free.
  if (report.artifactsGenerated && report.directory && report.workbook) await Promise.all([
    testInfo.attach("Accessibility workbook", {
      path: report.workbook,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    testInfo.attach("Accessibility evidence (JSON)", {
      path: `${report.directory}/report.json`,
      contentType: "application/json",
    }),
    testInfo.attach("Accessibility summary (Markdown)", {
      path: `${report.directory}/summary.md`,
      contentType: "text/markdown",
    }),
    testInfo.attach("Accessibility issues (CSV)", {
      path: `${report.directory}/issues.csv`,
      contentType: "text/csv",
    }),
    testInfo.attach("Accessibility rules (CSV)", {
      path: `${report.directory}/rules.csv`,
      contentType: "text/csv",
    }),
    testInfo.attach("Accessibility override guidance", {
      path: "docs/A11Y-OVERRIDES.md",
      contentType: "text/markdown",
    }),
  ]);

  // 8. In enforcing mode, fail the build if any rule reported a failure.
  //    Advisory mode is deliberately explicit and leaves the report verdict as
  //    FAIL so it can be triaged without hiding the regression.
  const failingRules = alfaResult.resultAggregates.filter(
    (aggregate) => aggregate.failed > 0,
  );

  if (enforcement === "enforce") {
    expect(
      failingRules.size,
      `The page has ${failingRules.size} failing accessibility rule(s). ` +
        `See the printed report above for details.`,
    ).toBe(0);
  } else if (failingRules.size > 0) {
    console.warn(
      `Accessibility advisory mode: ${failingRules.size} failing rule(s) were reported. ` +
        "The check is allowed to pass; fix or formally bypass the PR before restoring enforcement.",
    );
  }
});
}
