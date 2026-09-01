import { Colour, DeviceMetadata } from "../types";

/**
 * Keyed by the 14-bit `deviceId` decoded from the advertisement (see `decodeAdvertisedInfo` in
 * `protocol.ts`) - Gicisky's own namespace, not shared with other vendors' PID spaces.
 *
 * Sourced from `DEVICE_TYPES` in hass-gicisky's `gicisky_ble/devices.py`, the more actively
 * maintained of the two reference implementations in the sibling `lab` checkouts. That file also
 * carries a much longer comment table of `deviceId`s seen in the wild that aren't yet mapped to
 * physical panel facts (`width`/`height`/colours) - those aren't reproduced here since there'd be
 * nothing to paint correctly for them yet.
 *
 * `width`/`height` are the pre-rotation "visual" canvas size - what a template should be designed
 * at - matching `DeviceEntry.width`/`.height` there; `paintLayout` (`layout.ts`) then rotates/mirrors
 * during encoding to produce the physical wire layout.
 */
export const GICISKY_PID_METADATA: DeviceMetadata[] = [
  {
    pid: 0x00a0,
    manufacturer: "Gicisky",
    label: '2.1" TFT BW',
    width: 250,
    height: 132,
    voffset: 0,
    colours: bw(),
  },
  {
    pid: 0x000b,
    manufacturer: "Gicisky",
    label: '2.1" BWR',
    width: 212,
    height: 104,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x010b,
    manufacturer: "Gicisky",
    label: '2.1" BWR',
    width: 250,
    height: 128,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x0028,
    manufacturer: "Gicisky",
    label: '2.9" BW',
    width: 296,
    height: 128,
    voffset: 0,
    colours: bw(),
  },
  {
    pid: 0x0033,
    manufacturer: "Gicisky",
    label: '2.9" BWR',
    width: 296,
    height: 128,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x002e,
    manufacturer: "Gicisky",
    label: '2.9" BWRY',
    width: 296,
    height: 128,
    voffset: 0,
    colours: bwry(),
  },
  {
    pid: 0x022b,
    manufacturer: "Gicisky",
    label: '3.7" BWR',
    width: 240,
    height: 416,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x004b,
    manufacturer: "Gicisky",
    label: '4.2" BWR',
    width: 400,
    height: 300,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x004e,
    manufacturer: "Gicisky",
    label: '4.2" BWRY',
    width: 400,
    height: 300,
    voffset: 0,
    colours: bwry(),
  },
  {
    pid: 0x012b,
    manufacturer: "Gicisky",
    label: '7.5" BWR',
    width: 800,
    height: 480,
    voffset: 0,
    colours: bwr(),
  },
  {
    pid: 0x008b,
    manufacturer: "Gicisky",
    label: '10.2" BWR',
    width: 960,
    height: 640,
    voffset: 0,
    colours: bwr(),
  },
];

function bw(): Colour[] {
  return ["black", "white"];
}
function bwr(): Colour[] {
  return ["black", "white", "red"];
}
function bwry(): Colour[] {
  return ["black", "white", "red", "yellow"];
}
