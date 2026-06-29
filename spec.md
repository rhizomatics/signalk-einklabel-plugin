# Summary

A SignalK plugin, in typescript, that renders selected SignalK data to an eInk Electronic Shelf Label.

# Features

* Native Typescript
* First version only creates a tide clock on a Zhsunyco BLE ESL using the signalk-tides plugin API, but is capable of supporting other data sources, templates and devices in future
* Pluggable vendor support
  * Initially for Zhsunyco BLE devices, based on the working Python code in `examples/device_driver`
  * Metadata for devices, identified by PID, for dimensions and colour count
  * Additional vendors are added by a separate npm package implementing `VendorDriver` and calling the exported `registerVendorDriver` explicitly - no scanning of installed packages. In the SignalK runtime the extension calls it from its own plugin `start()`; the CLI loads it via `esl-cli --require <module>`. Extension packages should declare this package as a `peerDependency` so npm resolves a single shared registry instance
  * The config schema's vendor enum and the BLE-scan vendor list are both read live from the registry at the point of use (schema build, scan handler) rather than cached, so a newly-registered extension vendor shows up next time the config panel is opened or Scan is pressed - no extra refresh mechanism needed
* BLE scan: the plugin runs a short scan on start (toggleable) and reports each discovered device via the plugin status line for the user to copy the address from - matches the plain-JSON-Schema-form convention already used by signalk-bluetti-plugin (no custom config-UI widget, no live-populated dropdown)
  - One shared discovery window across all registered vendor drivers, not one per driver: `VendorDriver.scan(adapter)` takes an already-discovering (or already-stopped) `Adapter` and just enumerates+identifies its own matches, rather than owning its own discovery lifecycle - `bleDiscovery.ts`'s `withDiscovery(durationMs, fn)` opens the one `createBluetooth()`/discovery window and hands `fn` the adapter, shared by `plugin.ts`'s startup scan and the CLI's `scan` command
  - The device picker (`deviceOptions()` in `config.ts`) lists any device a driver identified as its vendor, even if the PID isn't in that driver's metadata table yet (labelled "vendor unrecognised PID 0x.... (address)") - previously such devices were silently excluded despite showing up in the scan summary. `DiscoveredDevice.hwVersion` is captured independently of metadata lookup succeeding, so the token stays complete and parseable either way. Selecting an unrecognised-PID device still won't repaint anything (no width/height to render with) until a model-override config field is added - not done yet
* Ability to register 1 or more devices (friendly name + a combined "device model" dropdown encoding vendor+PID, so width/height/colour count are known from config alone and never require a live BLE read to size a render or a rescan after a plugin restart), each assigned a template and a repaint trigger - no separate "Context" config; a template's own `<desc>` bindings fully declare what data they need, discovered fresh from the template on every repaint
* Template fields are bound to data via a flat `key=value,key=value` binding, not a templating engine: each dynamic `<text>` element carries the binding in a `<desc>` child (e.g. `source=resources,resource=tides,path=extremes[0].time,format=local_time`), with `source`/`context` defaulting to `signalk`/`self` and bracket notation for array indices - see `src/render/binding.ts` for the grammar and `src/render/formatters.ts` for the `format=` registry
  - `source=signalk` (default): `context=self` (default) reads via `getSelfPath`; any other `context` is read via `getPath` against that literal SignalK context string, exactly as shown in the Data Browser (e.g. `vessels.urn:mrn:imo:mmsi:232345678`) - nothing to configure
  - `source=resources`: `resource=<name>` reads via `app.resourcesApi.listResources` in the live plugin (in-process, no URL needed) - any Resources API resource type (`tides`, `waypoints`, ...)
  - A `signalk`-sourced numeric value auto-converts to its path's preferred display unit by default, via `GET {signalkApiUrl}/signalk/v1/api/vessels/<context>/meta` (signalk-server's per-vessel metadata endpoint, which resolves the conversion server-side - confirmed there's no in-process equivalent reachable via the plugin API) - `format=raw` opts out. A value with no path of its own (e.g. a resource-sourced one) instead takes an explicit `category=<name>` (e.g. `category=depth`), resolved by composing `{signalkApiUrl}/signalk/v1/unitpreferences/{categories,active,definitions}` client-side (see `src/unitCategories.ts`) - the same resolution signalk-server's REST layer does internally, since that logic isn't exposed to plugins either
  - `signalkApiUrl` is optional - left unset, `resolveSignalkApiUrl` (`src/resolveApiUrl.ts`) probes `SIGNALK_API_URL_OPTIONS` (`http://localhost:3000`, `http://localhost`, `https://localhost`, in that likelihood order - bare npm install vs. container/systemd installs) at the first repaint and caches whichever responds; always the loopback address, since the plugin runs on the same host as the server, so it's reachable regardless of any external reverse proxy. Setting it explicitly skips probing but is still verified the same way. Either way it errors clearly if nothing responds (wrong port) or every probe is rejected (anonymous read access not enabled) - these endpoints must allow anonymous read access, since the plugin has no login flow. A failed resolution is retried on the next repaint rather than cached, in case the server just wasn't ready yet
    - For example, the SVG template should be able to show the next 3 tide extremes, such as the High Water and Low Water times
* Ability to create layout design templates
    * Templates will be SVG files with `<desc>` bindings, rendered to bitmaps
    * No upload UI in v1: the plugin config takes a templates directory path, and the plugin scans it for template files. Revisit upload UI later if multiple/custom templates become common
    * Each template can be assigned to 1 or more devices
  * Initial layout should be for tides
    * Since there is not yet a Tides API in SignalK, this will use the `tides` resource exposed via the Resources API by https://github.com/openwatersio/signalk-tides
    * Display values
      - next time and height of high and low water
      - nearest tidal station
      - neaps or springs status (e.g. "Springs +1","Neaps -2") deferred, possibly permanently, pending upstream signalk-tides support; moon phase is a reasonable interim alternative display field
      - time the data last refreshed in SignalK
      - time the ESL last repainted 
      - timezone being used. 
    * Times should appear using SignalK's configured zone at `environment.time.timezoneRegion`, not the tide station's own `timezone` field, and not a derived abbreviation like "BST" — the displayed time basis must be unambiguous rather than just locally styled.
    * Example image at `examples/tide-layout`
* Scheduled repaint of device screens, including using a template to render an image to send to device
  * Each device picks one repaint trigger: subscribe to changes on a SignalK path (e.g. `environment.tide.state`), or a fixed interval (every N hours, at a configurable minute past the hour - driven by one shared timer, not one per device, mirroring signalk-logbook's hourly-pulse pattern)
  * Before repainting, the assembled raw data fields (paths + providers, before any plugin-injected metadata like a repaint timestamp is added) is hashed and compared against the last-painted hash for that device, persisted in the plugin's data directory (survives a SignalK restart) - if unchanged, the repaint is skipped to avoid draining the label's battery on a no-op refresh
  * A per-device "force repaint" checkbox bypasses the unchanged-data skip for exactly one repaint, then clears itself automatically once that repaint completes
* A basic local CLI to test scan and device paint outside of SignalK context, using dummy data
