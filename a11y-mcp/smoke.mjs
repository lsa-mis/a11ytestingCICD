// Smoke test: spawn the built server over stdio, list tools, run an audit.
//   node smoke.mjs   (after `npm run build`)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/server.js"] });
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const bad = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bad</title></head>
<body><img src="x.png"><input type="text"><button></button></body></html>`;
const fail = await client.callTool({ name: "audit_html", arguments: { html: bad } });
console.log("\n--- audit_html (intentionally bad) ---\n" + fail.content[0].text);

const good = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Good</title></head>
<body><a href="#main">Skip to main content</a>
<main id="main"><h1>Hello</h1><img src="x.png" alt="A logo"><label>Email <input type="email"></label>
<button type="button">Go</button></main></body></html>`;
const pass = await client.callTool({ name: "audit_html", arguments: { html: good } });
console.log("\n--- audit_html (accessible) ---\n" + pass.content[0].text);

await client.close();
