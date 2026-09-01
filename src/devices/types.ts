import { Device } from "@naugehyde/node-ble";
import { Bitmap } from "../render/types";
import { ReframeMode } from "../render/reframe";

export type Colour = "black" | "white" | "red" | "yellow";

/**
 * Static facts about one device model, keyed by (vendor, pid) by the registry —
 * PID alone is not assumed unique across vendors.
 */
export interface DeviceMetadata {
  pid: number;
  /**
   * Disambiguates physical hardware that shares a PID (some vendors reuse PIDs across
   * panel sizes) - the exact advertised value to match against; omit for the variant
   * that should be treated as the default/fallback for that PID.
   */
  hwVersion?: string;
  /**
   * Real-world brand name (e.g. "Zhsunyco") - distinct from `VendorDriver.vendor` (e.g. also
   * "zhsunyco"), which is this codebase's internal BLE-protocol driver key rather than a name meant
   * for display. Optional since a CLI/config `DeviceModelOverride` for unsupported hardware has no
   * table entry to source it from - `considerLlmPromptRepaint` (repaintScheduler.ts) falls back to
   * the driver's own `vendor` key when unset, for a `source=label,path=manufacturer` prompt binding.
   */
  manufacturer?: string;
  label: string;
  width: number;
  height: number;
  voffset: number;
  colours: Colour[];
}

export interface DiscoveredDevice {
  address: string;
  name?: string;
  vendor: string;
  pid?: number;
  /**
   * The advertised hardware-version disambiguator, captured independently of whether `metadata`
   * lookup succeeded - lets `deviceOptions()` (`config.ts`) build a complete, parseable device token
   * even for a PID a driver doesn't recognise yet, instead of losing it because it was only ever
   * read off of `metadata.hwVersion`.
   */
  hwVersion?: string;
  metadata?: DeviceMetadata;
  rssi?: number;
  /** BLE manufacturer ID (the key of the advertisement's manufacturer data), if advertised. */
  manufacturerId?: number;
  /** Battery level in millivolts, if the driver was able to read it during the scan. */
  batteryMv?: number;
}

/** Manual model facts a user can supply for hardware that isn't yet in a driver's PID table. */
export type DeviceModelOverride = Omit<DeviceMetadata, "pid">;

/** Per-device settings the user supplies when registering a device, beyond what's in DeviceMetadata. */
export interface VendorDeviceConfig {
  address: string;
  /** AES key for vendors that need it, entered by the user. If omitted, vendors that have one may fall back to a stock/manufacturer-default key instead of failing. */
  aesKey?: string;
  /** Forces the device model facts instead of looking up the advertised PID - for hardware not yet in the driver's table. */
  modelOverride?: DeviceModelOverride;
  /** How long to wait for the BLE connect step before giving up - if omitted, the driver picks its own default. */
  connectTimeoutMs?: number;
  /** How to fit the bitmap onto the panel when its size doesn't already match - see `ReframeMode`. Defaults to `"fixed"`, i.e. unchanged (encoding then rejects the mismatch, as it always has). */
  reframe?: ReframeMode;
}

export interface VendorDriver {
  vendor: string;

  /** Does this advertisement look like it came from one of this vendor's devices? */
  matchesAdvertisement(name: string | undefined, manufacturerId: number | undefined): boolean;

  /** hwVersion disambiguates PIDs a vendor reuses across panel sizes - see `DeviceMetadata.hwVersion`. */
  metadataForPid(pid: number, hwVersion?: string): DeviceMetadata | undefined;

  /** All device models this driver currently has confirmed metadata for. */
  supportedDevices(): DeviceMetadata[];

  /**
   * Identifies one device the shared caller (see `bleDiscovery.ts`'s `forEachAdvertisedDevice`)
   * has already matched to this vendor via `matchesAdvertisement` - only called for matches, so a
   * device gets at most one vendor-specific connect/read regardless of how many drivers are
   * registered, not one attempt per driver.
   */
  identifyDevice(
    device: Device,
    address: string,
    name: string | undefined,
    manufacturerId: number | undefined,
    manufacturerData: Buffer | undefined,
  ): Promise<DiscoveredDevice>;

  /** Quantise the common bitmap to this device's palette/encoding and send it over BLE. */
  paint(bitmap: Bitmap, config: VendorDeviceConfig): Promise<void>;
}
