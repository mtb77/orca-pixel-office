# Orca Pixel Office

Projects Orca-managed agents into one Pixel Agents office room per repository. The dependency-free TypeScript bridge uses Orca's public JSON CLI snapshots; it deliberately never reads terminal output, prompts, tool input, previews, or assistant messages.

## Install

Node.js 20 or newer is required. Start the published package without a permanent install:

```sh
npx orca-pixel-office
```

The command prints the private local office URL once and stays alive while the office is running. Open that URL in a browser. It contains the ephemeral bearer token, so do not redirect the command output to a file or share the URL.

Press Ctrl-C to stop the office. SIGINT and SIGTERM both trigger a clean `PluginRuntime.stop()` before the command exits.

For development from this repository:

```sh
bun install
bun run build
```

## Start and open the office

`PluginRuntime.open()` lazily starts the managed Pixel Agents process tree and returns the authenticated URL that the Orca integration should hand directly to its browser tab. Repeated calls attach to the same in-process runtime and return the same pending or resolved URL.

```js
import { PluginRuntime } from './dist/src/index.js';

const office = new PluginRuntime();
const privateOfficeUrl = await office.open();
// Hand privateOfficeUrl directly to the Orca browser tab. Do not log it.
```

The bearer token is generated for each server start, retained only in memory, and passed to the child runtime over Node IPC. Child stdout and stderr are not forwarded because authenticated URLs must never enter logs.

## Stop the office

`stop()` tears down the managed process immediately. The runtime also schedules the same teardown ten minutes after the child reports that its last office client disconnected; a reconnect during the grace period cancels shutdown.

```js
await office.stop();
```

## Configuration

Pass options to `PluginRuntime` when embedding it:

| Option | Default | Purpose |
| --- | --- | --- |
| `host` | `127.0.0.1` | Local bind address handed to the Pixel Agents child runtime. |
| `port` | `0` | Requested port; zero lets the operating system choose an ephemeral port. |
| `shutdownGraceMs` | `600000` | Delay after the last office client disconnects before teardown. |
| `packageRoot` | inferred package root | Override only for tests or a nonstandard installation layout. |

Keep the default loopback bind unless remote access has been deliberately secured.

## Runtime lookup

The runtime prefers `vendor/pixel-agents/`, then falls back to the sibling development checkout at `../pixel-agents-orca`. A usable build must contain both `dist/stream-runtime.js` and `dist/webview/index.html`. The runtime entry is the fork-owned generic composition host: it receives the token, bind configuration, and bridge module path over Node IPC and reports readiness and office-client counts over the same channel. The bridge module must export a named, zero-argument `createStreamProvider()` factory. The ordinary `dist/cli.js` is intentionally not used because it owns a different token lifecycle and cannot compose the plugin's stream provider.

## Scripts

### `npm run prepack`

Builds this package and the sibling `../pixel-agents-orca` checkout, then recreates the ignored `vendor/pixel-agents/` publish artifact. The artifact contains only `dist/stream-runtime.js`, the complete `dist/webview/`, a small CommonJS package boundary required by Node, and the fork's upstream MIT `LICENSE`. The runtime's Fastify dependencies are declared as this package's production dependencies and installed normally by npm; `node_modules` is not vendored.

Release machines must have the sibling fork checked out with its dependencies installed. The script does not modify the fork's source.

### `npm run verify:packed -- <tarball>`

Installs a packed tarball into a clean temporary directory, launches its CLI with the current plain Node executable, verifies authenticated and unauthenticated HTTP responses, sends SIGTERM, and confirms a clean exit. The bearer token remains in process memory and is redacted from output; the temporary installation is removed afterward.

### `bun run live-verify`

Starts the runtime, connects one office client, and prints every agent the bridge projects with its room and display name, then shuts the runtime down. Use it to check the projection against real Orca agents after changing the collector, reconciler, or labels.

```sh
bun run build
bun run live-verify
```

Prerequisites: a built Pixel Agents runtime resolvable per Runtime lookup, and a running Orca app with at least one agent. The script prints no bearer token.

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

Milestone 1 (bridge core) and the plugin side of Milestone 3 are implemented. Milestone 2 and the fork-owned runtime composition entry live in the Pixel Agents fork. The read-only Orca event-surface spike behind these decisions is documented in [`docs/event-surface-spike.md`](docs/event-surface-spike.md).

Product and architecture decisions are recorded in [`GLOSSARY.md`](GLOSSARY.md), [`docs/adr/`](docs/adr/), and [`docs/implementation-plan.md`](docs/implementation-plan.md). Polling is the permanent architecture; Orca itself is never modified (ADR 0001).

## Distribution

The public npm package is named `orca-pixel-office`; nothing has been published yet. Its explicit package allowlist includes the compiled bridge/runtime, CLI entry, README, and the publish-time Pixel Agents bundle. Source files, tests, repository metadata, and scratch output are excluded.

`npm pack` and `npm publish --dry-run` run `prepack`, which builds the sibling Pixel Agents fork and recreates `vendor/pixel-agents/`. The tarball therefore contains its required server entry and webview without committing generated assets to Git. The fork runtime's Fastify production dependencies are installed through the package's normal npm dependency graph rather than copied into `vendor/`.

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
