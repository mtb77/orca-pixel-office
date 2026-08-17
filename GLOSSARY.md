# Orca Pixel Office

Plugin that projects every Orca-managed agent into a Pixel Agents office via a
plugin-owned polling bridge over public Orca CLI JSON surfaces.

## Language

**Bridge**:
The plugin-owned process that polls Orca CLI snapshots, normalizes them, and emits Pixel Agents events.
_Avoid_: adapter (reserve for the Pixel Agents provider seam), watcher

**Snapshot projection**:
The bridge's model of the world, reconstructed fresh from each poll, never a replayed event history.
_Avoid_: event stream (that is the future Orca subscription, not the MVP)

**Agent**:
One normalized entry from `worktree ps` identified by `runtimeId + paneKey`, guarded by terminal `incarnationId`.
_Avoid_: session (Pixel Agents event vocabulary), worker (Orca orchestration term)

**Worker**:
An Orca-supervised orchestration agent from `worker-list/show`; enrichment for an Agent, never a separate inventory.

**Room**:
The office grouping unit, one per repo; agents from all of a repo's worktrees share it.
_Avoid_: worktree-as-room, host-as-room

**Agent display name**:
`agentType + branch` (e.g. "Claude / feat/41024"). Never derived from terminal titles, previews, prompts, or tool input.

**Canonical tool name**:
The office-known tool vocabulary (Read, Edit, Bash, ...) that the Bridge maps each harness's raw tool names onto; unmapped names pass through raw with the generic working animation.
_Avoid_: tool category (no category field exists on AgentEvent)

**Office client**:
A connected Pixel Agents browser/office view. Polling runs only while at least one is connected.

**Done vs closed**:
`done` means the current turn ended (agent idle, terminal may stay open); closed means the terminal incarnation disappeared. Only closed maps to `sessionEnd`.

## Relationships

- The **Bridge** produces exactly one **Snapshot projection** per poll and diffs it against the previous one.
- An **Agent** belongs to exactly one **Room** (its repo).
- A **Worker** enriches at most one **Agent** (joined by terminal/pane identity).
- **Office clients** gate polling: zero clients means no polling; the first client gets a cold snapshot.

## Example dialogue

> **Dev:** "The **Agent** went `done`. Do I emit `sessionEnd`?"
> **Domain expert:** "No. **Done** is turn-level idle; the terminal is still open. You emit `turnEnd`. `sessionEnd` only fires when the terminal incarnation disappears. That is **closed**."

## Flagged ambiguities

- "session" was used for both an Orca pane lifetime and a Pixel Agents event scope. Resolved: the Orca-side concept is **Agent** (identity `runtimeId + paneKey`), and "session" is only used inside Pixel Agents event names.

## Decided defaults (MVP)

- Poll cadence: `worktree ps` every 1s, `terminal list` every 5s, with jitter; configurable.
- Polling only while at least one office client is connected; cold snapshot on first connect.
- Visibility: all Orca-projected agents, including remote hosts and folder workspaces; remote/unknown-host agents get a visual marker, not exclusion.
- Tool presentation: canonical-name mapping inside the plugin; unknown tools show their raw name with the generic working animation.
- Runtime lifecycle: lazy start on first office open, ephemeral bearer token per start, shutdown after ~10 min grace once the last office client disconnects, explicit stop command available.
- Polling is the permanent architecture: Orca itself will not be changed, so no structured event stream will ever replace the bridge (see ADR 0001).
- Staleness: an Agent without snapshot updates for ~5 min degrades to idle/unknown but is never dropped while its terminal incarnation exists.
- No identity persistence: bridge or Orca restarts produce a fresh snapshot and fresh identities.
- Distribution: public npm package `orca-pixel-office` with the built Pixel Agents fork bundled at publish time into `vendor/pixel-agents/` (see ADR 0002); runtime lookup prefers `vendor/`, falls back to the sibling dev checkout.
