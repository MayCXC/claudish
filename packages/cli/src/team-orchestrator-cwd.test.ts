// packages/cli/src/team-orchestrator-cwd.test.ts
/**
 * `TeamRunOptions.cwd`: every slot's pane starts in the directory the run is given, the
 * calling session's working directory when an MCP server answers sessions that work in
 * other directories than its own.
 *
 * The pane fake writes its transcript under the slug of its own realpath cwd
 * (`<CLAUDE_CONFIG_DIR>/projects/<slug>/<uuid>.jsonl`), so where the transcript lands is
 * where the child ran. A completed slot alone proves nothing here: the orchestrator derives
 * the transcript path from the same directory it starts the pane in.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { projectDirNameFor } from "./channel/home-dir.js";
import { readTeamStatus, setupSession, startModels } from "./team-orchestrator.js";
import {
  MAGMUX,
  NO_MAGMUX_MESSAGE,
  type PaneTestEnv,
  finishPaneTest,
  makePaneTestEnv,
  paneRunOptions,
} from "./test-helpers/team-pane.js";

if (!MAGMUX) console.warn(NO_MAGMUX_MESSAGE);

let panes: PaneTestEnv;

beforeEach(() => {
  panes = makePaneTestEnv();
});
afterEach(async () => {
  const report = await finishPaneTest(panes);
  expect(report).toEqual({ processes: [], files: [] });
});

/** The `.jsonl` transcripts Claude Code (here, the fake) wrote for a child started in `dir`. */
function transcriptsFor(dir: string): string[] {
  const projectDir = join(panes.configDir, "projects", projectDirNameFor(realpathSync(dir)));
  return existsSync(projectDir) ? readdirSync(projectDir).filter((f) => f.endsWith(".jsonl")) : [];
}

describe.skipIf(!MAGMUX)("TeamRunOptions.cwd", () => {
  test("starts every slot's pane in the directory the run is given", async () => {
    const callerDir = mkdtempSync(join(panes.tmp, "caller-"));
    const teamDir = join(panes.tmp, "team");
    setupSession(teamDir, ["contract-fake-a", "contract-fake-b"], "answer once and exit");

    const handle = await startModels(teamDir, { ...paneRunOptions(panes), cwd: callerDir });
    await handle.done;

    const states = Object.values(readTeamStatus(teamDir).models).map((m) => m.state);
    expect(states).toEqual(["COMPLETED", "COMPLETED"]);
    expect(transcriptsFor(callerDir)).toHaveLength(2);
    expect(transcriptsFor(process.cwd())).toHaveLength(0);
  }, 30_000);
});
