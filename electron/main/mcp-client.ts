import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { assertSafeExternalPayload } from "./outbound-guard.js";
import { SecureDataStore } from "./secure-store.js";

export type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
};

type McpServerInput = Omit<McpServerConfig, "id"> & { id?: string };

function cleanLine(value: unknown, label: string, limit: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > limit || /[\u0000\r\n]/.test(text))
    throw new Error(`${label} is invalid`);
  return text;
}

function normalizeServer(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<McpServerConfig>;
  try {
    const command = cleanLine(input.command, "MCP command", 1_000);
    const args = Array.isArray(input.args)
      ? input.args.map((argument) =>
          cleanLine(argument, "MCP command argument", 2_000),
        )
      : [];
    if (args.length > 40) throw new Error("Too many MCP command arguments");
    return {
      id: cleanLine(input.id, "MCP server id", 100),
      name: cleanLine(input.name, "MCP server name", 100),
      command,
      args,
      enabled: input.enabled !== false,
    };
  } catch {
    return null;
  }
}

function safeEnvironment() {
  const result: Record<string, string> = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
    "WINDIR",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]) {
    const value = process.env[key];
    if (value) result[key] = value;
  }
  return result;
}

function boundedJson(value: unknown, limit = 30_000) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= limit) return serialized;
  return `${serialized.slice(0, limit)}\n[Untrusted MCP output truncated]`;
}

export class McpClientService {
  private readonly configPath: string;
  private readonly processRoot: string;

  constructor(
    private readonly secure: SecureDataStore,
    userData: string,
  ) {
    this.configPath = path.join(
      secure.root,
      "state",
      "mcp-servers.oscode-data",
    );
    this.processRoot = path.join(userData, "mcp-runtime");
  }

  async listServers() {
    const stored = await this.secure.readJson<unknown>(
      this.configPath,
      [],
      "mcp-servers",
    );
    return Array.isArray(stored)
      ? stored
          .map(normalizeServer)
          .filter((server): server is McpServerConfig => Boolean(server))
      : [];
  }

  async saveServer(raw: McpServerInput) {
    const id = raw.id?.trim() || crypto.randomUUID();
    const server = normalizeServer({ ...raw, id });
    if (!server) throw new Error("Enter a valid MCP name and command");
    const servers = await this.listServers();
    const next = servers.filter((item) => item.id !== id);
    next.push(server);
    await this.secure.writeJson(this.configPath, next, "mcp-servers");
    return server;
  }

  async removeServer(rawId: unknown) {
    const id = cleanLine(rawId, "MCP server id", 100);
    const servers = await this.listServers();
    const next = servers.filter((item) => item.id !== id);
    if (next.length === servers.length) return false;
    await this.secure.writeJson(this.configPath, next, "mcp-servers");
    return true;
  }

  private async server(rawId: unknown) {
    const id = cleanLine(rawId, "MCP server id", 100);
    const server = (await this.listServers()).find(
      (item) => item.id === id && item.enabled,
    );
    if (!server) throw new Error("That MCP server is disabled or unavailable");
    return server;
  }

  private async withClient<T>(
    server: McpServerConfig,
    run: (client: Client) => Promise<T>,
  ) {
    await fs.mkdir(this.processRoot, { recursive: true, mode: 0o700 });
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: this.processRoot,
      env: safeEnvironment(),
      stderr: "pipe",
      maxBufferSize: 2 * 1024 * 1024,
    });
    const client = new Client(
      { name: "osChat", version: "0.1" },
      { enforceStrictCapabilities: true, listMaxPages: 16 },
    );
    try {
      await client.connect(transport);
      return await run(client);
    } finally {
      await client.close().catch(() => transport.close().catch(() => {}));
    }
  }

  async listTools(rawServerId?: unknown) {
    const servers = rawServerId
      ? [await this.server(rawServerId)]
      : (await this.listServers()).filter((server) => server.enabled);
    const output = [];
    for (const server of servers) {
      const tools = await this.withClient(server, (client) =>
        client.listTools().then((result) => result.tools),
      );
      output.push({
        server: { id: server.id, name: server.name },
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          readOnly: tool.annotations?.readOnlyHint === true,
        })),
      });
    }
    return boundedJson(output);
  }

  async callReadOnlyTool(
    rawServerId: unknown,
    rawName: unknown,
    rawArguments: unknown,
  ) {
    const server = await this.server(rawServerId);
    const name = cleanLine(rawName, "MCP tool name", 200);
    if (
      rawArguments !== undefined &&
      (typeof rawArguments !== "object" ||
        rawArguments === null ||
        Array.isArray(rawArguments))
    )
      throw new Error("MCP tool arguments must be an object");
    const argumentsValue = assertSafeExternalPayload(
      rawArguments || {},
    ) as Record<string, unknown>;
    return this.withClient(server, async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error("That MCP tool is not available");
      if (tool.annotations?.readOnlyHint !== true)
        throw new Error(
          "osChat blocks MCP tools that are not explicitly marked read-only",
        );
      const result = await client.callTool({
        name,
        arguments: argumentsValue,
      });
      return boundedJson({
        server: server.name,
        tool: name,
        untrusted: true,
        isError: result.isError === true,
        content: result.content,
        structuredContent: result.structuredContent,
      });
    });
  }
}
