import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import ExcelJS, { type Cell, type Worksheet } from "exceljs";
import { Logging, type Audit } from "@siteimprove/alfa-test-utils";

/**
 * Prints a terminal-first accessibility report for one audited route and, in
 * GitHub Actions only, writes a durable, shareable report bundle.
 *
 * Five formats land in `reports/<route>/` so each audience gets what it needs:
 *   summary.md   — human-readable; paste into a PR or ticket
 *   report.json  — machine-readable; for dashboards or trend tracking
 *   issues.csv   — spreadsheet-friendly; open in Excel/Sheets
 *   rules.csv    — rule-level counts keyed by Alfa rule URI
 *   accessibility-report.xlsx — styled, multi-sheet remediation workbook
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
  artifactsGenerated: boolean;
  directory?: string;
  workbook?: string;
  rulesFailed: number;
  occurrencesFailed: number;
  rulesCantTell: number;
}

const REPORTS_ROOT = "reports";
const HOUSE_GREEN = "356854";
const HOUSE_PALE = "F6F8F9";
const HOUSE_BORDER = "D0D7DE";
const HOUSE_NOTE = "FFF2CC";
const LINK_BLUE = "0000FF";
const ARCHITECTURE_DIAGRAM_URL = "https://www.figma.com/board/AbFr96627HFk26IQfb2xrJ";
const OVERRIDE_GUIDE_PATH = "docs/A11Y-OVERRIDES.md";

interface RuleReportRow {
  rule: string;
  title: string;
  uri: string;
  failed: number;
  passed: number;
  cantTell: number;
}

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

function printReportIndex(
  meta: ReportMeta,
  verdict: "pass" | "fail",
  rules: RuleReportRow[],
  rendered: string,
  artifactsGenerated: boolean,
  directory?: string,
  runUrl?: string,
): void {
  const lines = [
    "",
    "Accessibility report — where to look",
    `Verdict: ${verdict.toUpperCase()}`,
    `Page: ${meta.url}`,
    `Standard: ${meta.conformance}`,
    `  Open Accessibility CI/CD Architecture in Figma: ${ARCHITECTURE_DIAGRAM_URL}`,
    "Merge decision options (the report always keeps the failure):",
    "  Default: ENFORCE — the required check blocks the merge until the issue is fixed.",
    "  Manual audit: Actions → CI → Run workflow → choose accessibility_enforcement: advisory.",
    "  One PR: use the configured maintainer-only ruleset bypass and record the reason.",
    `  Setup and guardrails: ${OVERRIDE_GUIDE_PATH}`,
  ];
  if (artifactsGenerated && directory) {
    lines.splice(
      5,
      0,
      "CI artifact files:",
      `  Workbook: ${join(directory, "accessibility-report.xlsx")}`,
      `  Evidence JSON: ${join(directory, "report.json")}`,
      `  Human summary: ${join(directory, "summary.md")}`,
      `  Issue rows: ${join(directory, "issues.csv")}`,
      `  Rule rows: ${join(directory, "rules.csv")}`,
    );
  } else {
    lines.splice(5, 0, "Local mode: no report files were created. CI creates the downloadable XLSX bundle.");
  }
  if (runUrl) lines.push(`Workflow run and downloadable artifacts: ${runUrl}`);

  if (rules.length === 0) {
    lines.push("Open issues: none");
  } else {
    lines.push("Open issues and review leads:");
    rules.forEach((rule, index) => {
      const result = rule.failed > 0
        ? `FAILED — ${rule.failed} occurrence(s)`
        : `NEEDS REVIEW — ${rule.cantTell} occurrence(s)`;
      lines.push(`  ${index + 1}. [${result}] ${rule.title}`);
      lines.push(`     Page: ${meta.url}`);
      lines.push(`     Rule guidance: ${rule.uri}`);
      lines.push(
        artifactsGenerated && directory
          ? `     Exact targets/diagnostics: ${join(directory, "report.json")} (search for ${rule.rule})`
          : "     Exact targets/diagnostics: see the detailed Alfa trail below.",
      );
    });
    if (!artifactsGenerated) {
      lines.push("Detailed Alfa trail (targets and diagnostics):");
      lines.push(rendered);
    }
  }

  console.log(lines.join("\n"));
}

function setHyperlink(cell: Cell, url: string, label = url): void {
  cell.value = { text: label, hyperlink: url, tooltip: url };
  cell.font = { color: { argb: LINK_BLUE }, underline: true };
}

function startHouseSheet(
  sheet: Worksheet,
  title: string,
  description: string,
  widths: number[],
): void {
  sheet.properties.defaultRowHeight = 15;
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.columns = widths.map((width) => ({ width }));
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = {
    bold: true,
    size: 14,
    color: { argb: HOUSE_GREEN },
  };
  sheet.getCell("A2").value = description;
  sheet.getCell("A2").font = { size: 10 };
  sheet.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  sheet.mergeCells(2, 1, 2, widths.length);
  sheet.getRow(2).height = 30;
}

function styleTable(sheet: Worksheet, headerRow: number, lastRow: number, lastColumn: number): void {
  const header = sheet.getRow(headerRow);
  header.height = 22;
  for (let column = 1; column <= lastColumn; column++) {
    const cell = header.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HOUSE_GREEN } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  }

  for (let rowNumber = headerRow; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (rowNumber > headerRow && rowNumber % 2 === 0) {
      for (let column = 1; column <= lastColumn; column++) {
        row.getCell(column).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HOUSE_PALE },
        };
      }
    }
    for (let column = 1; column <= lastColumn; column++) {
      const cell = row.getCell(column);
      cell.border = {
        top: { style: "thin", color: { argb: HOUSE_BORDER } },
        bottom: { style: "thin", color: { argb: HOUSE_BORDER } },
        left: { style: "thin", color: { argb: HOUSE_BORDER } },
        right: { style: "thin", color: { argb: HOUSE_BORDER } },
      };
      cell.alignment = {
        ...cell.alignment,
        wrapText: true,
        vertical: "top",
      };
    }
  }

  if (lastRow > headerRow) {
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: lastRow, column: lastColumn },
    };
  }
}

function addEmptyMessage(sheet: Worksheet, row: number, message: string, lastColumn: number): void {
  sheet.mergeCells(row, 1, row, lastColumn);
  const cell = sheet.getCell(row, 1);
  cell.value = message;
  cell.font = { italic: true, size: 10 };
  cell.alignment = { wrapText: true, vertical: "top" };
}

async function writeHouseWorkbook(
  directory: string,
  meta: ReportMeta,
  generatedAt: string,
  engineVersion: string,
  verdict: "pass" | "fail",
  rules: RuleReportRow[],
  allRules: RuleReportRow[],
  summary: {
    rulesFailed: number;
    rulesCantTell: number;
    rulesPassed: number;
    occurrencesFailed: number;
    occurrencesCantTell: number;
  },
  ci: { commit?: string; branch?: string; runUrl?: string },
  siteimproveUrl?: string,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Accessibility CI";
  workbook.created = new Date(generatedAt);
  workbook.modified = new Date(generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  const issuesLastRow = Math.max(9, 8 + rules.length);
  const coverageLastRow = Math.max(5, 4 + allRules.length);

  // Summary -----------------------------------------------------------------
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.views = [{ showGridLines: false }];
  summarySheet.columns = [{ width: 42 }, { width: 60 }];
  summarySheet.getCell("A1").value = `Accessibility audit — ${meta.route}`;
  summarySheet.getCell("A1").font = {
    bold: true,
    size: 14,
    color: { argb: HOUSE_GREEN },
  };
  summarySheet.getCell("A2").value =
    "At-a-glance summary of this CI audit. Each rollup below has its own sheet with the detail; this is the dashboard for tracking remediation.";
  summarySheet.getCell("A2").font = { size: 10 };
  summarySheet.getCell("A2").alignment = { wrapText: true };
  summarySheet.mergeCells("A2:B2");
  summarySheet.getRow(2).height = 30;

  const section = (row: number, label: string): void => {
    summarySheet.mergeCells(row, 1, row, 2);
    const cell = summarySheet.getCell(row, 1);
    cell.value = label;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HOUSE_GREEN } };
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
  };
  const summaryRow = (row: number, label: string, value: string | number | Date): void => {
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    summarySheet.getCell(row, 2).value = value;
    summarySheet.getRow(row).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: HOUSE_BORDER } },
      };
    });
  };
  const formulaRow = (row: number, label: string, formula: string, result: number): void => {
    summaryRow(row, label, 0);
    summarySheet.getCell(row, 2).value = { formula, result };
    summarySheet.getCell(row, 2).numFmt = "#,##0";
  };

  section(4, "Scan");
  summaryRow(5, "Page", meta.url);
  setHyperlink(summarySheet.getCell("B5"), meta.url);
  summaryRow(6, "Audited against", meta.conformance);
  summaryRow(7, "Engine", `Siteimprove Alfa ${engineVersion}`);
  summaryRow(8, "Audit date", new Date(generatedAt));
  summarySheet.getCell("B8").numFmt = "mmmm d, yyyy";

  section(10, "Issue counts");
  formulaRow(
    11,
    "Open issue types",
    `=COUNTIF('Coverage & Method'!$C$5:$C$${coverageLastRow},\"Failed\")`,
    summary.rulesFailed,
  );
  formulaRow(
    12,
    "Open findings (occurrences)",
    `=SUM('Coverage & Method'!$D$5:$D$${coverageLastRow})`,
    summary.occurrencesFailed,
  );
  formulaRow(
    13,
    "Needs human review (rule types)",
    `=COUNTIF('Coverage & Method'!$C$5:$C$${coverageLastRow},\"Needs review\")`,
    summary.rulesCantTell,
  );
  formulaRow(
    14,
    "Passed rule types",
    `=COUNTIF('Coverage & Method'!$C$5:$C$${coverageLastRow},\"Passed\")`,
    summary.rulesPassed,
  );

  section(16, "Audit outcome");
  summaryRow(17, "Verdict", verdict.toUpperCase());
  formulaRow(18, "Failed occurrences", `=SUM('Coverage & Method'!$D$5:$D$${coverageLastRow})`, summary.occurrencesFailed);
  formulaRow(19, "Can't Tell occurrences", `=SUM('Coverage & Method'!$E$5:$E$${coverageLastRow})`, summary.occurrencesCantTell);

  section(21, "CI context");
  summaryRow(22, "Branch", ci.branch ?? "Local run");
  summaryRow(23, "Commit", ci.commit ? ci.commit.slice(0, 8) : "Local working tree");
  summaryRow(24, "Workflow run", ci.runUrl ?? "Not available for local runs");
  if (ci.runUrl) setHyperlink(summarySheet.getCell("B24"), ci.runUrl, "Open workflow run");
  summaryRow(25, "Siteimprove report", siteimproveUrl ?? "Not uploaded");
  if (siteimproveUrl) setHyperlink(summarySheet.getCell("B25"), siteimproveUrl, "Open Siteimprove report");

  // Issues Overview ---------------------------------------------------------
  const issuesSheet = workbook.addWorksheet("Issues Overview");
  issuesSheet.columns = [38, 28, 18, 22, 16, 50, 30, 50, 38, 24, 24].map((width) => ({ width }));
  issuesSheet.views = [{ state: "frozen", ySplit: 8, showGridLines: false }];
  issuesSheet.getCell("A1").value = `Page: ${meta.url}`;
  setHyperlink(issuesSheet.getCell("A1"), meta.url, `Page: ${meta.url}`);
  issuesSheet.getCell("A2").value = `Compliance Standard: ${meta.conformance}`;
  issuesSheet.getCell("A3").value = `Audit Date: ${new Date(generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  issuesSheet.getCell("A4").value = `Auditor: Siteimprove Alfa ${engineVersion}`;
  issuesSheet.mergeCells("A5:K5");
  issuesSheet.getCell("A5").value =
    "Prioritization Guidance — Fix failed rules before items marked Needs Review. Alfa provides rule and occurrence evidence; assign ownership, severity, and remediation details during triage.";
  issuesSheet.getCell("A5").fill = { type: "pattern", pattern: "solid", fgColor: { argb: HOUSE_NOTE } };
  issuesSheet.getCell("A5").alignment = { wrapText: true, vertical: "top" };
  issuesSheet.getRow(5).height = 48;
  issuesSheet.getRow(8).values = [
    "Issues",
    "Detection source",
    "Conformance Level",
    "Remediation Ownership",
    "Status",
    "What to Fix",
    "Page Links / Locations",
    "Action",
    "Helpful Resources",
    "Notes",
    "Evidence",
  ];
  if (rules.length === 0) {
    addEmptyMessage(issuesSheet, 9, "No failed or indeterminate rules were reported.", 11);
  } else {
    rules.forEach((rule, index) => {
      const row = issuesSheet.getRow(9 + index);
      row.values = [
        rule.title,
        "Siteimprove Alfa (ACT rules)",
        "A/AA scope",
        "Unassigned",
        "Not Started",
        rule.failed > 0
          ? `Alfa returned ${rule.failed} failed outcome(s) for this rule.`
          : `Alfa returned ${rule.cantTell} outcome(s) that require expert review.`,
        meta.url,
        "Open the rule reference and inspect the affected target and diagnostic in the JSON report. Record the remediation owner and notes, then rerun the audit.",
        rule.uri,
        "",
        rule.failed > 0 ? `${rule.failed} failed` : `${rule.cantTell} needs review`,
      ];
      row.height = 60;
      setHyperlink(row.getCell(7), meta.url, "1 linked page — open page");
      setHyperlink(row.getCell(9), rule.uri);
      row.getCell(5).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Not Started,In Progress,Blocked,Done"'],
      };
    });
  }
  styleTable(issuesSheet, 8, issuesLastRow, 11);

  // Owner Worklist ----------------------------------------------------------
  const ownerSheet = workbook.addWorksheet("Owner Worklist");
  startHouseSheet(
    ownerSheet,
    "Remediation worklist by owner",
    "The same open rules, re-sliced for assignment. Update Owner after triage, then filter the column to hand each team its pack.",
    [24, 46, 18, 24, 12, 24, 30],
  );
  ownerSheet.getRow(4).values = ["Owner", "Issue", "Result", "Effort", "Pages", "Rule", "Detection source"];
  if (rules.length === 0) {
    addEmptyMessage(ownerSheet, 5, "No remediation work is open.", 7);
  } else {
    rules.forEach((rule, index) => {
      ownerSheet.getRow(5 + index).values = [
        "Unassigned",
        rule.title,
        rule.failed > 0 ? "Failed" : "Needs review",
        "Triage required",
        1,
        rule.rule,
        "Siteimprove Alfa (ACT rules)",
      ];
    });
  }
  styleTable(ownerSheet, 4, Math.max(5, 4 + rules.length), 7);

  // Page Hotspots -----------------------------------------------------------
  const hotspotsSheet = workbook.addWorksheet("Page Hotspots");
  startHouseSheet(
    hotspotsSheet,
    "Page hotspots",
    "Pages carrying failed or indeterminate outcomes. This CI audit currently runs one route per test; add routes to compare hotspots across the site.",
    [56, 44, 20, 20],
  );
  hotspotsSheet.getRow(4).values = ["Page", "Title", "Failed findings", "Needs review"];
  hotspotsSheet.getRow(5).values = [meta.url, meta.title || "Untitled", summary.occurrencesFailed, summary.occurrencesCantTell];
  setHyperlink(hotspotsSheet.getCell("A5"), meta.url);
  styleTable(hotspotsSheet, 4, 5, 4);

  // Page References ---------------------------------------------------------
  const referencesSheet = workbook.addWorksheet("Page References");
  startHouseSheet(
    referencesSheet,
    "Page references",
    "Every open rule is tied to the audited page as a direct link. Filter by issue or status to move from the worklist to page-level evidence.",
    [44, 30, 64, 18, 18],
  );
  referencesSheet.getRow(4).values = ["Issue", "Detection source", "Page", "Occurrences", "Status"];
  if (rules.length === 0) {
    addEmptyMessage(referencesSheet, 5, "No affected pages were reported.", 5);
  } else {
    rules.forEach((rule, index) => {
      const row = referencesSheet.getRow(5 + index);
      row.values = [
        rule.title,
        "Siteimprove Alfa (ACT rules)",
        meta.url,
        rule.failed + rule.cantTell,
        "Not Started",
      ];
      setHyperlink(row.getCell(3), meta.url);
      row.getCell(5).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Not Started,In Progress,Blocked,Done"'],
      };
    });
  }
  styleTable(referencesSheet, 4, Math.max(5, 4 + rules.length), 5);

  // Who's Affected ----------------------------------------------------------
  const affectedSheet = workbook.addWorksheet("Who's Affected");
  startHouseSheet(
    affectedSheet,
    "Who is affected",
    "Alfa identifies standards failures, not affected user groups. Classify user impact during triage; counts below intentionally expose that remaining work.",
    [48, 28, 28],
  );
  affectedSheet.getRow(4).values = ["User group", "Issue types affecting them", "Across (page-instances)"];
  affectedSheet.getRow(5).values = ["Manual classification required", rules.length, rules.length > 0 ? 1 : 0];
  styleTable(affectedSheet, 4, 5, 3);

  // Coverage & Method -------------------------------------------------------
  const coverageSheet = workbook.addWorksheet("Coverage & Method");
  startHouseSheet(
    coverageSheet,
    "Coverage & method — Alfa rule results",
    "Every rule evaluated for this page, including passed rules. Failed and Can't Tell counts remain separate so automation never hides human-review work.",
    [26, 54, 20, 14, 16, 14],
  );
  coverageSheet.getRow(4).values = ["Rule", "Reference", "Result", "Failed", "Can't Tell", "Passed"];
  if (allRules.length === 0) {
    addEmptyMessage(coverageSheet, 5, "No Alfa rule results were recorded.", 6);
  } else {
    allRules.forEach((rule, index) => {
      const row = coverageSheet.getRow(5 + index);
      row.values = [
        rule.rule,
        rule.uri,
        rule.failed > 0
          ? "Failed"
          : rule.cantTell > 0
            ? "Needs review"
            : rule.passed > 0
              ? "Passed"
              : "Not applicable",
        rule.failed,
        rule.cantTell,
        rule.passed,
      ];
      setHyperlink(row.getCell(2), rule.uri);
    });
  }
  styleTable(coverageSheet, 4, coverageLastRow, 6);

  // Test Tracking -----------------------------------------------------------
  const reviewRules = rules.filter((rule) => rule.cantTell > 0);
  const trackingSheet = workbook.addWorksheet("Test Tracking");
  startHouseSheet(
    trackingSheet,
    "Manual Test Tracking",
    "Automated checks cannot decide every result. Review each indeterminate rule below and record Pass / Fail after testing with the relevant human method.",
    [42, 92, 18],
  );
  trackingSheet.getRow(4).values = ["Focus", "What to check", "Pass / Fail"];
  if (reviewRules.length === 0) {
    addEmptyMessage(trackingSheet, 5, "No rules returned Can't Tell in this audit.", 3);
  } else {
    reviewRules.forEach((rule, index) => {
      const row = trackingSheet.getRow(5 + index);
      row.values = [
        rule.title,
        `Review ${rule.cantTell} indeterminate outcome(s). Inspect the target and diagnostic in report.json, test the behavior manually, and retain supporting evidence.`,
        "",
      ];
      row.getCell(3).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"Pass,Fail,Not Applicable"'],
      };
    });
  }
  styleTable(trackingSheet, 4, Math.max(5, 4 + reviewRules.length), 3);

  // Manual Review Evidence --------------------------------------------------
  const evidenceSheet = workbook.addWorksheet("Manual Review Evidence");
  startHouseSheet(
    evidenceSheet,
    "Manual review evidence",
    "Human decisions and the page/external evidence supporting them. Rows without evidence are decisions that still need supporting references.",
    [22, 40, 20, 50, 52, 52, 46],
  );
  evidenceSheet.getRow(4).values = [
    "Rule",
    "Criterion",
    "Outcome",
    "Rationale",
    "Page reference",
    "External reference",
    "Expert note",
  ];
  addEmptyMessage(evidenceSheet, 5, "No manual decisions have been recorded yet.", 7);
  styleTable(evidenceSheet, 4, 5, 7);

  const workbookPath = join(directory, "accessibility-report.xlsx");
  await workbook.xlsx.writeFile(workbookPath);
  return workbookPath;
}

export async function writeAccessibilityReport(audit: Audit, meta: ReportMeta): Promise<ReportResult> {
  const json = audit.toJSON();
  const aggregates = json.resultAggregates;

  let rulesFailed = 0;
  let rulesPassed = 0;
  let rulesCantTell = 0;
  let occurrencesFailed = 0;
  let occurrencesCantTell = 0;

  const allRules: RuleReportRow[] = [];

  for (const [uri, counts] of aggregates) {
    occurrencesFailed += counts.failed;
    occurrencesCantTell += counts.cantTell;
    if (counts.failed > 0) rulesFailed++;
    else if (counts.cantTell > 0) rulesCantTell++;
    else if (counts.passed > 0) rulesPassed++;

    allRules.push({
      rule: uri.split("/").pop() ?? uri,
      title: uri.split("/").pop() ?? uri,
      uri,
      failed: counts.failed,
      passed: counts.passed,
      cantTell: counts.cantTell,
    });
  }
  const rules = allRules.filter((rule) => rule.failed > 0 || rule.cantTell > 0);
  rules.sort((a, b) => b.failed - a.failed || b.cantTell - a.cantTell);
  allRules.sort((a, b) => a.rule.localeCompare(b.rule, undefined, { numeric: true }));

  const rendered = renderLog(Logging.fromAudit(audit, meta.reportUrl)).trimEnd();
  const siteimproveUrl = reportUrlToString(meta.reportUrl);
  const issues = extractIssues(rendered);
  const failedRulesByUri = rules.filter((rule) => rule.failed > 0).sort((a, b) => a.uri.localeCompare(b.uri));
  failedRulesByUri.forEach((rule, index) => {
    rule.title = issues[index]?.title ?? `Alfa ACT rule: ${rule.rule}`;
  });
  rules
    .filter((rule) => rule.failed === 0 && rule.cantTell > 0)
    .forEach((rule) => {
      rule.title = `Expert review needed: ${rule.rule}`;
    });
  for (const rule of allRules) {
    const openRule = rules.find((candidate) => candidate.uri === rule.uri);
    if (openRule) rule.title = openRule.title;
  }
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

  // Developers get all actionable information in the terminal. The larger
  // XLSX/JSON/CSV bundle is deliberately CI-only, where it is uploaded once as
  // an artifact for the whole team rather than recreated on every local run.
  const artifactsGenerated = process.env.GITHUB_ACTIONS === "true";
  if (!artifactsGenerated) {
    printReportIndex(meta, verdict, rules, rendered, false, undefined, runUrl);
    return {
      verdict,
      artifactsGenerated: false,
      rulesFailed,
      occurrencesFailed,
      rulesCantTell,
    };
  }

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
    outcomes: json.outcomes,
    durations: json.durations,
    siteimproveReportUrl: siteimproveUrl,
    architectureDiagramUrl: ARCHITECTURE_DIAGRAM_URL,
    overrideGuidePath: OVERRIDE_GUIDE_PATH,
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
  lines.push(`| Architecture diagram | [Open Accessibility CI/CD Architecture in Figma](${ARCHITECTURE_DIAGRAM_URL}) |`);
  lines.push(`| Merge decision options | ENFORCE by default; manual advisory run or maintainer-only PR bypass when authorized. See \`${OVERRIDE_GUIDE_PATH}\`. |`);
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

  const workbookPath = await writeHouseWorkbook(
    directory,
    meta,
    generatedAt,
    json.alfaVersion,
    verdict,
    rules,
    allRules,
    { rulesFailed, rulesCantTell, rulesPassed, occurrencesFailed, occurrencesCantTell },
    { commit: GITHUB_SHA, branch: GITHUB_REF_NAME, runUrl },
    siteimproveUrl,
  );

  printReportIndex(meta, verdict, rules, rendered, true, directory, runUrl);

  return {
    verdict,
    artifactsGenerated: true,
    directory,
    workbook: workbookPath,
    rulesFailed,
    occurrencesFailed,
    rulesCantTell,
  };
}
