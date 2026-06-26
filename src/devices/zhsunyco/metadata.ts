import { DeviceMetadata } from '../types';

/**
 * Keyed by PID within the Zhsunyco/Wolink namespace only — this table is not shared
 * with other vendors' PID spaces.
 *
 * PID 0x000E is reused across multiple physical panel sizes - the upstream wolink_ble.py
 * reference driver's own header comment disagrees with its code (`types` dict) about what
 * 0x000E even is, and OpenEPaperLink's `wolinkToOEPLtype()` independently hit the same
 * ambiguity. OEPL resolves it via the advertised hwVersion field, listing
 * 0x0103/0x0201/0x0203 as 2.13"/3.5"/7.5" BWRY panels respectively; the entry below with
 * no `hwVersion` is the developer's own confirmed 3.7" hardware and is used as the
 * fallback for any hwVersion not in that list.
 *
 * The remaining entries (0x0008/0x000A/0x0012/0x0016/0x001A) are unconfirmed against real
 * hardware but are taken from wolink_ble.py's `types` dict rather than its header comment,
 * since none of them shows the kind of hwVersion-dependent reuse 0x000E turned out to
 * have - there's no reason yet to doubt them the way 0x000E's docstring/code mismatch
 * gave reason to.
 */
export const ZHSUNYCO_PID_METADATA: DeviceMetadata[] = [
  {
    pid: 0x0008,
    label: '1.54"',
    width: 200,
    height: 200,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x000a,
    label: '2.13"',
    width: 250,
    height: 128,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x000e,
    label: '3.7"',
    width: 416,
    height: 240,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x000e,
    hwVersion: '0103',
    label: '2.13"',
    width: 250,
    height: 128,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x000e,
    hwVersion: '0201',
    label: '3.5"',
    width: 384,
    height: 184,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x000e,
    hwVersion: '0203',
    label: '7.5"',
    width: 800,
    height: 480,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x0012,
    label: '2.9"',
    width: 296,
    height: 128,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x0016,
    label: '4.2"',
    width: 400,
    height: 300,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
  {
    pid: 0x001a,
    label: '5.8"',
    width: 648,
    height: 480,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
];
