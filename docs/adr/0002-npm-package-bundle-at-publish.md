# Distribute as an npm package with Pixel Agents bundled at publish time

The plugin is published as the unscoped public npm package `orca-pixel-office`
so third parties can install and start it with `npx orca-pixel-office` (or
`bunx`). The built Pixel Agents fork (server plus webview, MIT-licensed) is not
committed to Git; a `prepack` script builds the sibling checkout
`../pixel-agents-orca` and places the output plus the upstream `LICENSE` into
`vendor/pixel-agents/` inside the npm tarball only. This keeps the repository
clean for development (sibling-checkout workflow, easy upstream merges) while
making the published artifact fully standalone.

## Considered options

- Sibling checkout only: zero packaging cost, but not installable by others.
- Git submodule: reproducible pin, but still requires a local build and adds
  submodule ergonomics without solving distribution.
- Committing built artifacts to Git: standalone clone, but permanent blob
  growth and meaningless diffs.

## Consequences

- The published runtime must run under plain Node; npx users do not have Bun.
  Development uses Bun, but the shipped server and bridge must avoid Bun-only
  APIs.
- Runtime lookup has two modes: `vendor/pixel-agents/` in an installed package,
  falling back to the sibling checkout `../pixel-agents-orca` in development.
- Publishing requires the fork checkout to be present and buildable; releases
  are cut from a machine with both repositories.
