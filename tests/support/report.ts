import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Logging, type Audit } from "@siteimprove/alfa-test-utils";

/**
 * Writes a durable, shareable accessibility report for one audited route.
 *
 * Three formats land in `reports/<route>/` so each audience gets what it needs:
 *   summary.md   — human-readable; paste into a PR or ticket
 *   report.json  — machine-readable; for dashboards or trend tracking
 *   issues.csv   — spreadsheet-friendly; open in Excel/Sheets
 *   rules.csv    — rule-level counts keyed by Alfa rule URI
 *
 * The whole folder is uploaded as a CI artifact by the workflow.
 */

export interface ReportMeta {
  /** Route audited, e.g. "/" or "/pricing". */
  route: string;
  /** Fully-resolved URL the browser actually loaded. */
  url: string;
  /** Document title at audit time. */
  title: string;
  /** Human label for the rule scope. */
  conformance: string;
  /**
   * Siteimprove report link, when the optional upload ran. `SIP.upload()`
   * resolves to an Alfa `Result`, not a bare string, so mirror exactly what
   * `Logging.fromAudit` accepts.
   */
  reportUrl?: Parameters<typeof Logging.fromAudit>[1];
}

export interface ReportResult {
  verdict: "pass" | "fail";
  directory: string;
  rulesFailed: number;
  occurrencesFailed: number;
  rulesCantTell: number;
}

const REPORTS_ROOT = "reports";

function slug(route: string): string {
  const s = route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return s.length > 0 ? s.toLowerCase() : "home";
}

function renderLog(log: Logging, depth = 0): string {
  let out = "  ".repeat(depth) + log.title + "\n";
  for (const child of log.logs) out += renderLog(child, depth + 1);
  return out;
}

/** Alfa prints issues as "  1. Some rule title (2 occurrences)" — lift them out. */
function extractIssues(rendered: string): Array<{ title: string; occurrences: number }> {
  const issues: Array<{ title: string; occurrences: number }> = [];
  for (const line of rendered.split("\n")) {
    const match = line.match(/^\s*\d+\.\s+(.+?)\s+\((\d+)\s+occurrence/);
    if (match) issues.push({ title: match[1], occurrences: Number(match[2]) });
  }
  return issues;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** Flatten the Siteimprove link (string, or an Alfa `Result`) down to a string. */
function reportUrlToString(value: ReportMeta["reportUrl"]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  const maybe = value as { getOr?: (fallback: undefined) => string | undefined };
  return typeof maybe.getOr === "function" ? maybe.getOr(undefined) : undefined;
}

export function writeAccessibilityReport(audit: Audit, meta: ReportMeta): ReportResult {
  const json = audit.toJSON();
  const aggregates = json.resultAggregates;

  let rulesFailed = 0;
  let rulesPassed = 0;
  let rulesCantTell = 0;
  let occurrencesFailed = 0;
  let occurrencesCantTell = 0;

  const rules: Array<{
    rule: string;
    uri: string;
    failed: number;
    passed: number;
    cantTell: number;
  }> = [];

  for (const [uri, counts] of aggregates) {
    occurrencesFailed += counts.failed;
    occurrencesCantTell += counts.cantTell;
    if (counts.failed > 0) rulesFailed++;
    else if (counts.cantTell > 0) rulesCantTell++;
    else if (counts.passed > 0) rulesPassed++;

    if (counts.failed > 0 || counts.cantTell > 0) {
      rules.push({
        rule: uri.split("/").pop() ?? uri,
        uri,
        failed: counts.failed,
        passed: counts.passed,
        cantTell: counts.cantTell,
      });
    }
  }
  rules.sort((a, b) => b.failed - a.failed || b.cantTell - a.cantTell);

  const rendered = renderLog(Logging.fromAudit(audit, meta.reportUrl)).trimEnd();
  const siteimproveUrl = reportUrlToString(meta.reportUrl);
  const issues = extractIssues(rendered);
  const verdict: "pass" | "fail" = rulesFailed === 0 ? "pass" : "fail";
  const generatedAt = new Date().toISOString();

  // CI context, when running in GitHub Actions.
  const {
    GITHUB_SHA,
    GITHUB_REF_NAME,
    GITHUB_RUN_ID,
    GITHUB_SERVER_URL,
    GITHUB_REPOSITORY,
  } = process.env;
  const runUrl =
    GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
      ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
      : undefined;

  const directory = join(REPORTS_ROOT, slug(meta.route));
  mkdirSync(directory, { recursive: true });

  // ---- report.json -------------------------------------------------------
  const payload = {
    verdict,
    generatedAt,
    engine: { name: "Siteimprove Alfa", version: json.alfaVersion },
    conformance: meta.conformance,
    page: { route: meta.route, url: meta.url, title: meta.title },
    ci: { commit: GITHUB_SHA, branch: GITHUB_REF_NAME, runUrl },
    summary: {
      rulesFailed,
      rulesCantTell,
      rulesPassed,
      occurrencesFailed,
      occurrencesCantTell,
    },
    issues,
    rules,
    siteimproveReportUrl: siteimproveUrl,
  };
  writeFileSync(join(directory, "report.json"), JSON.stringify(payload, null, 2) + "\n");

  // ---- issues.csv --------------------------------------------------------
  writeFileSync(
    join(directory, "issues.csv"),
    csv([
      ["Route", "Page", "Issue", "Occurrences", "Verdict", "Generated"],
      ...issues.map((i) => [meta.route, meta.url, i.title, i.occurrences, verdict, generatedAt]),
    ]),
  );

  // ---- rules.csv ---------------------------------------------------------
  writeFileSync(
    join(directory, "rules.csv"),
    csv([
      ["Route", "Rule", "Rule URI", "Failed", "Can't Tell", "Passed"],
      ...rules.map((r) => [meta.route, r.rule, r.uri, r.failed, r.cantTell, r.passed]),
    ]),
  );

  // ---- summary.md --------------------------------------------------------
  const lines: Array<string> = [];
  lines.push(`# Accessibility audit — \`${meta.route}\``);
  lines.push("");
  lines.push(
    verdict === "pass"
      ? `**Verdict: PASS** — no accessibility rule failures.`
      : `**Verdict: FAIL** — ${rulesFailed} rule(s) failed across ${occurrencesFailed} occurrence(s).`,
  );
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Page | ${meta.url} |`);
  lines.push(`| Title | ${meta.title || "—"} |`);
  lines.push(`| Standard | ${meta.conformance} |`);
  lines.push(`| Engine | Siteimprove Alfa ${json.alfaVersion} |`);
  lines.push(`| Generated | ${generatedAt} |`);
  if (GITHUB_SHA) lines.push(`| Commit | \`${GITHUB_SHA.slice(0, 8)}\` |`);
  if (GITHUB_REF_NAME) lines.push(`| Branch | ${GITHUB_REF_NAME} |`);
  if (runUrl) lines.push(`| Workflow run | ${runUrl} |`);
  if (siteimproveUrl) lines.push(`| Siteimprove report | ${siteimproveUrl} |`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Outcome | Rules | Occurrences |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| Failed | ${rulesFailed} | ${occurrencesFailed} |`);
  lines.push(`| Can't Tell (needs a human) | ${rulesCantTell} | ${occurrencesCantTell} |`);
  lines.push(`| Passed | ${rulesPassed} | — |`);
  lines.push("");

  if (issues.length > 0) {
    lines.push("## Issues found");
    lines.push("");
    lines.push("| # | Issue | Occurrences |");
    lines.push("| ---: | --- | ---: |");
    issues.forEach((issue, i) => {
      lines.push(`| ${i + 1} | ${issue.title} | ${issue.occurrences} |`);
    });
    lines.push("");
  }

  if (rules.length > 0) {
    lines.push("## Rules");
    lines.push("");
    lines.push("| Rule | Failed | Can't Tell | Reference |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const r of rules) {
      lines.push(`| \`${r.rule}\` | ${r.failed} | ${r.cantTell} | ${r.uri} |`);
    }
    lines.push("");
  }

  lines.push("## Still needs a human");
  lines.push("");
  lines.push(
    rulesCantTell > 0
      ? `${rulesCantTell} rule(s) returned **Can't Tell** — a machine cannot decide them. Review those manually.`
      : "No rules returned *Can't Tell* for this page.",
  );
  lines.push("");
  lines.push(
    "Automated rules cover the machine-detectable slice of WCAG. Meaningful alt text, " +
      "logical reading order, keyboard flows in custom widgets, and screen-reader experience " +
      "still require human review.",
  );
  lines.push("");
  lines.push("<details><summary>Raw engine output</summary>");
  lines.push("");
  lines.push("```");
  lines.push(rendered);
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");

  writeFileSync(join(directory, "summary.md"), lines.join("\n"));

  return { verdict, directory, rulesFailed, occurrencesFailed, rulesCantTell };
}
