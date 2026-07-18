#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { auditHtml, auditUrl, closeBrowser, type AuditReport, type Conformance } from "./audit.js";

const conformance = z
  .enum(["wcag21aa-plus", "wcag21aa", "wcag22aa", "all"])
  .default("wcag21aa-plus")
  .describe(
    "Rule scope. 'wcag21aa-plus' (default) = WCAG 2.1 A/AA + Best Practices + ARIA, matching this repo's CI gate. 'wcag21aa' / 'wcag22aa' narrow to those success criteria; 'all' runs every stable Alfa rule.",
  );

function toResult(r: AuditReport) {
  const text =
    `Accessibility audit (Alfa) — ${r.verdict.toUpperCase()} for ${r.target}\n` +
    `Scope: ${r.conformance} · ${r.summary.rulesFailed} rule(s) failed ` +
    `(${r.summary.occurrencesFailed} occurrence(s)); ${r.summary.rulesCantTell} rule(s) need human review (Can't Tell).\n\n` +
    `${r.human}\n\n` +
    "```json\n" +
    JSON.stringify(
      {
        verdict: r.verdict,
        target: r.target,
        conformance: r.conformance,
        summary: r.summary,
        failedRules: r.failedRules,
      },
      null,
      2,
    ) +
    "\n```";
  return { content: [{ type: "text" as const, text }], isError: false };
}

function toError(target: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Audit failed for ${target}: ${message}` }],
    isError: true,
  };
}

const server = new McpServer({ name: "a11y-alfa", version: "0.1.0" });

server.registerTool(
  "audit_url",
  {
    title: "Audit a URL for accessibility (Alfa / WCAG)",
    description:
      "Render a URL in headless Chromium and audit its live DOM with the Siteimprove Alfa engine — the SAME ACT-rule engine as this repo's CI gate. Returns a pass/fail verdict plus titled WCAG issues and machine-readable JSON. Use it to check any page, or a state you've navigated to, before it reaches the deterministic gate.",
    inputSchema: {
      url: z.string().url().describe("Absolute URL to audit, e.g. http://localhost:5173/"),
      conformance,
    },
  },
  async ({ url, conformance }) => {
    try {
      return toResult(await auditUrl(url, conformance as Conformance));
    } catch (e) {
      return toError(url, e);
    }
  },
);

server.registerTool(
  "audit_html",
  {
    title: "Audit an HTML snippet for accessibility (Alfa / WCAG)",
    description:
      "Render a raw HTML string in headless Chromium and audit it with the Siteimprove Alfa engine (same as the CI gate). Use it to check a component or generated markup before committing.",
    inputSchema: {
      html: z.string().describe("A full HTML document or fragment to audit."),
      conformance,
    },
  },
  async ({ html, conformance }) => {
    try {
      return toResult(await auditHtml(html, conformance as Conformance));
    } catch (e) {
      return toError("inline HTML", e);
    }
  },
);

async function shutdown() {
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only — stdout is the MCP transport.
console.error("[a11y-alfa] MCP server ready (stdio). Tools: audit_url, audit_html.");
