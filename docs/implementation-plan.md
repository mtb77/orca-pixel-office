# Implementation plan

Date: 2026-08-17
Basis: docs/event-surface-spike.md, GLOSSARY.md, ADR 0001, ADR 0002.
All product decisions below were grilled and recorded; do not reopen them
silently.

## Decision summary

| Area | Decision |
| --- | --- |
| Poll cadence | `worktree ps` every 1s, `terminal list` every 5s, with jitter; configurable |
| Polling gate | Poll only while at least one office client is connected; cold snapshot on first connect |
| Visibility | All Orca-projected agents, including remote hosts and folder workspaces; remote/unknown host gets a visual marker |
| Naming | Agent display name is `agentType + branch`; never terminal titles or payload text |
| Grouping | One room per repo; agents from all of a repo's worktrees share it |
| Staleness | Degrade to idle/unknown after ~5 min without updates; `sessionEnd` only on terminal incarnation disappearance |
| Restarts | No identity persistence; fresh snapshot and identities after bridge or Orca restarts |
| Tool presentation | Canonical-name mapping in the plugin; unknown tools show raw name with generic animation |
| Lifecycle | Lazy start on first office open; ephemeral bearer token per start; shutdown ~10 min after last client disconnects; explicit stop command |
| Architecture horizon | Polling is permanent; Orca is never modified (ADR 0001); never emit `permissionRequest` or `awaitingInput` |
| Distribution | Public npm package `orca-pixel-office`, Pixel Agents fork bundled at publish time (ADR 0002) |

## Milestone 1: bridge core (this repository)

1. Snapshot collector: spawn `orca worktree ps --json` (1s) and
   `orca terminal list --json` (5s) with jitter; pause completely at zero
   office clients; resume on first client with a full snapshot.
2. Allowlisted normalizer: copy only identifiers, placement, state, tool name,
   timestamps, and the interruption flag. Prompts, tool inputs, previews, and
   assistant text must never cross this boundary, appear in logs, or reach
   error messages.
3. Reconciler / edge detector: diff snapshots by `runtimeId + paneKey`,
   guarded by terminal `incarnationId`; preserve unknown state values and
   degrade them to idle/unknown.
4. Event mapping (from the spike, unchanged): stable new identity emits
   `sessionStart`; recognized tool change while `working` emits coarse
   `toolStart`/`toolEnd`; leaving `working` emits `turnEnd` (never
   `awaitingInput`); child pane with a real parent key emits
   `subagentStart`/`subagentEnd`; terminal incarnation disappearance emits
   `sessionEnd`.
5. Canonical tool mapper: per-harness table mapping raw tool names to the
   office vocabulary (for example Codex `shell` to `Bash`, `apply_patch` to
   `Edit`); unmapped names pass through raw.
6. Worker enrichment: query orchestration worker metadata only while active
   Dispatches exist; join by terminal/pane identity; enrichment only, never a
   second inventory.

## Milestone 2: Pixel Agents fork seam (../pixel-agents-orca)

1. Add the minimal `StreamProvider` interface beside `HookProvider` as
   anticipated by the existing TODO in `core/src/provider.ts`: kind, id,
   displayName, protocolVersion, `start(emit)` returning an async disposer,
   plus a `readingTools` set and a name-only `formatToolStatus`.
2. Register stream-provider lifecycle at the server boundary; on client
   connect start the provider, on last disconnect dispose it (this is the
   polling gate).
3. Keep Claude-only checks in `server/src/cli.ts` and
   `server/src/clientMessageHandler.ts` Claude-only; the Orca stream must not
   enter heuristic or transcript-fallback paths.
4. Verify the server and webview build and run under plain Node (ADR 0002).

## Milestone 3: plugin runtime and UX

1. Lazy start: opening the office starts the Pixel Agents server plus bridge
   as one managed process tree if not running; the action is idempotent.
2. Ephemeral bearer token per server start, held in memory, injected into the
   URL handed to the Orca browser tab; never persisted, never logged.
3. Shutdown: exit ~10 min after the last office client disconnects; provide an
   explicit stop command for immediate teardown.
4. Runtime lookup: prefer `vendor/pixel-agents/` (installed package), fall
   back to `../pixel-agents-orca` (dev checkout); fail with a clear message
   naming what is missing or unbuilt.
5. Bind `127.0.0.1` by default.

## Milestone 4: packaging and release

1. `package.json` with `bin` entry so `npx orca-pixel-office` starts the
   runtime; `prepack` builds the sibling fork into `vendor/pixel-agents/`
   including the upstream MIT `LICENSE`.
2. Confirm no Bun-only APIs in shipped code; CI or a script runs the packed
   tarball under plain Node.
3. `npm publish --dry-run` review before the first real publish.
4. Document install, start, stop, and configuration in the README in the same
   change.

## Acceptance checklist (adapted from the spike validation gates)

- Working, turn-done, and closed sessions render correctly for Claude, Codex,
  and Antigravity from live snapshots.
- During a permission wait the office shows plain working/idle without
  fabricating a waiting state (ADR 0001 makes this permanent behavior, not a
  gap to close).
- One harness-native subagent and one Orca-supervised worker appear correctly;
  a remote worker, if available, shows the remote marker.
- Duplicate/idempotent events are accepted by the office without visual
  glitches; reconnect replaces the snapshot without replayed history.
- Bridge logs and error paths never contain previews, prompts, tool input,
  assistant text, or tokenized office URLs.
- A stale agent degrades to idle/unknown after ~5 min and disappears only when
  its terminal incarnation does.
- `npx` install on a machine without Bun starts the office end to end.
