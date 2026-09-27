# Frequently Asked Questions

## I can't see my device as a choice on the drop-down list after scan

SignalK plugins lack the ability to self-update after something like a scan, so first time round you may have to close the config and reload it to see this. Subsequently the plugin will remember all scanned devices, and only drop previously seen ones if it goes 24 hours without a positive scan or with failed paint attempts.

Easiest way to solve this is to choose 'All Discovered Devices' in the device configuration, and it will paint any compatible devices it finds on future scans.

## Sometimes values are missing on the display

If the plugin repaints a display at server startup, then the plugin that provides the data may not have started ( or in the case of `derived-data` the plugin that the plugin depends on! ) and unlike Home Assistant, there's no good way of sequencing the start of plugins.

Use the _settle_ time, to impose a minimum wait between the eInk Label plugin being initialized, and it attempting to paint any displays, and increase this value if it's still missing data.

## Times are showing incorrectly

If times are in the wrong timezone, or don't have daylight savings applied correctly,
then check that the server itself (at the Linux level, not SignalK, which doesn't know) is configured for your timezone, assuming of course that you're a coastal sailor. Use `raspi-config` on a Raspberry Pi, or `timedatectl` on a Linux server.

If you're a global cruiser, then use something like [signalk-set-gps-timezone](https://github.com/hoeken/signalk-set-gps-timezone) to set the value in the operating system.

## The ESL signal is too weak from my SignalK server

See [Weak Signal](bluetooth.md#weak-signal).

## Can't edit the text contents of SVG template in VSCode

If you have an SVG viewer extension, this will show the image rather than allowing editing of text. To solve, right click on the file in VSCode _Explorer_ view and choose to edit with _Text Editor_.

## Description is set in InkScape but doesn't render

Check if the text boxes are normal text or flowed text, and correct to normal text.

## My label just shows "CONTENT UNAVAILABLE"

That's the bundled fallback warning, not necessarily an error in this plugin - it means the most recent repaint failed, whatever produced the content (a broken hand-authored template, or a `TemplateProvider` extension like [`@rhizomatics/signalk-einklabel-genai-plugin`](templates.md#genai-rendering) - e.g. its LLM call failing on no network/API access, an invalid API key, or a response that wasn't a renderable SVG, after using up its configured retries). Check the SignalK server logs (debug logging on for this plugin) for the specific error, and if it's a GenAI device, check that plugin's own provider/API key/model settings. This plugin deliberately never leaves old content on screen when a repaint fails - it retries automatically at the next scheduled interval.

## Repaints fail with "Service not available"

If a label connects but every repaint fails a couple of seconds later with `Service not available`, the label itself has most likely got stuck - take its battery out for 10-20 seconds and try again. See [Stuck Labels](bluetooth.md#stuck-labels).

## Bluetooth problems

Choosing an adapter, adapters that stop responding, and Bluetooth starting after SignalK are covered on the [Bluetooth](bluetooth.md) page.
