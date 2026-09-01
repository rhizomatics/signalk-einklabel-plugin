/**
 * Per-model wire-layout quirks, keyed the same way as `GICISKY_PID_METADATA` (by `deviceId`).
 * These aren't part of the shared `DeviceMetadata` shape since no other vendor needs them -
 * `DeviceMetadata.width`/`.height` is the pre-rotation "visual" canvas (what a template is
 * designed at); this table says how `encode.ts` turns that into the physical byte layout each
 * model actually expects. Transcribed from `DeviceEntry`/`GiciskyClient._make_image_packet` in
 * hass-gicisky's `gicisky_ble/devices.py` and `gicisky_ble/writer.py`.
 */
export type GiciskyPacking =
  /** Plain concatenated bit-planes, no framing - covers most panels. */
  | "plain"
  /** Two bit-planes each split into raw 64-byte chunks framed per `compression.ts`'s `compress()` - the 7.5"/10.2" panels. */
  | "chunked"
  /**
   * A panel this driver can identify (for `scan`/discovery) but can't paint correctly yet - either
   * its vendor-firmware "compressed" line framing doesn't reconcile with the row-major bit-packing
   * `_make_image_packet` otherwise produces (the 3.7" panel, and the 7.5" panel on pre-`0x8101`
   * firmware, both of which use this legacy `compression=True` mode rather than `compression2`),
   * or it needs a resize/resample step this driver doesn't implement (the TFT panel).
   */
  | "unsupported";

export interface GiciskyLayout {
  /** Degrees the composed image is rotated (always a multiple of 90) before bit-packing. */
  rotation: 0 | 90 | 180 | 270;
  mirrorX: boolean;
  mirrorY: boolean;
  /** Swaps which bit value means "white" in the BW plane - some panels' controllers wire the panel's polarity the other way round. */
  invertLuminance: boolean;
  /** 2 bits/pixel across the device's full 4-colour palette, rather than separate 1-bit BW/red planes. */
  fourColour: boolean;
  packing: GiciskyPacking;
}

const DEFAULT_LAYOUT: GiciskyLayout = {
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  invertLuminance: false,
  fourColour: false,
  packing: "plain",
};

export const GICISKY_PID_LAYOUT: Record<number, GiciskyLayout> = {
  0x00a0: { ...DEFAULT_LAYOUT, packing: "unsupported" },
  0x000b: { ...DEFAULT_LAYOUT, rotation: 270, mirrorX: true },
  0x010b: { ...DEFAULT_LAYOUT, rotation: 270, mirrorX: true },
  0x0028: { ...DEFAULT_LAYOUT, rotation: 90 },
  0x0033: { ...DEFAULT_LAYOUT, rotation: 90 },
  0x002e: { ...DEFAULT_LAYOUT, rotation: 90, fourColour: true },
  0x022b: { ...DEFAULT_LAYOUT, rotation: 180, mirrorX: true, packing: "unsupported" },
  0x004b: { ...DEFAULT_LAYOUT },
  0x004e: { ...DEFAULT_LAYOUT, fourColour: true },
  /**
   * Only the newer (post-`0x8101`) firmware's `compression2` framing is implemented (see
   * `packing: "chunked"` above) - a 7.5" panel still on `0x8101` needs the legacy `compression`
   * framing this driver doesn't support yet, and `paint()` has no way to tell the two apart
   * without re-reading the advertised firmware version at paint time.
   */
  0x012b: { ...DEFAULT_LAYOUT, mirrorY: true, invertLuminance: true, packing: "chunked" },
  0x008b: { ...DEFAULT_LAYOUT, packing: "chunked" },
};

/** Best-effort layout for a `modelOverride`d PID this table has no entry for - assumes the common case. */
export function defaultLayoutFor(colours: string[]): GiciskyLayout {
  return { ...DEFAULT_LAYOUT, fourColour: colours.includes("yellow") };
}
