# Command Line Interface

To get fast feedback on templates and shelf devices without updating and configuring SignalK, a CLI call `esl-cli` is provided when the module is manually installed (see [Using Outside of SignalK](getting-started.md#using-outside-of-signalk)) that has these commands. Use `--help` to get all the options.

- `vendors` - list supported vendors
- `scan` - report supported devices found from a BLE scan
- `render` - transform an SVG template and data into a PNG
- `paint` - render an SVG template and data to a selected ESL
- `fields` and `field` - see [Debugging Templates](#debugging-templates)

The width, height, vertical offset and colour palette for the device are taken from the internal register of devices, however can be overridden on the command line with `-w/--width`, `--height`, `--voffset` and `--colours`. This could be used to help you choose what size of label to buy, or to get an unsupported label working.

Left unset, both `render` and `paint` default `-w/--width`/`--height` to the template's own declared `width`/`height` (or `viewBox`) - neither command connects to a device just to size the render, since that would mean an extra BLE connect ahead of `paint`'s own, and doing two back-to-back is exactly the kind of churn that trips real BLE hardware.

`paint` also takes `--reframe <mode>`, applied once it has connected and identified the device, for when the rendered image doesn't come out the same size as its actual panel (see [Reframing](templates.md#reframing)):

- `crop` (default) - keeps pixels 1:1, placed from the top-left; a bigger render is truncated to fit, a smaller one leaves the extra panel space blank
- `scale` - stretches the rendered image onto the panel's exact dimensions (independently per axis, not preserving aspect ratio)
- `fixed` - no adjustment; rejects a size mismatch with an error instead

The main SignalK plugin offers the same choice per device (defaulting to `crop` there too) in each device's own config - "If the render doesn't match the panel size".

`paint` has matching options for the other per-label image settings too (see [Other Image Options](templates.md#other-image-options)):

- `--mirror <mode>` - `none` (default), `horizontal`, `vertical`, or `both` (rotate 180°). `render` also takes `--mirror`, to preview the flip as a PNG without a label
- `--no-compress` - send the image uncompressed, to rule compression out if a label won't update
- `--compression-format <format>` - `auto` (default) or `chunked`, to try the experimental compressed format on a Gicisky 4.2" BWR

`esl-cli` can also be extended with new subcommands - see [Extending](extending.md#cli-commands).

( The CLI can also be run from a checked out module, or by opening a terminal shell at `~/.signalk/node_modules/@rhizomatics/signalk-einklabel-plugin`, as `npx esl-cli command --args` )

## Scans from CLI

The command line tools, run from inside the `.signalk` directory, can be used to help troubleshoot

- Scan for longer, in this example 90 seconds
  - `npx esl-cli scan -d 90`
- Scan for all BLE devices, whatever they are
  - `npx esl-cli scan -a`

## Debugging Templates

The `esl-cli` can be used to debug and validate templates quickly:

- `render` - Render templates with SignalK data and write to a local PNG file
- `paint` - Render templates with SignalK data and send to selected ESL device
- `fields` - List the fields in the template, with the source specification and the rendered data value
- `field` - Accept a source specification (outside of any template context) and return the rendered value if available

Use `--help` to get the full set of arguments for any of the commands.

## CLI Examples

### Paint Image Directly

The label address previously discovered via `esl-cli scan`

```bash
npx esl-cli paint -t templates/tides/250x128-BWRY.svg -a FF:FF:92:84:53:93
```

If the label turns out to be a different size than the template (e.g. it's a 250x128 template on a 416x240 panel), it's cropped to fit by default - add `--reframe scale` to stretch it instead:

```bash
npx esl-cli paint -t templates/tides/250x128-BWRY.svg -a FF:FF:92:84:53:93 --reframe scale
```

If a label doesn't update, try sending it uncompressed to see whether compression is the cause:

```bash
npx esl-cli paint -t templates/tides/250x128-BWRY.svg -a FF:FF:92:84:53:93 --no-compress
```

If the image comes out mirrored, try each `--mirror` mode until it looks right, then set the same _Mirror_ option in the label's config:

```bash
npx esl-cli paint -t templates/tides/250x128-BWRY.svg -a FF:FF:92:84:53:93 --mirror horizontal
```

### Test Template Without Updating Label

This will work even if you don't have a label, or even bluetooth. (The `-u` can be left out if your SignalK server running locally on default ports).

```bash
npx esl-cli render -t templates/tides/250x128-BWRY.svg -o example.png -u http://localhost
```

and this version will work even without a running SignalK server, using some pre-packaged example data:

```bash
npx esl-cli render -t templates/tides/250x128-BWRY.svg -o example.png -e examples
```

### List all Fields and Rendered Values

```bash
npx esl-cli fields -t templates/tide.svg -u http://localhost
```

```
id                   spec                                                                                    value
station.name         source=resources,resource=tides,provider=tides,path=station.name                        Tobermory
source.name.         source=resources,resource=tides,provider=tides,path=station.source.name                 TICON-4
last_repaint         source=einklabel,path=repainted,format=local_datetime_short                             30 Jun 26 00:08
extremes.0           source=resources,resource=tides,provider=tides,path=extremes[0].label                   Low
extremes.1           source=resources,resource=tides,provider=tides,path=extremes[1].label                   High
extremes.2           source=resources,resource=tides,provider=tides,path=extremes[2].label                   Low
timezoneRegion       source=einklabel,path=local_zone                                                        BST
lat                  source=resources,resource=tides,provider=tides,path=station.datums.LAT,category=depth   0.2m
hat                  source=resources,resource=tides,provider=tides,path=station.datums.HAT,category=depth   5.2m
extremes.2.level     source=resources,resource=tides,provider=tides,path=extremes[2].level,category=depth    1.1m
extremes.2.time      source=resources,resource=tides,provider=tides,path=extremes[2].time,format=local_time  13:15
extremes.1.level     source=resources,resource=tides,provider=tides,path=extremes[1].level,category=depth    3.8m
extremes.1.time      source=resources,resource=tides,provider=tides,path=extremes[1].time,format=local_time  07:05
extremes.0.time      source=resources,resource=tides,provider=tides,path=extremes[0].time,format=local_time  01:21
extremes.0.time-8    source=resources,resource=tides,provider=tides,path=extremes[0].time,format=day_mon     30 Jun
extremes.0.time-8-5  source=resources,resource=tides,provider=tides,path=extremes[1].time,format=day_mon     30 Jun
extremes.0.time-8-9  source=resources,resource=tides,provider=tides,path=extremes[2].time,format=day_mon     30 Jun
extremes.0.level     source=resources,resource=tides,provider=tides,path=extremes[0].level,category=depth    1.3m
```

## Offline Working

`render` and `paint` need a `--url` argument to point to the SignalK server to retrieve data. If you don't have access to one, you can use `--example-data` or `-e` to point to a directory of example data, which is bundled with the plugin or available in GitHub at [examples](https://github.com/rhizomatics/signalk-einklabel-plugin/tree/main/examples). This also allows you to write templates for resource APIs that aren't available yet.

- `vessels.json` - The standard SignalK vessel paths
- `resources/xxxx.json` - The output of the `xxxx` resources API call
- `categories.json` - SignalK unit categories needed for `category=depth` type formatting

For example, `npx esl-cli fields -t templates/tide.svg -e examples` will show all the field data that will be populated from the example API, vessel and category data in the `examples` local directory.
