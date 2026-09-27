# Examples

The plugin comes with ready-made templates for these examples. Pick one as a label's _Template_ in the plugin config, or copy it into your own templates directory as a starting point - see [Templates](../templates.md).

- [Tide Clock](tide-clock.md) - the next few high and low tides, with the moon phase
- [Watch Schedule](watch-schedule.md) - who's on watch now and next

## Bundled Templates

Every bundled template, with its sizes and the data it needs. Each example's page lists the exact labels each size fits and every field it reads.

<!-- BEGIN GENERATED: templates-summary -->
<!-- Generated from the bundled templates by `npm run docs:templates` - do not edit by hand. -->

| Template                     | Sizes                     | Data needed                                                                                                                                                                     |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tide.svg`](tide-clock.md)  | 416×240                   | `tides` resource (provider `tides`), Signal K `environment.moon.phaseName`                                                                                                      |
| [`tides`](tide-clock.md)     | 416×240, 296×128, 250×128 | `tides` resource (provider `tides`), Signal K `environment.moon.phaseName`                                                                                                      |
| [`watch`](watch-schedule.md) | 416×240                   | Signal K `watch.current.endTime`, `watch.current.startTime`, `watch.current.teamName`, `watch.next.endTime`, `watch.next.startTime`, `watch.next.teamName`, `watch.system.name` |

<!-- END GENERATED -->

## Trying Examples Without a Boat

Each template can be rendered to a PNG with the CLI using the bundled example data, with no SignalK server or label needed - see [Test Template Without Updating Label](../cli.md#test-template-without-updating-label).
