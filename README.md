# Orca Pixel Office

Orca plugin for visualizing all Orca-managed agents in a Pixel Agents office.

## Status

This repository currently contains the initial plugin scaffold and integration design. The read-only Orca event-surface spike is documented in [`docs/event-surface-spike.md`](docs/event-surface-spike.md); no runtime bridge has been implemented yet.

Product and architecture decisions are recorded in [`GLOSSARY.md`](GLOSSARY.md), [`docs/adr/`](docs/adr/), and [`docs/implementation-plan.md`](docs/implementation-plan.md). Polling is the permanent architecture; Orca itself is never modified (ADR 0001).

## Distribution

The plugin will be published as the public npm package `orca-pixel-office` with the built Pixel Agents fork bundled into the tarball at publish time (`vendor/pixel-agents/`, MIT license included). Third parties install and start it with `npx orca-pixel-office`. See ADR 0002; nothing has been published yet.

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
