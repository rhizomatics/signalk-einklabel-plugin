# Design Principles

The principles signalk-einklabel-plugin is designed by. They start from the [Rhizomatics HQ policies](https://hq.rhizomatics.org.uk/policies/) that every
product follows. Sections specific to signalk-einklabel-plugin are added here as its design settles, usually through an RFC.

## Scope

signalk-einklabel-plugin: Display SignalK data on eInk electronic shelf labels, with tide clock and watch schedule examples.

It does one job and leaves the rest to the SignalK server and other plugins. Where a feature could live in the
server, another plugin or here, the RFC for it says why it belongs here.

## SignalK alignment

signalk-einklabel-plugin aims to be an exemplary citizen of the SignalK and npm ecosystems ([SignalK alignment](https://hq.rhizomatics.org.uk/policies/signalk-alignment/)):

- Written in TypeScript.
- Works on a rolling 6 months of `signalk-server` releases, declared in `package.json` `engines` and tested in CI
  on the oldest and latest ([SignalK versions](https://hq.rhizomatics.org.uk/policies/signalk_versions/)). Server APIs newer than the oldest
  supported release are only used behind a runtime check.
- Node version is the minimum the oldest supported `signalk-server` declares.
- Released to npm by trusted publishing, staged by CI and made live by a maintainer, with no npm token anywhere.
- Uses the SignalK BLE API and BLE Manager for Bluetooth, which becomes the default as BLE Manager matures.

## How the design changes

- Major changes are planned as RFCs in `docs/developer/design/rfcs/` ([design policy](https://hq.rhizomatics.org.uk/policies/design/)). They're
  listed with every other Rhizomatics product's on the [HQ RFCs page](https://hq.rhizomatics.org.uk/rfcs/).
- Expected work, large and small, is summarised in the roadmap.
- Releases follow the [release policy](https://hq.rhizomatics.org.uk/policies/release/): semantic versions, immutable, built and published by
  GitHub Actions.
- Everything else follows the [project standards](https://hq.rhizomatics.org.uk/policies/project_standards/) shared by all Rhizomatics repos.
