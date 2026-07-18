import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/server.js"] });
const client = new Client({ name: "demo", version: "0.0.0" });
await client.connect(transport);

console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "), "\n");

const first = (r) => r.content[0].text.split("\n").slice(0, 12).join("\n");

// 1. The real app, as shipped.
console.log("### 1. audit_url  http://localhost:5173/");
console.log(first(await client.callTool({ name: "audit_url", arguments: { url: "http://localhost:5173/" } })), "\n");

// 2. A state the static gate never sees: the newsletter form's *error* state.
console.log("### 2. audit_state  (fill invalid email → submit → audit the error state)");
console.log(first(await client.callTool({
  name: "audit_state",
  arguments: {
    url: "http://localhost:5173/",
    actions: [
      { type: "fill", selector: "#email", value: "not-an-email" },
      { type: "click", selector: "button[type=submit]" },
    ],
  },
})), "\n");

// 3. Another hidden state: an expanded FAQ disclosure.
console.log("### 3. audit_state  (expand a FAQ <details> → audit)");
console.log(first(await client.callTool({
  name: "audit_state",
  arguments: {
    url: "http://localhost:5173/",
    actions: [{ type: "click", selector: ".faq-item summary" }],
  },
})), "\n");

await client.close();
