# CLAUDE.md

Guidance for coding agents working in this repository. `AGENTS.md` is a link to this file.

## Commands

```bash
npm ci                    # install; CI runs SignalK's shared plugin-ci matrix, so keep code Node 20 compatible (armv7/Cerbo GX)
npm run build             # tsc -> dist/ (the plugin and the esl-cli both load dist/, not src/)
npm test                  # node:test over src/**/*.test.ts via scripts/run-tests.js, with ts-node
npm run coverage          # same, plus coverage/lcov.info - this is what CI runs
npm run lint              # oxlint
npm run fmt:check         # oxfmt --check (npm run fmt to fix)
npm run docs:templates    # regenerate docs/examples/ template reference blocks
npm run cli -- scan -d 30 # BLE scan from the CLI (needs a Bluetooth adapter)
```

`pre-commit` runs oxlint and oxfmt. Release steps are in `BUILD.md`.

## Testing without hardware

Tests need no Bluetooth adapter or SignalK server. Vendor protocol, compression and encoding
(`src/devices/<vendor>/`), template binding and rendering (`src/render/`) and config are covered by
unit tests next to the code. `gattConnection.ts`, `discoveryCoordinator.ts` and the BLE parts of
`bleBackend.ts` are hardware glue; to exercise them, install into a running SignalK server or use
`npm run cli`.

`src/docs/templateReference.test.ts` fails when a generated block in `docs/examples/` is stale: run
`npm run docs:templates` after changing a bundled template in `templates/`.

## Layout

- `src/plugin.ts` - SignalK plugin lifecycle and config schema; `src/index.ts` - package exports
  (`registerVendorDriver`, `registerTemplateProvider`, `Renderer`, ...) used by extensions such
  as `signalk-einklabel-genai-plugin`.
- `src/devices/` - vendor drivers (`gicisky/`, `zhsunyco/`) behind the `VendorDriver` registry, and
  the shared BLE discovery window.
- `src/render/` - SVG templates with `<desc>` bindings (grammar in `binding.ts`, `format=` registry
  in `formatters.ts`) rendered to device bitmaps.
- `src/cli/` - the `esl-cli` binary.
- `templates/` - bundled SVG templates. `docs/` - user docs; the site in `site/` is built from
  `README.md` and `docs/` by `site/scripts/sync-docs.mjs`, so edit those, not `site/src/`.

`docs/extending.md` describes the extension API as it is now. `docs/design/spec.md` is the original
design spec and is out of date in places (for example, extensions now declare this package as a
regular `dependency`, not a `peerDependency`).
