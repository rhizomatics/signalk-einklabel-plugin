import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ServerAPI } from "@signalk/server-api";
import { DiscoveredDevice } from "./types";

/**
 * How long a previously-scanned device that isn't found again in a later scan is still kept as a
 * dropdown option, before being dropped - covers a device that's simply asleep/out of BLE range for
 * one scan, without keeping stale entries around forever. Not yet user-configurable.
 */
export const DISCOVERED_DEVICE_TTL_MS = 24 * 60 * 60 * 1000;

export type DiscoveredDeviceRecord = DiscoveredDevice & { lastSeenAt: number };
export type DiscoveredDevicesState = Record<string, DiscoveredDeviceRecord>;

function storePath(app: ServerAPI): string {
  return join(app.getDataDirPath(), "discovered-devices.json");
}

export function loadDiscoveredDevices(app: ServerAPI): DiscoveredDevicesState {
  try {
    return JSON.parse(readFileSync(storePath(app), "utf-8"));
  } catch {
    return {};
  }
}

function saveDiscoveredDevices(app: ServerAPI, state: DiscoveredDevicesState): void {
  writeFileSync(storePath(app), JSON.stringify(state));
}

/**
 * Merges one scan's finds into the previously persisted set, keyed by BLE address (the one stable
 * identifier across scans - see README's note on devices advertising under different names at
 * different times). A device found again gets `lastSeenAt` bumped to `now`; one not found this time
 * is kept as-is as long as it's within `DISCOVERED_DEVICE_TTL_MS` of its own `lastSeenAt`, and dropped
 * once older than that - so the dropdown survives a plugin restart and the occasional missed scan,
 * without accumulating devices that are gone for good.
 */
export function mergeDiscoveredDevices(
  previous: DiscoveredDevicesState,
  foundThisScan: DiscoveredDevice[],
  now: number,
): DiscoveredDevicesState {
  const next: DiscoveredDevicesState = {};
  for (const found of foundThisScan) {
    next[found.address] = { ...found, lastSeenAt: now };
  }
  for (const [address, record] of Object.entries(previous)) {
    if (!(address in next) && now - record.lastSeenAt < DISCOVERED_DEVICE_TTL_MS) {
      next[address] = record;
    }
  }
  return next;
}

/** Loads the persisted set, merges in this scan's finds, saves the result, and returns it. */
export function recordScanResults(app: ServerAPI, foundThisScan: DiscoveredDevice[], now: number = Date.now()): DiscoveredDevicesState {
  const merged = mergeDiscoveredDevices(loadDiscoveredDevices(app), foundThisScan, now);
  saveDiscoveredDevices(app, merged);
  return merged;
}

/**
 * Bumps a single device's `lastSeenAt` outside of a scan - called after a successful paint, since
 * connecting to paint it is just as much positive proof it's still there as a discovery scan hit.
 * Without this, a configured device that's actively being repainted (typically with `scanOnStart`
 * off once set up, per the README) would otherwise silently age out of the persisted set after
 * `DISCOVERED_DEVICE_TTL_MS` even though it's demonstrably still in range and working.
 */
export function touchDiscoveredDevice(app: ServerAPI, device: DiscoveredDevice, now: number = Date.now()): void {
  const state = loadDiscoveredDevices(app);
  state[device.address] = { ...device, lastSeenAt: now };
  saveDiscoveredDevices(app, state);
}
