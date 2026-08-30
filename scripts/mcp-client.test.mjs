import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpClientService } from "../dist-electron/main/mcp-client.js";
import {
  processKeyProtector,
  SecureDataStore,
} from "../dist-electron/main/secure-store.js";

test("local MCP configuration is encrypted and only read-only tools can run", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-mcp-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const serverFile = path.join(root, "server.mjs");
  await fs.writeFile(
    serverFile,
    `import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send(message.id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1.0.0" }
    });
  } else if (message.method === "tools/list") {
    send(message.id, {
      tools: [{
        name: "lookup",
        description: "Return public fixture information",
        inputSchema: { type: "object", properties: { topic: { type: "string" } } },
        annotations: { readOnlyHint: true }
      }]
    });
  } else if (message.method === "tools/call") {
    send(message.id, {
      content: [{ type: "text", text: "result for " + String(message.params.arguments.topic || "") }],
      isError: false
    });
  }
});
`,
    "utf8",
  );
  const data = path.join(root, "data");
  const secure = new SecureDataStore(data, processKeyProtector(data));
  await secure.ready();
  const service = new McpClientService(secure, data);
  const saved = await service.saveServer({
    name: "Fixture docs",
    command: process.execPath,
    args: [serverFile],
    enabled: true,
  });
  assert.equal((await service.listServers())[0].name, "Fixture docs");

  const encrypted = await fs.readFile(
    path.join(data, "secure", "state", "mcp-servers.oscode-data"),
  );
  assert.equal(encrypted.includes(Buffer.from("Fixture docs")), false);
  assert.equal(encrypted.includes(Buffer.from(serverFile)), false);

  const tools = JSON.parse(await service.listTools(saved.id));
  assert.equal(tools[0].tools[0].name, "lookup");
  assert.equal(tools[0].tools[0].readOnly, true);
  const result = JSON.parse(
    await service.callReadOnlyTool(saved.id, "lookup", {
      topic: "accessibility",
    }),
  );
  assert.equal(result.untrusted, true);
  assert.match(result.content[0].text, /accessibility/);
});
