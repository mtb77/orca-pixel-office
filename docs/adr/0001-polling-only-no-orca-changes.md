# Polling bridge is the permanent architecture; Orca stays unchanged

The event-surface spike (docs/event-surface-spike.md) proposed a polling bridge
over `orca worktree ps --json` as an MVP and sketched a future structured Orca
event subscription for lossless semantics. We decided (2026-08-17) that Orca
itself will not be modified for this plugin: the polling bridge is the final
architecture, not a stopgap. Building and maintaining a private event API in
Orca for a visualization plugin is not worth the coupling and maintenance cost.

## Consequences

- The office will never show `permissionRequest` or `awaitingInput`; turn-end
  renders as plain "Done". Do not attempt to recover these states through
  terminal-output parsing or hook-cache watching; both were explicitly rejected
  in the spike.
- Tool activity stays coarse: tools shorter than the poll interval (1s) are
  invisible, and tool completion/failure cannot be distinguished.
- The spike's "Required Orca follow-up for lossless semantics" section is
  historical context, not a roadmap.
