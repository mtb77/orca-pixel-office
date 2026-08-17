# Orca Pixel Office

Orca plugin for visualizing all Orca-managed agents in a Pixel Agents office.

## Status

This repository currently contains the initial plugin scaffold and integration design. Runtime scripts will be added after the read-only Orca event-surface spike described in [`HANDOFF.md`](../HANDOFF.md).

## Related project

The Pixel Agents integration fork is checked out next to this repository as `../pixel-agents-orca` and tracks `pixel-agents-hq/pixel-agents` through its `upstream` Git remote.

## Intended responsibilities

- Start, stop, and inspect the Pixel Agents runtime.
- Open the authenticated local office URL in an Orca browser tab without logging its bearer token.
- Connect all Orca-managed agent types through one Orca adapter.
- Keep harness-specific behavior out of the plugin whenever Orca already exposes it generically.

## Development

Validate the plugin manifest and structure with:

```bash
python3 /Users/sascha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

No installation or marketplace entry has been created yet.
