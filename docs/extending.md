# Extending

## Architecture

The primary things managed and provided by the plugin are:

- ESL Vendor
  - Sub-package per vendor
- ESL Device
  - Metadata in the vendor package, using a `pid` or sometimes `pid` combined with `hwid` in the BLE results to pinpoint a model
- SVG Template
- SignalK API base URL
  - Used for automatic unit conversion on `signalk`-sourced numeric values and for resolving an explicit `category=` binding - neither has an in-process equivalent, both go via this server's own REST API
  - Optional: left blank, the plugin probes the probable values in likelihood order at startup - `http://localhost:3000`, `http://localhost`, `https://localhost`. Set it explicitly to skip probing
  - Either way, errors clearly if nothing responds (wrong port) or the probe is rejected (anonymous read access not enabled) - these endpoints must allow anonymous read access, since the plugin has no login flow

## Hardware

Additional vendors and devices can be added by a separate npm package that implements the `VendorDriver` interface and registers itself - there's no scanning of installed packages, registration is always an explicit call by the extension's own code.

- `import esl from '@rhizomatics/signalk-einklabel-plugin'; esl.registerVendorDriver(myDriver)`
- In the SignalK runtime, call this from the extension's own plugin `start()`. In the CLI, load the extension with `esl-cli --require <module> <command>`.
- Declare this package as a regular npm `dependency` in the extension package - **not** a `peerDependency`, per SignalK's own guidance that npm's peer-dependency resolution interacts poorly with the server's plugin install layout - and declare the SignalK-level relationship via `"signalk": { "requires": ["@rhizomatics/signalk-einklabel-plugin"] }` in the extension's own `package.json` instead, so the App Store can install/report it.

## Template Providers

An alternative way to produce a device's content, alongside hand-authored SVG templates, can be added the same way - `esl.registerTemplateProvider({ suffix, listTemplates, render })`, from a separate package's own plugin `start()` (or `esl-cli --require <module>`). This is what [`@rhizomatics/signalk-einklabel-genai-plugin`](templates.md#genai-rendering) is: `listTemplates()` returns the entries it currently offers (already including its own `suffix`, e.g. `"forecast (GenAI)"`) for the "Template" dropdown, and `render(request)` - given the same signalk/resources/label context any SVG template's bindings get - returns a `Bitmap`, exactly as `SvgRenderer.render()` would. Rejecting from `render()` routes the repaint through this plugin's own generic fallback-warning template, the same as a broken hand-authored template failing to render.

`esl.SvgRenderer`, `esl.buildLabel`, `esl.findBindingsInText`, and `esl.substituteBindingsInText` are also exported for a `TemplateProvider` extension to reuse - e.g. to resolve its own `{...}`-style placeholders against the request's context, or to rasterize whatever SVG it produces into the `Bitmap` its `render()` must return.

## CLI Commands

`esl-cli` can also be extended with new subcommands by a `-r/--require`'d package, which is how [`@rhizomatics/signalk-einklabel-genai-plugin`](templates.md#genai-rendering) adds its own `prompt`/`generate` commands for testing prompts without a device. See [Command Line Interface](cli.md) for the built-in commands.
