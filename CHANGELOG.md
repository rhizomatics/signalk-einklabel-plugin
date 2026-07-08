# 0.9.0

## Tide Clock Example

- Rename `third_quarter` to `last_quarter` for moon phase icons in `templates/.assets/lunar_phases` to match Derived Data plugin
- `tide.svg` renamed to `tides\416x240-BWRY.svg`. Original maintained but labelled as deprecated
- Added a simpler _250x128_ version of tide clock for 2.13" labels

## Fixes

- Fix configuration JSON holding older versions of itself as subentries
  and data changes
- Fix most cases of scanned devices not appearing in device dropdown choice

## Improvements

- Repaint state used to track which labels to repaint separately tracks the template
- `nearestColour` algorithm in Zhsunyco driver supports ESLs that only have BWR or BW

## Device Selection

- New 'ALL' as device option, and by default disable initial scan, to optimize support for single devices, so can configure and go without waiting for scan
  - Scan and explicit device selection only required for boats with multiple ESL devices

## Templating

- Now support a directory of templates, where each is named like `416-240-BWRY.svg` to support same functions on different devices.
- Picks the template within the directory that most closely matches the tide clock height/width/colour-set, if not matched then height/width, and then best h/w ratio for nearest width
- `template/assets` is now `template/.assets`

# 0.8.2

- Work around a SignalK bug in Server API where `ResourcesApi.listResources()` merges provider values in undetermined order and ignores specified provider.

# 0.8.1

- A preferred `provider` can now be set for `resources`.
  - The example `tide.svg` sets this to `provider=tides` to ignore other providers, (such as `mareas-ihm`)
- Devices will repaint at startup even if no schedule slot has been missed prior to startup, if the template itself has subsequently changed

# 0.8.0

- New `settle` time, configurable and defaulting to 120 seconds, to wait after plugin startup before attempting to access paths
  - First few minutes of a SignalK server startup can be a mess of plugins missing their dependencies and logging errors.
- Schedule correctly picks up on previous schedule at startup, only repainting if the last scheduled time was overdue
- Path based subscriptions ignore temporarily missing paths, so displays don't waste their tiny batteries on flapping values
- Documentation now has a FAQ plus lots of other ESL/eInk hacking links.

# 0.7.1

- Fix path value retrieved for Image Fields when running in live plugin

# 0.7.0

## Logging

- Standardize all log output to show a `signalk-einklabel-plugin` prefix

## Image Fields

- Include image fields on CLI `fields` command output
- Better logging diagnostics if asset image resolution fails or directory not found
- Replace separate fixed `resources/svg` directory for images with user overridable `templates/assets`
  - Means that the bundled lunar phase icons can be easily replaced without touching the template - use the same file names in `templates/assets/lunar_phases` directory.
  - Added attribution to the Lunar Phases icons

## Build

- Added `pre-commit`, `oxlint` and `oxfmt` for code quality, retired `prettier`

# 0.6.4

- Log improvements for device paint requests
- CLI scan now shows `hwid`, and adds reason for failing to retrieve `battery` level

# 0.6.3

- Improve logging if an image cannot be found in an `assets` directory to match a SignalK path value
- Expose `plugin_version` as a path for the `einklabel` source

# 0.6.2

- Auto default SignalK URL if `-u` or `-e` not passed as CLI arguments
- Default timeout for painting a device screen is now 60 seconds
- Code now prettified, and prettier check added to CI
- Test coverage improved and now reported

# 0.6.1

- Corrected tide lunar phase path from `environment.moonPhase.name` to `environment.moon.phaseName`

# 0.6.0

- Added ability to select images for inclusion in SVG templates based on SignalK path value
  - Pass a directory of assets, and it will pick the SVG file matching the SignalK value
  - Matching will cope with "Waning Gibbous" -> `waning_gibbous.svg`
  - If no match, image will be blank
- New image selection used to add lunar phase to tide clock example
  - Requires a source for `environment.moon.phaseName`, for example the `dervived-data` plugin
- New `resources` directory for composable SVG assets

# 0.5.1

- Work around `resvg-wasm` font limitations by overriding generic font family with matching font name prior to rendering

# 0.5.0

## Font Handling

- Update set of built-in fonts for consistent Roboto monospace and serif
- Update `tide.svg` template to use explicit font names to work around `resvg-wasm` limitations

## Offline Design

- Offline template development now possible using example data,
  - Pass `-e` or `--example-data` as a CLI argument, pointing to a set of example JSON files
  - Examples of example data provided in plugin and at https://github.com/rhizomatics/signalk-einklabel-plugin/blob/main/examples
  - Works with `render`,`paint`,`field` and `fields`

# 0.4.7

- Fix node-ble imports

# 0.4.6

- Correct `node-ble` dependency to `@naugehyde/node-ble`

# 0.4.5

- Updated `tide.svg` layout
- Added SignalK standard Github Actions workflow

# 0.4.4

- Update `node-ble` to new packaging

# 0.4.3

- Fixed datetime values when running from plugin were blank while CLI was fine
- Added an example Resources API output from signalk-tides plugin
- Relaid out the example tide clock, adding the tidal range (LAT to HAT) and the source of tide data
- Alternative source of time zone info, `source=einklabel,path=local_zone`

# 0.4.2

- Fix High/Low display for tide clock template
- Fix last repaint time for display being hour out
- Change default name of template directory to 'einklabel/templates'

# 0.4.1

- Packaging fixes

# 0.4.0

- Added `einklabel` as a `source` for template fields, and `repainted` as path
- Added `local_datetime_short` as a datetime format option, for `27 Jun 26 18:05` style output
- Add Last Repainted field to the Tide Clock example

# 0.3.2

- Renamed to signalk-einklabel-plugin
- Added core test suite

# 0.3.1

- Correct name, and include changelog

# 0.3.0

- First published beta release
- Tested publishing Tide Clock on interval to a Zhunyco 3.7" display
