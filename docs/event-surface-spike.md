# Orca event-surface spike

Date: 2026-08-17
Observed Orca runtime: 1.4.184

## Decision

Use a plugin-owned polling bridge for the first useful release, backed by
`orca worktree ps --json` and reconciled with `orca terminal list --json`.
Treat it as a snapshot projection, not as a lossless event stream. Do not parse
terminal previews or terminal output.

The polling bridge can reliably provide office presence, harness identity,
working versus idle/done state, coarse current-tool activity, worktree/project
placement, host identity, and the parent identifiers Orca already projects.
It cannot reliably reproduce every tool boundary, permission request, or
short-lived lifecycle transition. Those events require a future structured
Orca event subscription rather than additional polling heuristics.

## Scope and method

This was a read-only spike. It inspected command help, Orca's version-matched
orchestration guide, and bounded JSON from these public CLI surfaces:

- `orca terminal list`, `terminal show`, and `terminal wait`
- `orca worktree current` and `worktree ps`
- `orca agent hooks status`
- `orca orchestration worker-list`, `worker-show`, `inbox`, `gate-list`,
  `run-list`, and `task-list`
- `orca status` and `agent-context`

No settings, terminals, or orchestration records were changed as part of the
event-surface observations. Separate supervised, read-only review tasks were
later used to cross-check the findings.

## Surface findings

| Surface | Structured facts available | Suitability |
| --- | --- | --- |
| `terminal list/show` | Stable terminal handle and incarnation, worktree, branch, tab/pane IDs, connection/writability, last output time, title | Reconcile live terminal existence and topology. The preview is unstructured and must be ignored. |
| `terminal wait` | Terminal exit or TUI-idle condition, running/exited status, exit code | Useful for one terminal and supervisory workflows, not a global activity feed. TUI idle is not equivalent to agent waiting for the user. |
| `worktree ps` | Worktree/project/host metadata plus normalized agents with pane key, parent pane key, harness type, state, current/last tool, timestamps, and interruption flag | Primary MVP snapshot. It is the only inspected generic surface that combines agent state with placement and harness identity. |
| `agent hooks status` | Whether Orca-managed hooks are enabled and installed per supported harness | Startup health check only. It exposes no live events. |
| `worker-list/show` | Run, task, dispatch, terminal, launch agent, local/remote placement, process and cleanup state | Authoritative enrichment for Orca-supervised workers. It does not cover ordinary terminals or harness-native subagents. |
| `inbox` | Structured orchestration messages such as questions, completion, escalation, and heartbeats | Useful only inside Orca Runs. It is not a generic source of user prompts or harness permission requests. |
| `gate-list` | Coordinator-created decision gates associated with orchestration tasks | Do not map to agent permission requests; gates are explicit DAG decisions. |

### Internal hook cache is not an integration contract

Orca 1.4.184 also maintains a private
`agent-hooks/last-status.json` file under its application-support directory.
The observed version-2 object stores one raw hook record per pane and includes
event names such as `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, and
`SubagentStop`. No `active-status.json` file existed in the observed runtime.

This file is useful evidence that Orca receives richer hook events, but it is
not a suitable bridge API:

- it is not exposed or documented as a public contract;
- records are last-value snapshots, so rapid intermediate events can be
  overwritten before a watcher reads them;
- records contain raw provider payloads, which can include prompts, tool input,
  and provider session details that Pixel Office must not ingest;
- its path and schema are application implementation details.

Do not watch this file in the MVP. Its existence strengthens the case that a
future Orca event stream can be implemented without adding harness-specific
hooks to this plugin.

### Observed normalized agent projection

Live `worktree ps --json` samples included Claude, Codex, and Antigravity in the
same schema. Relevant fields were:

```text
worktreeId, repoId, hostId, path, branch, parentWorktreeId, childWorktreeIds
agents[].paneKey, parentPaneKey, state, agentType, toolName,
stateStartedAt, updatedAt, interrupted
```

Observed agent states were `working` and `done`; observed worktree summary
states were `working`, `active`, and `inactive`. These observations do not prove
that the state enum is closed. The adapter must preserve unknown values and
degrade them to an idle/unknown visual state instead of rejecting a snapshot.

The raw projection can also contain prompts, tool inputs, and last assistant
messages. The bridge must use an explicit allowlist and must not forward or log
those content fields. Pixel Office needs activity metadata, not conversation or
tool payloads.

## Observable event model

| Desired semantic | MVP observation | Confidence and limitation |
| --- | --- | --- |
| Session created | A new agent `paneKey` appears in `worktree ps`; terminal incarnation provides reconciliation | High after one stable poll. A session shorter than the poll interval can be missed. |
| Session closed | Previously known pane disappears and its terminal is absent/disconnected | Medium. `worktree ps` may retain a `done` agent while its terminal remains open, so done and closed are different. |
| Working | Agent state is `working` | High for hook-supported harnesses. |
| Idle / turn complete | Agent leaves `working`, commonly to `done` | Medium. `done` means the current turn ended, not that the terminal/session closed. |
| Waiting for user input | No dedicated generic field was observed | Not reliably observable. Do not infer it from TUI idle or terminal text. |
| Waiting for approval | Harness hooks receive permission events, but no inspected generic JSON surface exposes a distinct permission state/event | Not reliably observable through polling. Orchestration questions and gates are different concepts. |
| Tool start/end | `toolName`, state, and update timestamps change in the snapshot | Coarse only. Polling can miss fast tools and cannot prove exact completion or failure. |
| Tool category | Map known tool names to read/write/command/browser, with unknown fallback | Medium and harness-dependent. Never inspect `toolInput` to classify activity. |
| Harness-native subagent | `parentPaneKey` is present when Orca projects the relationship | Medium until exercised across each harness. Absence must not be guessed from titles. |
| Orca-supervised worker | `worker-list/show` supplies task/dispatch/run and terminal identity | High for supervised workers. Join to the agent snapshot by terminal/pane identity. |
| Worktree/project | Worktree IDs, repo/project IDs, path, and branch | High. |
| Remote host | `hostId`/platform in worktree summaries and worker placement for federated dispatches | High when supplied; folder workspaces may omit host/platform and need an unknown/local presentation. |

## Minimum viable bridge

```text
Orca CLI JSON snapshots
  -> snapshot collector
  -> allowlisted normalizer
  -> state reconciler / edge detector
  -> generic Pixel Agents provider
  -> office clients
```

The bridge should run beside the Pixel Agents server under plugin lifecycle
management and bind locally by default. A single collector should:

1. Poll `worktree ps --json` at a modest interval with jitter.
2. Poll `terminal list --json` less frequently and after inconsistencies to
   reconcile terminal incarnation and closure.
3. Query orchestration worker metadata only when active Dispatches exist, and
   use it as enrichment rather than the primary inventory.
4. Normalize only identifiers, placement, state, tool name/category, and
   timestamps into an in-memory snapshot.
5. Diff snapshots by `runtimeId + paneKey`, with terminal `incarnationId` used
   to prevent accidental identity reuse.
6. Emit an initial snapshot followed by idempotent state changes. On reconnect,
   replace the snapshot instead of replaying guessed history.

Recommended MVP mappings:

| Reconciled change | Pixel Agents semantic |
| --- | --- |
| Stable new agent identity | `sessionStart` |
| `working` with a changed recognized tool | Coarse `toolStart` |
| Tool changes or agent leaves `working` | Coarse `toolEnd` for a previously emitted start |
| Turn reaches `done`/idle | `turnEnd` without claiming `awaitingInput` |
| New/removed child with a real parent key | `subagentStart` / `subagentEnd` |
| Terminal incarnation disappears | `sessionEnd` |

Do not emit `permissionRequest` in the polling MVP. Do not mark `turnEnd` as
`awaitingInput` unless Orca later exposes that distinction structurally.

## Provider boundary

Keep polling and Orca schemas out of the Pixel Agents fork. Pixel Agents already
defines a ten-variant `AgentEvent` union in `core/src/provider.ts`:
`toolStart`, `toolEnd`, `turnEnd`, `subagentStart`, `subagentEnd`,
`subagentTurnEnd`, `progress`, `permissionRequest`, `sessionStart`, and
`sessionEnd`. Downstream handlers dispatch on this union, so the generic
provider boundary only needs to accept normalized events and own source
lifecycle:

```ts
interface AgentEventProvider {
  readonly kind: 'stream';
  readonly id: string;
  readonly displayName: string;
  readonly protocolVersion: number;
  start(emit: (event: AgentEvent) => void): Promise<() => Promise<void>>;
}
```

The existing `HookProvider` is the closest seam, but it is intentionally coupled
to hook installation, consent, raw-event normalization, tool presentation, and
optional transcript scanning. Making the Orca adapter implement that interface
would add meaningless methods and mix source transport with presentation.
Instead, add the first small `StreamProvider`/`AgentEventProvider` alongside
`HookProvider`, as anticipated by the existing TODO, and register its lifecycle
at the server boundary.

The Orca-specific collector, allowlist, reconciler, tool classifier, and
session identity map belong to this plugin. The Pixel Agents fork should only
add the provider registration/lifecycle seam necessary to receive generic
`AgentEvent` values. Current Claude-only checks in `server/src/cli.ts` and
`server/src/clientMessageHandler.ts` must remain Claude-only or be generalized
deliberately; the Orca stream must not accidentally enter Claude's heuristic
or transcript-fallback paths. This keeps an eventual upstream change small and
prevents Orca CLI details from leaking into the renderer.

## Required Orca follow-up for lossless semantics

> Superseded by [ADR 0001](adr/0001-polling-only-no-orca-changes.md)
> (2026-08-17): Orca will not be changed for this plugin, so this section is
> historical context, not a roadmap. The polling bridge is the permanent
> architecture.

Add a small authenticated local structured subscription only when Pixel Office
must show exact approval, input-wait, tool, and short-lived subagent events. The
minimum event envelope should contain:

```text
eventId, sequence, runtimeId, occurredAt,
worktreeId, terminalHandle, terminalIncarnationId, paneKey, parentPaneKey,
agentType, eventType, state, toolName, outcome
```

It should support an initial snapshot plus a monotonic cursor/resume token.
Payloads, prompts, terminal text, and assistant messages should remain excluded.
Until that surface exists, the polling bridge should expose its semantics as
coarse and eventually consistent rather than manufacturing precision.

## Validation gates before implementation

- Capture bounded snapshots for working, turn-done, permission-wait, and closed
  sessions in Claude, Codex, and Antigravity.
- Exercise one harness-native subagent and one Orca-supervised worker, including
  a remote worker if available.
- Confirm the exact Pixel Agents `AgentEvent` required fields and whether
  duplicate/idempotent events are accepted.
- Decide the polling interval and stale-session timeout with an explicit target
  for missed short-lived tools.
- Confirm that the bridge's logs and error paths never include preview, prompt,
  tool input, assistant text, or authenticated office URLs.
