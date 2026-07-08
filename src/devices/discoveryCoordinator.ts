import { ServerAPI } from "@signalk/server-api";
import { forEachAdvertisedDevice, withDiscovery } from "./bleDiscovery";
import { DiscoveredDevicesState, recordScanResults } from "./discoveredDevicesStore";
import { allDrivers } from "./registry";
import { DiscoveredDevice } from "./types";

export interface ScanResult {
  /** Devices this particular scan actually found - distinct from `merged`, which also carries over anything still-fresh from before. */
  foundThisScan: DiscoveredDevice[];
  /** The full persisted set after merging `foundThisScan` in - see `discoveredDevicesStore.ts`. */
  merged: DiscoveredDevicesState;
}

interface InFlightScan {
  startedAt: number;
  promise: Promise<ScanResult>;
}

let inFlight: InFlightScan | undefined;

/** epoch ms a scan was started at, if one is currently running - `undefined` otherwise. */
export function scanInProgressSince(): number | undefined {
  return inFlight?.startedAt;
}

/**
 * Runs one BLE discovery scan and persists what it finds. node-ble/BlueZ has no scan-cancellation
 * API and can't run two discovery sessions at once, so a caller that arrives while a scan is
 * already running (e.g. the startup scan and an on-demand scan for a `device: "ALL"` repaint both
 * wanting to scan at the same moment) is hooked into that *same* in-flight scan's eventual result
 * instead of starting a second BlueZ session, which would make both fail.
 */
export function ensureScan(app: ServerAPI, durationSeconds: number): Promise<ScanResult> {
  if (inFlight) {
    return inFlight.promise;
  }
  const promise = runScan(app, durationSeconds).finally(() => {
    inFlight = undefined;
  });
  inFlight = { startedAt: Date.now(), promise };
  return promise;
}

async function runScan(app: ServerAPI, durationSeconds: number): Promise<ScanResult> {
  const foundThisScan: DiscoveredDevice[] = [];
  const drivers = allDrivers();
  try {
    await withDiscovery(durationSeconds * 1000, async (adapter) => {
      await forEachAdvertisedDevice(adapter, async ({ device, address, name, manufacturerId, manufacturerData }) => {
        const driver = drivers.find((candidate) => candidate.matchesAdvertisement(name, manufacturerId));
        if (!driver) {
          return;
        }
        const found = await driver.identifyDevice(device, address, name, manufacturerId, manufacturerData).catch((err) => {
          app.debug(`${driver.vendor} scan failed: ${err.message}\n${err.stack ?? ""}`);
          return undefined;
        });
        if (!found) {
          return;
        }
        foundThisScan.push(found);
        const pid = found.pid !== undefined ? `0x${found.pid.toString(16).padStart(4, "0")}` : "unknown";
        const hwid = found.hwVersion ?? "unknown";
        app.debug(`discovered ${driver.vendor} device "${found.name ?? ""}" [${found.address}] pid=${pid} hwid=${hwid}`);
      });
    });
  } catch (err) {
    app.debug(`scan failed: ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
  }
  const merged = recordScanResults(app, foundThisScan);
  return { foundThisScan, merged };
}
