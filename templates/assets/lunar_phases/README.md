# Lunar Phases

## Source

https://commons.wikimedia.org/wiki/Category:SVG_lunar_phases_icons

## Usage

Embed any of these in a template as a placeholder and set the `description`
property to `path=environment.moon.phaseName,assets=lunar_phases`

The image will be replaced at rendering time by the one matching the phase name.
This will automatically adapt from 'Waxing Gibbous' to `waxing_gibbous.svg`

## Replacing

Define your own template directory in the plugin configuration, and add an `.assets/lunar_phases` directory path beneath it. You will need a complete set of phases in
the new directory, its not possible to override only one of them.

## Quirks

'Third Quarter' is also known as 'Last Quarter' so the image is present under both names.
