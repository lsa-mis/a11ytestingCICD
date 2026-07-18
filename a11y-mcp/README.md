# a11y-alfa-mcp

An **MCP server that exposes this repo's Siteimprove Alfa accessibility audit as agent-callable tools.** It runs the *same* ACT-rule engine as the CI gate ([`tests/accessibility.spec.ts`](../tests/accessibility.spec.ts)), so an agent's findings match exactly what the deterministic **Accessibility audit (Alfa)** check will enforce — no engine-mismatch confusion (unlike bolting on axe-core).

## Why this exists

The CI gate is **deterministic and merge-blocking**, but it only audits fixed routes and can't be asked questions. This server is the **interactive, on-demand** complement:

- Audit **any URL or HTML** while you work — including a state an agent navigated to (a modal, a filled form, an auth'd view) that a static `page.goto("/")` never renders.
- **Engine parity:** default scope `wcag21aa-plus` = WCAG 2.1 A/AA + Best Practices + ARIA, identical to the gate. A green here is a green there.
- **Model-agnostic:** drive it from cloud Claude in Claude Code, or from a **local model** (e.g. Qwen3-Coder on an NVIDIA DGX Spark) via any MCP-capable agent — the audit itself is CPU/browser work, no GPU needed.

It **never replaces the gate.** It's a triage/authoring aid; the committed spec is still what CI enforces.

## Tools

| Tool         | Params                                                     | Does |
| ------------ | --------------------------------------------------------- | ---- |
| `audit_url`  | `url` (required), `conformance` (optional)                | Render a URL in headless Chromium, audit the live DOM, return pass/fail + titled WCAG issues + JSON. |
| `audit_html` | `html` (required), `conformance` (optional)               | Same, for a raw HTML document/fragment — check a component or generated markup before it ships. |

**`conformance`** — `wcag21aa-plus` (default, = the gate) · `wcag21aa` · `wcag22aa` · `all`.

Each call returns a human-readable issue list (the same report CI prints) **and** a machine-readable JSON block: `verdict`, `summary` (rules/occurrences failed + `cantTell` needing human review), and `failedRules`.

## Setup

```bash
cd a11y-mcp
npm install
npx playwright install chromium   # if not already present from the parent repo
npm run build
npm run smoke                     # optional: audits a bad + a good HTML sample
```

## Use it in Claude Code

A project config is committed at the repo root ([`.mcp.json`](../.mcp.json)):

```json
{
  "mcpServers": {
    "a11y-alfa": { "command": "node", "args": ["a11y-mcp/dist/server.js"] }
  }
}
```

Run `claude` in the repo, approve the project server on first use, and check it with `/mcp` (or `claude mcp list`). Then, with the dev server running (`npm run dev` in the parent), ask the agent to `audit_url http://localhost:5173/` — or have it drive a Playwright MCP to a hard state and audit *that*.

Equivalent one-liner instead of the committed file:

```bash
claude mcp add --scope project a11y-alfa -- node a11y-mcp/dist/server.js
```

## Security

The server launches a local headless Chromium and navigates to URLs **you pass it** — treat that like any fetch. It only reads/audits the DOM; it never clicks, types, or submits. Keep it pointed at local/trusted URLs. It needs Node 20+.

## Relationship to the CI gate

```
CI gate (deterministic, blocks merges)   ── enforces ──►  fixed routes, on every PR
        │  same Alfa engine, same rules
this MCP (interactive, agent-callable)   ── advises ───►  any URL / state, on demand
```

Findings agree because the engine is identical. Fixes you make with the MCP's help are then verified by the unchanged gate.
