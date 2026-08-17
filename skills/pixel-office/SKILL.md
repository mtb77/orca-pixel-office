---
name: pixel-office
description: Start, stop, inspect, or open the Pixel Agents office for all agents managed by the current Orca workspace.
---

# Pixel Office

Manage and inspect the Pixel Agents office projection for all Orca-managed agents across the current workspace.

## Workflow

### 1. Start or Reuse the Office

Start the in-process runtime and obtain an authenticated local office URL:

```javascript
import { PluginRuntime } from './dist/src/index.js';

const office = new PluginRuntime();
const privateOfficeUrl = await office.open();
```

- **Idempotent**: `PluginRuntime.open()` lazily starts the managed Pixel Agents child process (`dist/stream-runtime.js`) and connects the Orca event bridge (`src/provider.ts`). Repeated or concurrent calls attach to the same running instance and return the same pending or resolved URL.
- **Local Bind**: Defaults to host `127.0.0.1` and an ephemeral port (`port: 0`).

### 2. Open in Orca Browser Tab

Hand `privateOfficeUrl` directly to the Orca browser tab.

> **CRITICAL SECURITY RULE**: Never print, log, or persist the authenticated URL or bearer token to stdout, stderr, logs, or disk. The token is generated per runtime start, held only in memory, passed to the child process over Node IPC, and redacted from error messages.

### 3. Stop the Office

Tear down the runtime explicitly or allow automatic idle cleanup:

- **Explicit Stop**: Call `await office.stop()` to immediately terminate the managed child process and bridge.
- **Automatic Idle Teardown**: The runtime self-stops approximately 10 minutes (`shutdownGraceMs: 600000`) after the last office client disconnects. Connecting a client during the grace period cancels the pending shutdown.

### 4. Inspect Projection and Bounded Status

Report bounded status for projected agents:
- **Room**: Grouped one room per repository (`folderName` / repo name).
- **Agent Display Name**: Formatted as `agentType + branch` (e.g., `Claude / main`, `Codex / feat/41024`, or `Antigravity / fix/123`).

To inspect live agent projection without opening a browser:

```sh
bun run build
bun run live-verify
```

`scripts/live-verify.ts` boots the runtime, connects a local WebSocket client, lists all projected agents with their `folderName` and `displayName` (token redacted), and shuts down cleanly.

## Diagnosing Runtime Failures

The runtime locates the Pixel Agents server via `findPixelAgentsRuntime` (checking `vendor/pixel-agents` first, then sibling `../pixel-agents-orca`). It distinguishes two failure modes:

1. **Runtime Missing Entirely**:
   - *Error*: `Pixel Agents runtime is missing: expected <root>/vendor/pixel-agents or <root>/../pixel-agents-orca.`
   - *Cause*: Neither the bundled vendor directory nor the sibling development checkout exists.
   - *Fix*: Provide the Pixel Agents fork at `vendor/pixel-agents` or `../pixel-agents-orca`.

2. **Runtime Present but Unbuilt**:
   - *Error*: `Pixel Agents is present but unbuilt: ...; missing dist/stream-runtime.js and/or dist/webview/index.html.`
   - *Cause*: The runtime checkout directory exists, but required build artifacts are missing.
   - *Fix*: Build the Pixel Agents checkout so both `dist/stream-runtime.js` and `dist/webview/index.html` exist.

## Permanent Architectural Limits

These behaviors are permanent architectural decisions (see `docs/adr/0001-polling-only-no-orca-changes.md` and `docs/event-surface-spike.md`), not bugs or temporary gaps:

- **Snapshot Projection**: The bridge reconstructs state by polling `orca worktree ps --json` (1s interval) and `orca terminal list --json` (5s interval). Tools executing faster than the polling interval can be missed, and tool start/end boundaries and completion statuses are coarse approximations.
- **No Approval or Input-Wait States**: The office never displays `permissionRequest` or `awaitingInput`. Turn completion renders as "Done" (`turnEnd`). Orca exposes no generic CLI surface for approval states, and Orca remains unmodified per ADR 0001. Do not attempt to infer input-wait states from terminal text or idle heuristics.
- **Connected-Client Gating**: Polling runs only while at least one office client is connected (`clients > 0`). When zero clients are connected, polling stops completely; the first connecting client receives a fresh cold snapshot.
- **Privacy Boundary**: Never parse terminal output, terminal previews, prompts, tool input, or assistant text. The normalizer (`src/normalizer.ts`) strictly allowlists only structural metadata (identifiers, repo placement, agent state, tool names, and timestamps).
