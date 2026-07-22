import { test, expect } from "@playwright/test";

import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules } from "@siteimprove/alfa-test-utils";

/**
 * DEMONSTRATION SPEC — this test is *expected to fail*.
 *
 * `violations.html` is a deliberately broken page: every block in it breaks a
 * different accessibility rule. Auditing it proves the gate actually catches a
 * broad range of WCAG problems rather than just passing everything through.
 *
 * On this branch CI is therefore expected to turn RED. That is the point —
 * delete `violations.html` and this spec to restore a green build.
 *
 * As of writing it trips 18 distinct rules across 73 occurrences.
 */

const conformanceTarget: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||
  Rules.bestPracticesFilter(rule) ||
  Rules.ARIAFilter(rule);

test("violation showcase is caught by the accessibility gate", async ({ page }) => {
  await page.goto("/violations.html");

  const alfaPage = await Playwright.toPage(await page.evaluateHandle("document"));
  const alfaResult = await Audit.run(alfaPage, {
    rules: { include: conformanceTarget },
  });

  // Print the full catalogue of what was caught.
  Logging.fromAudit(alfaResult).print();

  const failingRules = alfaResult.resultAggregates.filter(
    (aggregate) => aggregate.failed > 0,
  );

  expect(
    failingRules.size,
    `violations.html trips ${failingRules.size} accessibility rule(s) — ` +
      `see the printed report above. This failure is intentional.`,
  ).toBe(0);
});
