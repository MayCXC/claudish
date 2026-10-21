/**
 * The MCP tools over Streamable HTTP (`startMcpHttpServer`): one runtime for every
 * client, each tool call run in the directory its client lists as a root, and a
 * session ended once its client's standalone stream has.
 *
 * Driven by the SDK's own client, which, like Claude Code, opens the standalone
 * stream after initializing and sends no DELETE when it closes.
 *
 * The server runs in this process, so the panes its tools start are built from this
 * process's environment. For this file that is the hermetic environment the contract
 * suites give their server child (`serverEnv`): the pane fake as claudish, records and
 * the pane root inside the test's own layout, no keychain, 1Password or catalog.
 *
 * Run: bun test packages/cli/src/mcp-http.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadHooksOnce, resetHookEngineForTests } from "./hooks/index.js";
import { type McpHttpServer, startMcpHttpServer } from "./mcp-server.js";
import { setupSession } from "./team-orchestrator.js";
import {
  FAKE_MODEL,
  MAGMUX_AVAILABLE,
  NO_MAGMUX_MESSAGE,
  paneOrphans,
  serverEnv,
} from "./test-helpers/contract-mcp.js";
import { type TempLayout, makeTempLayout } from "./test-helpers/contract-records.js";

const GRACE_MS = 100;

if (!MAGMUX_AVAILABLE) console.warn(NO_MAGMUX_MESSAGE);

let server: McpHttpServer;
let layout: TempLayout;
let root: string;
const savedEnv = new Map<string, string | undefined>();
const clients: Client[] = [];

/** Set `key` for this file, keeping the value to restore once it is done. */
function setEnv(key: string, value: string | undefined): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
  layout = makeTempLayout("mcphttp");
  root = layout.cwd;
  // Before the server starts: its startup sweep reads the pane root.
  for (const [key, value] of Object.entries(serverEnv(layout))) setEnv(key, value);
  // A conversation of the shell that runs the tests must not reach the records.
  setEnv("CLAUDE_CODE_SESSION_ID", undefined);
  setEnv("CLAUDE_CODE_CHILD_SESSION", undefined);
  // The engine is one per process: another file's must not answer for this server's.
  resetHookEngineForTests();
  server = await startMcpHttpServer(0, { streamGraceMs: GRACE_MS });
});

afterAll(async () => {
  for (const client of clients) await client.close().catch(() => {});
  await server.close();
  resetHookEngineForTests();
  const report = await paneOrphans(layout, 12_000);
  layout.cleanup();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(report).toEqual({ processes: [], files: [] });
});

describe("startMcpHttpServer", () => {
  test("lists claudish's tools to a client", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("team");
    expect(names).toContain("create_session");
    expect(names).toContain("run_prompt");
  });

  test("loads the hook engine under host mode other as it starts", async () => {
    // Mode mcp, which the routing proxies of run_prompt and preflight ask for, loads no
    // user module without stdout isolation. The server's load came first, so it decides.
    expect((await loadHooksOnce({ hostMode: "mcp" })).hostMode).toBe("other");
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

describe.skipIf(!MAGMUX_AVAILABLE)("startMcpHttpServer, sessions on panes", () => {
  test("shares what one client's tools start with every other client", async () => {
    const a = await connect();
    const b = await connect();
    const created = await a.client.callTool({
      name: "create_session",
      arguments: { model: FAKE_MODEL, prompt: "hello" },
    });
    expect(created.isError).toBeFalsy();
    const { session_id: sessionId } = JSON.parse(textOf(created)) as { session_id: string };

    const listed = await b.client.callTool({
      name: "list_sessions",
      arguments: { include_completed: true },
    });
    expect(textOf(listed)).toContain(sessionId);
    const cancelled = await b.client.callTool({
      name: "cancel_session",
      arguments: { session_id: sessionId },
    });
    expect(cancelled.isError).toBeFalsy();
  });

  test("records no parent conversation for a session a client starts", async () => {
    // The daemon's environment names a conversation, as a stdio server's does when
    // Claude Code launches it; here it names whoever started the daemon, never the
    // client calling, so the record must not carry it.
    setEnv("CLAUDE_CODE_SESSION_ID", "daemon-launcher-conversation");
    try {
      const { client } = await connect();
      const created = await client.callTool({
        name: "create_session",
        arguments: { model: FAKE_MODEL, prompt: "hello" },
      });
      expect(created.isError).toBeFalsy();
      const { session_id: sessionId } = JSON.parse(textOf(created)) as { session_id: string };
      const spawn = JSON.parse(
        readFileSync(join(layout.sessionsDir, sessionId, "spawn.json"), "utf8")
      ) as Record<string, unknown>;
      expect(spawn.sessionId).toBe(sessionId);
      expect("parentClaudeSessionId" in spawn).toBe(false);
      await client.callTool({ name: "cancel_session", arguments: { session_id: sessionId } });
    } finally {
      delete process.env.CLAUDE_CODE_SESSION_ID;
    }
  });
});
