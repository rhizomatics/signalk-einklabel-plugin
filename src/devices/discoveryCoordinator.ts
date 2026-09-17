import { ServerAPI } from "@signalk/server-api";
import { connectWithTimeout, forEachAdvertisedDevice, openNodeBleGattConnection, sleep, withDiscovery } from "./bleDiscovery";
import { bleApiBackend } from "./bleBackend";
import { DiscoveredDevicesState, recordScanResults } from "./discoveredDevicesStore";
import { allDrivers } from "./registry";
import { DiscoveredDevice } from "./types";
import { PLUGIN_NAME } from "../pluginVersion";

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

/** How long a `connect()` closure built during a scan waits for the GATT connect step itself - a scan may be enumerating several devices, so kept short relative to `paint()`'s own connect timeout. */
const SCAN_GATT_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Runs one BLE discovery scan and persists what it finds. Neither backend can run two discovery
 * sessions at once (node-ble/BlueZ has no scan-cancellation API; the BLE Manager API tracks one
 * subscription per plugin), so a caller that arrives while a scan is already running (e.g. the
 * startup scan and an on-demand scan for a `device: "ALL"` repaint both wanting to scan at the same
 * moment) is hooked into that *same* in-flight scan's eventual result instead of starting a second
 * one, which would make both fail.
 */
export function ensureScan(app: ServerAPI, durationSeconds: number, useBleApi: boolean): Promise<ScanResult> {
  if (inFlight) {
    return inFlight.promise;
  }
  const promise = (useBleApi && !!app.bleApi ? runScanViaBleApi(app, durationSeconds) : runScanViaBlueZ(app, durationSeconds)).finally(
    () => {
      inFlight = undefined;
    },
  );
  inFlight = { startedAt: Date.now(), promise };
  return promise;
}

async function runScanViaBlueZ(app: ServerAPI, durationSeconds: number): Promise<ScanResult> {
  const foundThisScan: DiscoveredDevice[] = [];
  const drivers = allDrivers();
  try {
    await withDiscovery(durationSeconds * 1000, async (adapter) => {
      await forEachAdvertisedDevice(adapter, async ({ device, address, name, manufacturerId, manufacturerData }) => {
        const driver = drivers.find((candidate) => candidate.matchesAdvertisement(name, manufacturerId));
        if (!driver) {
          return;
        }
        const rssi = await device
          .getRSSI()
          .then((value) => (value === undefined ? undefined : Number(value)))
          .catch(() => undefined);
        const connect = () => connectWithTimeout(device, SCAN_GATT_CONNECT_TIMEOUT_MS).then(() => openNodeBleGattConnection(device));
        const found = await driver.identifyDevice({ address, name, manufacturerId, manufacturerData, rssi }, connect).catch((err) => {
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

/**
 * Same as `runScanViaBlueZ` but sourced from the SignalK server's BLE Manager API instead of a direct
 * BlueZ discovery session - subscribes to the merged advertisement stream for `durationSeconds`,
 * seeded with whatever the server already knows about (mirrors `BleManagerScanner` in
 * signalk-bluetti-plugin). `app.bleApi.getDevices()`/advertisements don't carry manufacturer data
 * directly comparable to node-ble's `Buffer` - `adv.manufacturerData` is `Record<number, string>`
 * (decimal company ID -> hex-encoded payload), converted here so drivers never see the difference.
 */
async function runScanViaBleApi(app: ServerAPI, durationSeconds: number): Promise<ScanResult> {
  const foundThisScan: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  const drivers = allDrivers();
  const backend = bleApiBackend(app.bleApi, PLUGIN_NAME);

  const identify = async (
    mac: string,
    name: string | undefined,
    rssi: number | undefined,
    manufacturerDataHex: Record<number, string> | undefined,
  ) => {
    if (seen.has(mac)) {
      return;
    }
    const [manufacturerIdKey] = Object.keys(manufacturerDataHex ?? {});
    const manufacturerId = manufacturerIdKey === undefined ? undefined : Number(manufacturerIdKey);
    const manufacturerData = manufacturerId === undefined ? undefined : Buffer.from(manufacturerDataHex![manufacturerId], "hex");
    const driver = drivers.find((candidate) => candidate.matchesAdvertisement(name, manufacturerId));
    if (!driver) {
      return;
    }
    seen.add(mac);
    const connect = () => backend.connectGatt(mac, SCAN_GATT_CONNECT_TIMEOUT_MS);
    const found = await driver.identifyDevice({ address: mac, name, manufacturerId, manufacturerData, rssi }, connect).catch((err) => {
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
  };

  try {
    const unsubscribe = app.bleApi.onAdvertisement(PLUGIN_NAME, (adv) => {
      void identify(adv.mac, adv.name, adv.rssi, adv.manufacturerData);
    });
    try {
      const known = await app.bleApi.getDevices();
      for (const device of known) {
        // BLEDeviceInfo (from getDevices()) doesn't carry manufacturer data - see `bleBackend.ts`'s
        // waitForManufacturerData doc comment. A driver that needs it to identify (e.g. gicisky) will
        // still show up once its advertisement arrives on the stream above during this scan window.
        await identify(device.mac, device.name, device.rssi, undefined);
      }
      await sleep(durationSeconds * 1000);
    } finally {
      unsubscribe();
    }
  } catch (err) {
    app.debug(`scan failed: ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
  }
  const merged = recordScanResults(app, foundThisScan);
  return { foundThisScan, merged };
}
