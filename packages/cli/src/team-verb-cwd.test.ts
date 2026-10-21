// packages/cli/src/team-verb-cwd.test.ts
/**
 * The team verbs (`status`, `cancel`, `capture`) address a run by `path`, which resolves
 * against the calling session's working directory and stays within it: the directory an
 * MCP server answering sessions in other directories than its own is given per call.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { teamContractVerb } from "./mcp-server.js";
import { setupSession } from "./team-orchestrator.js";

let callerDir: string;

beforeEach(() => {
  callerDir = mkdtempSync(join(tmpdir(), "claudish-team-verb-cwd-"));
});
afterEach(() => {
  rmSync(callerDir, { recursive: true, force: true });
});

type VerbAnswer = { content: Array<{ type: string; text: string }> };

function bodyOf(answer: VerbAnswer): Record<string, unknown> {
  return JSON.parse(answer.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("team verbs in the caller's directory", () => {
  test("status finds a run at a path relative to the caller's directory", async () => {
    setupSession(join(callerDir, "run-1"), ["model-a"], "task");

    const answer = await teamContractVerb("status", { path: "run-1" }, callerDir);

    expect(answer.isError).toBeFalsy();
    expect(Object.keys(bodyOf(answer).models as Record<string, unknown>)).toHaveLength(1);
  });

  test("refuses a path that leaves the caller's directory", async () => {
    const answer = await teamContractVerb("status", { path: "../elsewhere" }, callerDir);

    expect(answer.isError).toBe(true);
    expect((bodyOf(answer).error as { code: string }).code).toBe("invalid_args");
  });
});
