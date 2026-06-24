import { DeviceMetadata } from '../types';

/**
 * Keyed by PID within the Zhsunyco/Wolink namespace only — this table is not shared
 * with other vendors' PID spaces. Populated from confirmed hardware only; the upstream
 * wolink_ble.py reference driver has PIDs that disagree with its own header comment
 * (0x000E), so unconfirmed entries are deliberately left out rather than guessed.
 */
export const ZHSUNYCO_PID_METADATA: Record<number, DeviceMetadata> = {
  0x000e: {
    pid: 0x000e,
    label: '3.7"',
    width: 416,
    height: 240,
    voffset: 0,
    colours: ['black', 'white', 'red', 'yellow'],
  },
};
