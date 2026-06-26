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
* Ability to register 1 or more devices (friendly name + a combined "device model" dropdown encoding vendor+PID, so width/height/colour count are known from config alone and never require a live BLE read to size a render or a rescan after a plugin restart), each assigned a template, a repaint trigger, and 0 or more SignalK paths plus 0 or more API providers as its data context
* The render context for a device is assembled from:
  - 0 or more SignalK paths, read via `getSelfPath` and merged into the context preserving their natural dotted nesting (e.g. `environment.time.timezoneRegion`)
  - 0 or more API providers - any HTTP(S) endpoint returning JSON, whether a built-in SignalK API or a plugin-provided one (e.g. signalk-tides) - merged into the context at the root, or under a configured key to avoid collisions
    - Template fields are bound to data via Handlebars expressions, not a separate path-mapping layer: each dynamic `<text>` element carries the full expression in a `<desc>` child (e.g. `{{formatTime extremes.[0].time ...}}`), evaluated directly against the assembled context object, with bracket notation for array indices
      - For example, the SVG template should be able to show the next 3 tide extremes, such as the High Water and Low Water times
* Ability to create layout design templates
    * Templates will be SVG files, using Handlebars to populate and then rendered to bitmaps
    * No upload UI in v1: the plugin config takes a templates directory path, and the plugin scans it for template files. Revisit upload UI later if multiple/custom templates become common
    * Each template can be assigned to 1 or more devices
  * Initial layout should be for tides
    * Since there is not yet a Tides API in SignalK, this will use the custom API described at https://github.com/openwatersio/signalk-tides
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
  * Before repainting, the assembled raw data context (paths + providers, before any plugin-injected metadata like a repaint timestamp is added) is hashed and compared against the last-painted hash for that device, persisted in the plugin's data directory (survives a SignalK restart) - if unchanged, the repaint is skipped to avoid draining the label's battery on a no-op refresh
  * A per-device "force repaint" checkbox bypasses the unchanged-data skip for exactly one repaint, then clears itself automatically once that repaint completes
* A basic local CLI to test scan and device paint outside of SignalK context, using dummy data
