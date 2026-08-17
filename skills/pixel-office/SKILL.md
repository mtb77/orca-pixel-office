---
name: pixel-office
description: Start, stop, inspect, or open the Pixel Agents office for all agents managed by the current Orca workspace.
---

# Pixel Office

This skill is an implementation placeholder until the Orca event-surface spike is complete.

## Intended workflow

1. Resolve the current Orca worktree and project.
2. Reuse or start the local Pixel Agents runtime bound to `127.0.0.1`.
3. Connect the Orca event bridge.
4. Open the authenticated office URL in an Orca browser tab without printing or persisting the bearer token in logs.
5. Report bounded status information for the runtime and bridge.

Do not parse terminal output when a structured Orca lifecycle event is available.
