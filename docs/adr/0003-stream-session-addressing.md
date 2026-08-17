# ADR 0003: Stream session addressing and display metadata

Date: 2026-08-17
Status: Accepted
Context: Milestone 3 (`docs/implementation-plan.md`), open question recorded in
the session handoff.

## Context

Milestone 1 (bridge) and Milestone 2 (fork seam) were built independently and
disagree on addressing.

- The fork's seam passes a bare event: `StreamProvider.start(emit: (event: AgentEvent) => void)`.
  `AgentEvent` carries no session address, so the server cannot route an event
  to an agent.
- The bridge already emits an envelope `{ sessionId, event }` and exposes
  `getSessionMeta(sessionId)`, which nothing consumes.

Separately, the office needs display metadata the bridge owns: the Room (one
per repo, see `GLOSSARY.md`), the Agent display name (`agentType + branch`),
and the remote marker. None of it can be derived inside the fork, because the
fork knows nothing about Orca.

Relevant existing facts in the fork:

- `HookProvider.normalizeHookEvent(raw)` already returns `{ sessionId, event }`.
  Addressed-event-plus-session-id is therefore the established shape on the
  hook path, and `SessionRouter` maps `sessionId -> agentId`.
- The office groups characters into office areas by `folderName`
  (`areaMappings[folderName]`, `webview-ui/src/App.tsx`). That is the concrete
  realization of the Room concept; no separate "room" field exists.
- `AgentState.projectDir` is the *Claude transcript* directory
  (`~/.claude/projects/<encoded>/<sessionId>.jsonl`), not a workspace path. It
  must not be repurposed as a room key.
- `HookEventHandler` is Claude/transcript-specific (pending external sessions,
  `pendingClear`, auto-discovery, heuristic timers). Stream sessions must not
  enter it (ADR 0001 rationale, handoff constraint).

## Decision

**1. The seam carries the address, mirroring the hook path.**

`StreamProvider.start` emits an envelope instead of a bare event:

```ts
interface StreamEventEnvelope {
  sessionId: string;
  event: AgentEvent;
}

start(emit: (envelope: StreamEventEnvelope) => void): Promise<() => Promise<void>>;
```

`StreamEventSink` becomes `(providerId: string, sessionId: string, event: AgentEvent) => void`.

`AgentEvent` itself is not changed. Keeping the ten-variant union identical to
upstream is what keeps an eventual upstream contribution small, and the
`{ sessionId, event }` shape is already precedent from `normalizeHookEvent`.

**2. Display metadata is pulled per session, never pushed per event.**

`StreamProvider` gains:

```ts
getSessionMeta?(sessionId: string): StreamSessionMeta | undefined;

interface StreamSessionMeta {
  /** Office area / room grouping key. Maps to AgentState.folderName. */
  folderName?: string;
  /** Character label, e.g. "Claude / feat/41024". */
  displayName?: string;
  /** Short marker for a session running off this machine, e.g. a host id. */
  remoteLabel?: string;
}
```

The fork calls it once, when it first materializes an agent for a session.
Metadata is per-session and stable; pushing it on every event would bloat
`AgentEvent` and drift the union from upstream. `getSessionMeta` is optional
and may return `undefined`: the fork then falls back to the provider's
`displayName`, and never blocks agent creation on missing metadata.

The metadata type is expressed in the *office's* vocabulary (folder, display
name, remote marker), not Orca's (worktree, branch, `hostId`). Translation is
the bridge's job, at the provider boundary.

**3. Stream sessions get their own handler.**

A dedicated stream event handler owns agent creation, event dispatch, and
removal for stream providers. It creates agents with `hooksOnly: true`,
`isExternal: true`, and `providerId` set, with no transcript file, no pending
external-session flow, and no heuristic timers. `HookEventHandler` stays
Claude-only and is not extended.

Where the fork already has provider-agnostic broadcast helpers, reuse them
rather than duplicating the webview message shapes.

**4. The bridge translates at the boundary.**

The bridge keeps its Orca vocabulary internally (`roomId`, `agentType`,
`branch`, `hostId`, `remote`). Its `OrcaBridgeProvider` maps to
`StreamSessionMeta` at the seam:

- `roomId` (repo) -> `folderName`
- `agentType + branch` -> `displayName`
- `hostId` / `remote` -> `remoteLabel`

## Consequences

- The bridge's already-emitted envelope needs no change; only its local copy of
  the provider interface must be re-aligned with the fork's.
- The fork gains one small, generic, upstreamable addition; nothing
  Orca-specific enters it.
- Display name plumbing must not reuse team semantics (`teamName`,
  `agentName`, `isTeammate`) as a shortcut. If no non-team character label
  exists on the wire, adding one is in scope for Milestone 3; abusing the team
  fields is not.
- `permissionRequest` and `awaitingInput` remain unemitted (ADR 0001).
