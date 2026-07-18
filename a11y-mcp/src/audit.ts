import { chromium, type Browser, type Page } from "playwright";
import { Playwright } from "@siteimprove/alfa-playwright";
import { Audit, Logging, Rules } from "@siteimprove/alfa-test-utils";

/**
 * Conformance targets. `wcag21aa-plus` mirrors this repo's CI gate exactly
 * (WCAG 2.1 A/AA + Alfa Best Practices + ARIA), so an agent's findings match
 * what the deterministic "Accessibility audit (Alfa)" check will enforce.
 */
export type Conformance = "wcag21aa-plus" | "wcag21aa" | "wcag22aa" | "all";

export interface AuditReport {
  verdict: "pass" | "fail";
  target: string;
  conformance: Conformance;
  summary: {
    rulesApplicable: number;
    rulesFailed: number;
    rulesCantTell: number;
    occurrencesFailed: number;
    occurrencesCantTell: number;
  };
  failedRules: Array<{ rule: string; uri: string; failed: number; cantTell: number }>;
  /** Human-readable, titled issue list — the same report the CI job prints. */
  human: string;
}

// Same conformance target the CI gate uses.
const wcag21aaPlus: typeof Rules.wcag21aaFilter = (rule) =>
  Rules.wcag21aaFilter(rule) ||
  Rules.bestPracticesFilter(rule) ||
  Rules.ARIAFilter(rule);

function auditOptions(c: Conformance) {
  switch (c) {
    case "all":
      return undefined; // omit `rules` -> run all stable Alfa rules
    case "wcag21aa":
      return { rules: { include: Rules.wcag21aaFilter } };
    case "wcag22aa":
      return { rules: { include: Rules.aaFilter } };
    case "wcag21aa-plus":
    default:
      return { rules: { include: wcag21aaPlus } };
  }
}

// One headless browser, reused across audits, launched lazily.
let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

function renderLog(log: Logging, depth = 0): string {
  let out = "  ".repeat(depth) + log.title + "\n";
  for (const child of log.logs) out += renderLog(child, depth + 1);
  return out;
}

function shortId(uri: string): string {
  const last = uri.split("/").pop();
  return last && last.length > 0 ? last : uri;
}

async function auditPage(page: Page, c: Conformance, target: string): Promise<AuditReport> {
  const handle = await page.evaluateHandle("document");
  const alfaPage = await Playwright.toPage(handle);
  const options = auditOptions(c);
  const result = options ? await Audit.run(alfaPage, options) : await Audit.run(alfaPage);

  const aggregates = result.toJSON().resultAggregates;
  let rulesApplicable = 0;
  let rulesFailed = 0;
  let rulesCantTell = 0;
  let occurrencesFailed = 0;
  let occurrencesCantTell = 0;
  const failedRules: AuditReport["failedRules"] = [];

  for (const [uri, v] of aggregates) {
    if (v.failed + v.passed + v.cantTell > 0) rulesApplicable++;
    occurrencesFailed += v.failed;
    occurrencesCantTell += v.cantTell;
    if (v.failed > 0) {
      rulesFailed++;
      failedRules.push({ rule: shortId(uri), uri, failed: v.failed, cantTell: v.cantTell });
    } else if (v.cantTell > 0) {
      rulesCantTell++;
    }
  }
  failedRules.sort((a, b) => b.failed - a.failed);

  return {
    verdict: rulesFailed === 0 ? "pass" : "fail",
    target,
    conformance: c,
    summary: { rulesApplicable, rulesFailed, rulesCantTell, occurrencesFailed, occurrencesCantTell },
    failedRules,
    human: renderLog(Logging.fromAudit(result)).trimEnd(),
  };
}

export async function auditUrl(url: string, c: Conformance): Promise<AuditReport> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    return await auditPage(page, c, url);
  } finally {
    await page.close();
  }
}

export async function auditHtml(html: string, c: Conformance): Promise<AuditReport> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await auditPage(page, c, "inline HTML");
  } finally {
    await page.close();
  }
}
