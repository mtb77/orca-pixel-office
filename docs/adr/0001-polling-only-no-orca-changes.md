# Polling bridge is the permanent architecture; Orca stays unchanged

The event-surface spike (docs/event-surface-spike.md) proposed a polling bridge
over `orca worktree ps --json` as an MVP and sketched a future structured Orca
event subscription for lossless semantics. We decided (2026-08-17) that Orca
itself will not be modified for this plugin: the polling bridge is the final
architecture, not a stopgap. Building and maintaining a private event API in
Orca for a visualization plugin is not worth the coupling and maintenance cost.

## Correction (2026-08-17, same day)

The premise above is factually wrong and must not be relied on again.

This ADR assumed a structured event surface could only exist by modifying Orca.
Orca 1.4.184 already ships one through its plugin API, with no change to Orca
required:

```text
PLUGIN_EVENT_NAMES = ["worktree.created", "worktree.removed", "agent.status.changed"]
agent.status.changed -> { worktreeId, paneKey, state, receivedAt }
```

The decision to keep polling still stands, but for different and weaker reasons
than "Orca will not be changed":

- The payload carries `state` but no tool name, so it cannot produce
  `toolStart`/`toolEnd`. It would complement polling, not replace it.
- `events.subscribe` is only callable by a plugin worker running inside Orca's
  plugin host. ADR 0004 keeps this product outside that host, so the event is
  currently unreachable for us.

Consequently the consequences below still hold in practice, but the first one is
now a product decision rather than a technical impossibility: `permissionRequest`
and `awaitingInput` remain unavailable because no inspected surface exposes them,
not because Orca could never expose anything.

Revisit this if the office ever moves inside the plugin host.

## Consequences

- The office will never show `permissionRequest` or `awaitingInput`; turn-end
  renders as plain "Done". Do not attempt to recover these states through
  terminal-output parsing or hook-cache watching; both were explicitly rejected
  in the spike.
- Tool activity stays coarse: tools shorter than the poll interval (1s) are
  invisible, and tool completion/failure cannot be distinguished.
- The spike's "Required Orca follow-up for lossless semantics" section is
  historical context, not a roadmap.
