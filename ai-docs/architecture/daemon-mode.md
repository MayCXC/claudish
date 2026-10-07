# Daemon mode

`claudish daemon --port <n>` runs Claude Code's supervisor, `claude daemon run`, as the child of a
`--monitor` proxy on a fixed port, and acts as the supervisor's service manager. The supervisor
hosts Claude Code's background sessions, the ones `claude --bg`, `/bg` and agent view start and
the only ones agent view lists ([agent view](https://code.claude.com/docs/en/agent-view#the-supervisor-process)).
Read this before editing `daemon-command.ts`.

## What `claude daemon run` does, by origin

Read from the `claude daemon` code of Claude Code 2.1.281. Its help documents `run` and the
on-demand default, not the origins. Where a point was also measured, the measurement is given.

- `--origin` is `service`, `transient` or `foreground`; `auto` means `transient`, and a bare
  `claude daemon run` is `foreground`. The parser keeps the LAST `--origin` it sees and falls
  back to `foreground` on a value it does not know, so `supervisorArgv` puts `--origin service`
  after the caller's own options, where none of them can replace it.
- Only a `transient` supervisor, the kind a client starts on demand, exits after an idle grace
  with no client attached. A `service` one stays up.
- The supervisor polls its own binary. When the binary changes or is deleted, a `service`
  supervisor exits with code 70 for its manager to start the new one (measured: a touched copy
  was noticed at the next poll, 60 s after start, and claudish had the new supervisor up 300 ms
  later); every other origin spawns its successor detached and exits. That successor would
  not be claudish's child, so `service` is the only origin a parent can keep across an upgrade.
  A change to an OLDER build is refused and the running one kept.
- SIGINT and SIGTERM start a graceful shutdown; a second signal forces exit 1 with no cleanup.
  SIGHUP is not handled, so its default action kills the supervisor without cleanup.
- With agent view disabled (`CLAUDE_CODE_DISABLE_AGENT_VIEW` or `disableAgentView`) it prints
  why and exits 0. A service supervisor also stops its workers and exits 0 when Claude Code's
  service-recall flag (`tengu_copper_lantern`) is set. Its own unit starts it again after a zero
  exit like any other (`Restart=always`), and a supervisor that keeps exiting runs into the
  unit's start limit.
- One supervisor holds a config directory. A service start asks a running `transient` one to
  yield and adopts its sessions (measured: the transient shut down with `cause=yield`, one live
  session kept its pid under the new supervisor, `bg adopt: adopted=1`). Any other holder makes
  the new supervisor exit 1, with the reason only in its own log, which is why claudish's line
  about the exit names it and points at `claude daemon logs`.
- Two supervisors starting in the same instant race for `daemon.lock`; the loser logs "another
  daemon won the lock race" and exits 1 (measured 2026-10-04, below). The yield handshake runs
  only when the transient already holds the lock as the service one starts.
- A client that finds the control socket refusing reports the daemon down at once and, with no
  installed service unit to kick, spawns `claude daemon run --origin transient`
  itself (`daemonColdStart` `transient`, the default; `ask` holds only an interactive client
  that has not dismissed the install prompt). Every restart of the service supervisor therefore
  has a window of a few hundred milliseconds in which a client can start a transient one.

## One signal, through a separate process group

Claude Code starts its own supervisor detached, with stdin ignored, and claudish does the same.
A terminal's Ctrl-C or hangup is delivered to the foreground process group; with the supervisor
in claudish's group it would get the terminal's signal AND the one claudish forwards, and take
the second as a forced shutdown, or be killed outright by SIGHUP. Detached, it gets exactly one
SIGTERM from claudish whatever claudish received. The end-to-end test signals claudish's GROUP,
as a terminal does, and asserts the supervisor saw one SIGTERM; run with `detached: false` it
fails with the terminal's SIGINT recorded as well.

claudish itself has to be the one that waits. `stats-buffer.ts` registers SIGINT and SIGTERM
handlers at module load that flush stats and `process.exit` unless the exit is claimed
(`signal-owner.ts`), and they run before any listener registered later, so without a claim the
daemon's own would never run: measured with a stand-in that took 2 s to stop, claudish exited
2 ms after the SIGTERM, taking the proxy with it while the supervisor was still shutting down.
`daemonCommand` claims the exit (`claimSignalExit`), so those handlers only flush, and exits
once the supervisor has. The end-to-end test's stand-in asks the proxy for `/health` after its
SIGTERM, and gets 0 instead of 200 without the claim.

Detaching also means nothing takes the supervisor down with claudish by default, so claudish
stops it from its `exit` handler whenever it ends without having done so.

## How sessions reach the proxy

The supervisor builds each session's environment from its own, then deletes every base URL
variable (`ANTHROPIC_BASE_URL`, `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL`, and each cloud
provider's endpoint) that the dispatching client did not carry, and keeps a carried one only
when it equals the supervisor's. The docs describe the same from the user's side: a
base URL exported in a shell reaches a background session only in three dispatch cases, and
only when the supervisor was started with the same one
([LLM gateway](https://code.claude.com/docs/en/agent-view#llm-gateway)).

So the `ANTHROPIC_BASE_URL` claudish gives the supervisor reaches no session by itself. It is
there so that a client pointed at the same proxy keeps it on dispatch. The route that reaches
every session is a settings file's `env` block, which each session reads where it runs.
Measured under a claudish-run supervisor whose environment named the proxy:

- With no `env` block, a background session's environment had no `ANTHROPIC_BASE_URL`, and its
  connections went to `api.anthropic.com` (160.79.104.10) with none to the proxy.
- With the block, the same kind of session held its connections to the proxy. One connection
  still went straight to `api.anthropic.com`: Claude Code sends some requests past its base URL,
  whatever launched it.
- `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` works from the same block. Against a capture
  server, a background session's requests carried `x-claude-code-request-class` and
  `x-client-request-id` with it in settings and neither without it ([first-party.md](first-party.md)).

The supervisor keeps a session process started ahead of the next dispatch. When that process is
claimed it reads settings again and picks up a key added since it started, but a key REMOVED
since stays in its environment, so the first dispatch after removing one may still carry it.

## Restarting after an upgrade

A restart waits for the new binary the way Claude Code does when it restarts a supervisor that
npm is reinstalling (2.1.281): every 250 ms for 10 s, then every second up to 120 s while npm's
staging directory for the package (`node_modules/@anthropic-ai/.<name>-*`) was touched in the
last 10 minutes; inside the npm package a file under 64 KiB is npm's stub, not the binary. The
supervisor exits 70 when its binary is deleted as well as when it changes, and npm moves the old
package aside before it writes the new one, so a restart at once could find nothing. Like Claude
Code, claudish polls the path that exited. The one addition is ours: when that path stays
unrunnable, a single fresh `findClaudeBinary()`, in case the install moved. A first start does
not wait: finding nothing there is an installation problem, as for any launch.

## Keeping the supervisor alive

This command is the supervisor's service manager, and the policy it follows is the one Claude
Code writes for the supervisor itself: the systemd unit `claude daemon install` produces, read
from the 2.1.286 binary, where it is the only service definition (`claude daemon install` is
disabled in that version, "the daemon runs on demand"):

```
[Unit]
Description=Claude Daemon
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
ExecStart=<claude> daemon --json-path <path> --log-file <path> --origin service
Restart=always
RestartSec=1
```

So every exit the supervisor takes on its own, zero, 70, a failure or a signal, is followed by
a start one second later (`CLAUDE_CODE_RESTART_POLICY`; `restartPolicy` is the test seam), the
upgrade exit through the reinstall wait above; a supervisor started more than ten times within
sixty seconds is given up on and the command ends with its last code, the unit's failed state.
A stop from here ends the command with the signal's code. claudish runs on more than one
platform and knows no manager's name; the unit is the reference because it is Claude Code's own
statement of how this service is to be kept.

Measured 2026-10-04, the case that made a failure's restart necessary: a binary rewrite made
the service supervisor exit 70 twice, 120 s apart at its 60 s poll; the second restart raced a
transient supervisor a client had started into the ~300 ms between the old process's exit and
the new one taking `daemon.lock`; the transient won, ours exited 1, and the command ended with
it, taking the proxy down for five minutes while every session that depended on it saw
ECONNREFUSED. Started again, a service supervisor finds the transient holding the lock, asks it
to yield and adopts its sessions, the measurement above, so the race settles itself and the
proxy has no reason to follow the supervisor down.

## The MCP server

With `--mcp-port`, the daemon serves claudish's MCP tools over Streamable HTTP at `/mcp` on
127.0.0.1 (`startMcpHttpServer`), one server for every session, which declares
`"claudish": { "type": "http", "url": "http://127.0.0.1:<port>/mcp" }` in place of
`claudish --mcp`. It listens before the supervisor starts, because a session connects to its MCP
servers as it starts, the supervisor's pre-started one included. Measured on Claude Code 2.1.286
against a probe server:

- **The caller's directory comes from its roots.** A stdio server's working directory is its
  session's, since the harness starts it there; a server shared by every session has none to
  lend. Claude Code declares the `roots` capability and answers `roots/list` with the session's
  working directory, asked here on the tool call's own stream, so each call runs in it: the
  `ToolCallContext.workingDirectory` its paths, children and routing rules resolve against. A
  client that declares no roots leaves the daemon's directory.
- **A session ends when its client's standalone stream does.** Claude Code never ends a session
  itself: its bundle carries the SDK's DELETE (`terminateSession`) with no call site, and a
  session that exits drops its streams and sends nothing. The server keeps a session while its
  client holds the GET it opens for server messages, and `SESSION_STREAM_GRACE_MS` after the last
  one ends, 30 s, the SDK client's longest reconnection delay. A client whose session is gone is
  answered 404 with the transport's own `Session not found`, and Claude Code starts another ("MCP
  session expired ... triggering reconnection").
- **What the tools start belongs to the daemon.** Any session lists, reads and cancels the channel
  sessions and team runs any other started; they end on completion, at their own timeout, on a
  cancel, or with the daemon, which stops them all. A client's session ending stops none of them,
  since it says only that the client's stream is gone. Routing proxies are one per working
  directory, each with that directory's project rules.
- **The daemon reaps the panes before it exits.** Channel sessions and team slots are panes
  ([pane-session.md](pane-session.md)). `startMcpHttpServer` installs the pane shutdown hooks
  before any pane exists, as the stdio server does, but without their exit: a signal settles every
  run and session CANCELLED, so their records end, and reaps the panes, while the daemon goes on
  stopping its supervisor. Once the supervisor has stopped, closing the MCP server runs the same
  two steps and waits for them, and only then does the proxy shut and the daemon exit.
- **No parent conversation.** A channel session or team run started over HTTP carries no
  `parentClaudeSessionId`. A stdio server reads it from the session record Claude Code keeps for
  the process that launched the server, else from the server's own `CLAUDE_CODE_SESSION_ID`
  (`parent-session.ts`). No HTTP client launched the daemon, so both would describe whoever
  started it rather than the session calling, and the field is absent rather than wrong
  (`ToolCallContext.parentSession`).
- **No channel frames.** Claude Code takes channel events from a channel server it starts itself
  over stdio, under `--channels`, so over HTTP the capability is not declared and the channel
  tools answer without frames.
- **Long calls.** Claude Code aborts a silent call to an HTTP server after 5 minutes rather than
  stdio's 30 ([mcp-channel.md](mcp-channel.md)); the tools with `heartbeat` refresh that window
  every 10 s. The listener lifts Bun's idle timeout for every MCP request, since a tool call
  streams for as long as it runs and a standalone stream carries nothing for most of its life.
- **Local only.** It binds 127.0.0.1 and checks Host and Origin against its own addresses, as
  the specification asks of a local server
  ([transports, security warning](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning)).
- **Keys from the daemon.** Provider keys come from the daemon's environment, which has no
  per-session counterpart of a stdio server's `env` block or of the `.env` in its directory.

## Exit codes

The supervisor's last code when the start limit ends the command; 1 when no runnable binary was
found, at the first start or after an upgrade; `128 + signum` of the signal claudish received
when it was stopped, as for a launched session (`signalExitCode`, which takes the number from
the OS).
