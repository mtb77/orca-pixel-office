# ADR 0004: Deliver the office in a browser window, not an Orca plugin panel

Date: 2026-08-17
Status: Accepted
Supersedes the plugin framing implied by the original `.codex-plugin/plugin.json`
scaffold.

## Context

The office was opened as an Orca browser tab. The natural next question was
whether it should instead be a dockable, toggleable view part inside Orca, which
is what an IDE integration normally looks like.

Orca 1.4.184 does have a plugin API, and it does have panels. Reading the
manifest schema out of the shipped application:

```text
orca-plugin.json
  manifestVersion: 1, id, publisher, name, version, description?, author?,
  repository?, icon?, engines.orca, pluginApi: 1, main?, capabilities[]
  contributes (strict): panels, commands, events, languagePacks,
                        keybindings, vmRecipes, agents
```

`panels` accepts `{ id, title, icon?, entry }`, where `entry` is a
plugin-relative HTML file. On the surface that is exactly the requested feature.

It is not usable for this office. The plugin host renders a panel under a fixed
Content-Security-Policy:

```text
default-src 'none'; connect-src 'none'; script-src 'unsafe-inline';
style-src 'unsafe-inline'; img-src data:; font-src data:;
base-uri 'none'; form-action 'none'
```

and the panel bootstrap states that "plugin panels are documents, never browsing
contexts": navigation is cancelled, `window.open` is nulled, link clicks and form
submits are suppressed.

The consequences are decisive:

- `connect-src 'none'` forbids WebSocket and fetch, so a panel cannot talk to the
  Pixel Agents server at all.
- There is no `frame-src`, and panels are not browsing contexts, so the office
  cannot be embedded in an iframe either.
- Of the plugin host API (`events.subscribe`, `notifications.show`, `secrets.*`,
  `settings.*`, `storage.*`, `terminal.sendText`, `workspace.readContext`) a
  panel may call only `workspace.readContext`, `terminal.sendText` and
  `notifications.show`. `events.subscribe` and `storage.*` are `panel: false`, so
  a plugin worker cannot hand data to its own panel through them.
- `workspace.readContext` returns `{ branch, displayName, terminals[] }` for the
  active worktree only. It exposes no agent state, no tool activity, and nothing
  about other repositories.
- `img-src data:` means sprite atlases could not be loaded at all, only inlined.

So no data path exists that could drive a live office inside a panel. A panel can
render an almost static document about the current worktree, which is not this
product.

A second finding followed from the same schema: `contributes` is `.strict()` and
contains no `skills` key. This repository's `skills/pixel-office/SKILL.md` is a
Claude/Codex skill, not an Orca contribution, and the original
`.codex-plugin/plugin.json` was a Codex/agents manifest that Orca never reads.
With the office staying outside the plugin host, this repository contributes
nothing to Orca's plugin API.

## Decision

Deliver the office as a local web application opened in a browser window, exactly
as it works today: `npx orca-pixel-office` starts the runtime and prints a
loopback URL carrying an ephemeral token.

Do not ship an Orca plugin manifest. `.codex-plugin/plugin.json` (wrong
ecosystem) and `orca-marketplace.json` (nothing to contribute) are both removed
rather than left as decoration.

## Consequences

- No docked pane, no show/hide toggle, and no Orca keybinding. The office
  occupies a browser window.
- No Orca marketplace install path. Distribution is npm plus the documented
  `npx` command (ADR 0002).
- The product surface stays portable: nothing about it depends on running inside
  Orca, so the same office serves any user who can run Node.
- If Orca later relaxes the panel sandbox, this becomes reversible. The specific
  unblocking changes would be a `connect-src` allowance for loopback, a
  worker-to-panel message channel, or `storage.*` with `panel: true`. Until one
  of those exists, a docked office is not expressible on `pluginApi: 1`.
- Revisit this ADR before adding any Orca-specific UI ambition, and re-read the
  shipped schema rather than trusting this snapshot: `manifestVersion` and
  `pluginApi` are both literal `1` today, so the surface is expected to grow.
