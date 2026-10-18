# Design Plans

## Label Support

- More vendors, and more labels for existing vendors
- Ability for people to plug-in vendor support for themselves or as published plugins
- A model override in the plugin config, so a discovered device whose PID isn't in its driver's table yet can be repainted (the CLI's `paint --colours` already does this)
- Neaps or springs status (e.g. "Springs +1", "Neaps -2") on the tide template, pending upstream signalk-tides support
- Alternatives to SVG templates, perhaps [imagespec](https://pypi.org/project/imagespec/) or [signalk-hmi-designer](https://github.com/dirkwa/signalk-hmi-designer)
