/**
 * The MCP tools over Streamable HTTP (`startMcpHttpServer`): one runtime for every
 * client, each tool call run in the directory its client lists as a root, and a
 * session ended once its client's standalone stream has.
 *
 * Driven by the SDK's own client, which, like Claude Code, opens the standalone
 * stream after initializing and sends no DELETE when it closes.
 *
 * Run: bun test packages/cli/src/mcp-http.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sessionsDirFrom } from "./channel/home-dir.js";
import { type McpHttpServer, startMcpHttpServer } from "./mcp-server.js";
import { setupSession } from "./team-orchestrator.js";

const GRACE_MS = 100;
const FAKE_CLAUDISH = join(
  dirname(fileURLToPath(import.meta.url)),
  "channel",
  "test-helpers",
  "fake-claudish.ts"
);

let server: McpHttpServer;
let root: string;
const clients: Client[] = [];

async function connect(): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client(
    { name: "mcp-http-test", version: "0" },
    { capabilities: { roots: { listChanged: true } } }
  );
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: pathToFileURL(root).href, name: "project" }],
  }));
  const transport = new StreamableHTTPClientTransport(new URL(server.url));
  await client.connect(transport);
  clients.push(client);
  return { client, transport };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

function postToSession(sessionId: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(server.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

beforeAll(async () => {
  server = await startMcpHttpServer(0, { streamGraceMs: GRACE_MS });
  root = mkdtempSync(join(tmpdir(), "claudish-mcp-http-"));
});

afterAll(async () => {
  for (const client of clients) await client.close().catch(() => {});
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("startMcpHttpServer", () => {
  test("lists claudish's tools to a client", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("team");
    expect(names).toContain("create_session");
    expect(names).toContain("run_prompt");
  });

  test("runs a tool call in the directory the client lists as its root", async () => {
    setupSession(join(root, "run-1"), ["model-a"], "task");
    const { client } = await connect();
    // A path relative to the root, and contained to it: from any other directory
    // the call fails, either outside it or with no status.json there.
    const result = await client.callTool({
      name: "team",
      arguments: { mode: "status", path: "run-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(Object.keys(JSON.parse(textOf(result)).models)).toHaveLength(1);
  });

  test("shares what one client's tools start with every other client", async () => {
    const original = process.env.CLAUDISH_BIN;
    process.env.CLAUDISH_BIN = FAKE_CLAUDISH;
    try {
      const a = await connect();
      const b = await connect();
      const created = await a.client.callTool({
        name: "create_session",
        arguments: { model: "ollama@fake-model", prompt: "hello" },
      });
      expect(created.isError).toBeFalsy();
      const { session_id: sessionId } = JSON.parse(textOf(created)) as { session_id: string };

      const listed = await b.client.callTool({
        name: "list_sessions",
        arguments: { include_completed: true },
      });
      expect(textOf(listed)).toContain(sessionId);
      await b.client.callTool({ name: "cancel_session", arguments: { session_id: sessionId } });
    } finally {
      if (original === undefined) delete process.env.CLAUDISH_BIN;
      else process.env.CLAUDISH_BIN = original;
    }
  });

  test("records no parent conversation for a session a client starts", async () => {
    // The daemon's environment names a conversation, as a stdio server's does when
    // Claude Code launches it; here it names whoever started the daemon, never the
    // client calling, so the record must not carry it.
    const saved = {
      CLAUDISH_BIN: process.env.CLAUDISH_BIN,
      CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
      CLAUDE_CODE_CHILD_SESSION: process.env.CLAUDE_CODE_CHILD_SESSION,
    };
    process.env.CLAUDISH_BIN = FAKE_CLAUDISH;
    process.env.CLAUDE_CODE_SESSION_ID = "daemon-launcher-conversation";
    delete process.env.CLAUDE_CODE_CHILD_SESSION;
    try {
      const { client } = await connect();
      const created = await client.callTool({
        name: "create_session",
        arguments: { model: "ollama@fake-model", prompt: "hello" },
      });
      expect(created.isError).toBeFalsy();
      const { session_id: sessionId } = JSON.parse(textOf(created)) as { session_id: string };
      const spawn = JSON.parse(
        readFileSync(join(sessionsDirFrom(process.env), sessionId, "spawn.json"), "utf8")
      ) as Record<string, unknown>;
      expect(spawn.sessionId).toBe(sessionId);
      expect("parentClaudeSessionId" in spawn).toBe(false);
      await client.callTool({ name: "cancel_session", arguments: { session_id: sessionId } });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("keeps a session whose client holds its stream past the grace window", async () => {
    const { client } = await connect();
    await Bun.sleep(GRACE_MS * 3);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });

  test("ends a session whose client left without a DELETE", async () => {
    const { client, transport } = await connect();
    const sessionId = transport.sessionId;
    expect(sessionId).toBeString();
    await client.close();
    await Bun.sleep(GRACE_MS * 3);

    const response = await postToSession(sessionId as string);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32001);
  });

  test("answers a session it does not know 404 with the transport's own error", async () => {
    const response = await postToSession(crypto.randomUUID());
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error).toEqual({ code: -32001, message: "Session not found" });
  });

  test("refuses a new session from a page on another origin", async () => {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "http://attacker.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "page", version: "0" },
        },
      }),
    });
    expect(response.status).toBe(403);
  });
});
