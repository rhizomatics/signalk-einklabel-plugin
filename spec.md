# Summary

A SignalK plugin, in typescript, that renders selected SignalK data to an eInk Electronic Shelf Label.

# Features

* Native Typescript
* First version only creates a tide clock on a Zhunyco BLE ESL using the signalk-tides plugin API, but is capable of supporting other data sources, templates and devices in future
* Pluggable vendor support
  * Initially for Zhsunyco BLE devices, based on the working Python code in `examples/device_driver`
  * Metadata for devices, identified by PID, for dimensions and colour count
* BLE scan to find supported devices and populate a drop-down
* Ability to register 1 or more devices, and select a template, data source and update frequency plus a friendly name for device
* Data source will be
  - SignalK paths
  - SignalK API query, including APIs provided by plugins
    - SVG fields will map to the JSON response using jq style paths and support array values
      - For example, the SVG template should be able to show the next 3 tide extremes, such as the High Water and Low Water times
* Ability to create layout design templates
    * Templates will be SVG files, using Handlebars to populate and then rendered to bitmaps
    * Templates can be uploaded via the SignalK plugin config screen
    * Each template can be assigned to 1 or more devices
  * Initial layout should be for tides
    * Since there is not yet a Tides API in SignalK, this will use the custom API described at https://github.com/openwatersio/signalk-tides
    * Display values
      - next time and height of high and low water
      - nearest tidal station
      - neaps or springs status (e.g. "Springs +1","Neaps -2") if available
      - time the data last refreshed in SignalK
      - time the ESL last repainted 
      - timezone being used. 
    * Times should appear as the local zone, e.g. BST for UK summer rather than UTC.
    * Example image at `examples/tide-layout`
* Scheduled repaint of device screens, including using a template to render an image to send to device
* SignalK path per device, using the friendly name, with a value for last repaint time and error/success status
* A basic local CLI to test scan and device paint outside of SignalK context, using dummy data
