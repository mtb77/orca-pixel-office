# Orca Pixel Office

Projects Orca-managed agents into one Pixel Agents office room per repository. Milestone 1 provides a dependency-free TypeScript bridge over Orca's public JSON CLI snapshots; it deliberately never reads terminal output, prompts, tool input, previews, or assistant messages.

## Bridge core

- `src/collector.ts` polls `orca worktree ps --json` and `orca terminal list --json`, with configurable jittered intervals and a connected-client gate.
- `src/normalizer.ts` is the privacy boundary: only explicitly allowlisted identity, placement, activity, and timestamp fields survive.
- `src/reconciler.ts` detects coarse lifecycle edges while terminal incarnation identity prevents pane reuse.
- `src/tools.ts` maps harness-native tool names to office vocabulary.
- `src/provider.ts` exposes the dependency-free, kind-based event-envelope stream provider used by the Pixel Agents integration. Session display metadata stays outside events and is available through `getSessionMeta`; the Milestone 3 seam decides how that metadata reaches the renderer.

The package targets plain Node.js 20 or newer. Bun is used only for development:

```sh
bun install
bun test
bun run build
```

## Status

Milestone 1 (bridge core) is implemented; Milestone 2 (the `StreamProvider` seam) lives in the Pixel Agents fork. Milestone 3 still has to wire the two together, including how a session address and its display metadata reach the seam. The read-only Orca event-surface spike behind these decisions is documented in [`docs/event-surface-spike.md`](docs/event-surface-spike.md).

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
