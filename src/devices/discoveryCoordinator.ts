import { ServerAPI } from "@signalk/server-api";
import { connectWithTimeout, forEachAdvertisedDevice, openNodeBleGattConnection, sleep, withDiscovery } from "./bleDiscovery";
import { bleApiBackend } from "./bleBackend";
import {
  DISCOVERED_DEVICE_TTL_MS,
  DiscoveredDevicesState,
  loadDiscoveredDevices,
  recordScanResults,
  touchDiscoveredDevice,
} from "./discoveredDevicesStore";
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
 * The `matchesAdvertisement`+`identifyDevice` half of processing one BLE Manager sighting - shared by
 * `runScanViaBleApi`'s bounded scan and `startBleApiDiscoveryListener`'s indefinite one below. Doesn't
 * decide *whether* to attempt identification (a bounded scan's own per-call `seen` set vs. the
 * listener's persisted-store check need different answers to that) - just does the attempt and reports
 * what it found, or `undefined` for "no matching driver"/"identify failed". `adv.manufacturerData`
 * (from either an advertisement or, seeded, a `getDevices()` entry) is `Record<number, string>`
 * (decimal company ID -> hex-encoded payload) rather than node-ble's `Buffer` - converted here so
 * drivers never see the difference.
 */
async function identifyOne(
  app: ServerAPI,
  backend: ReturnType<typeof bleApiBackend>,
  mac: string,
  name: string | undefined,
  rssi: number | undefined,
  manufacturerDataHex: Record<number, string> | undefined,
): Promise<DiscoveredDevice | undefined> {
  const [manufacturerIdKey] = Object.keys(manufacturerDataHex ?? {});
  const manufacturerId = manufacturerIdKey === undefined ? undefined : Number(manufacturerIdKey);
  const manufacturerData = manufacturerId === undefined ? undefined : Buffer.from(manufacturerDataHex![manufacturerId], "hex");
  const driver = allDrivers().find((candidate) => candidate.matchesAdvertisement(name, manufacturerId));
  if (!driver) {
    return undefined;
  }
  const connect = () => backend.connectGatt(mac, SCAN_GATT_CONNECT_TIMEOUT_MS);
  const found = await driver.identifyDevice({ address: mac, name, manufacturerId, manufacturerData, rssi }, connect).catch((err) => {
    app.debug(`${driver.vendor} discovery failed for [${mac}]: ${err.message}\n${err.stack ?? ""}`);
    return undefined;
  });
  if (found) {
    const pid = found.pid !== undefined ? `0x${found.pid.toString(16).padStart(4, "0")}` : "unknown";
    const hwid = found.hwVersion ?? "unknown";
    app.debug(`discovered ${driver.vendor} device "${found.name ?? ""}" [${found.address}] pid=${pid} hwid=${hwid}`);
  }
  return found;
}

/**
 * Same as `runScanViaBlueZ` but sourced from the SignalK server's BLE Manager API instead of a direct
 * BlueZ discovery session - subscribes to the merged advertisement stream for `durationSeconds`,
 * seeded with whatever the server already knows about (mirrors `BleManagerScanner` in
 * signalk-bluetti-plugin).
 */
async function runScanViaBleApi(app: ServerAPI, durationSeconds: number): Promise<ScanResult> {
  const foundThisScan: DiscoveredDevice[] = [];
  const seen = new Set<string>();
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
    seen.add(mac);
    const found = await identifyOne(app, backend, mac, name, rssi, manufacturerDataHex);
    if (found) {
      foundThisScan.push(found);
    }
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

/**
 * Keeps the "Device" picker (and `ALL_DEVICES`) current for as long as the plugin runs, without any
 * bounded "scan" step at all - unlike `runScanViaBleApi`/`runScanViaBlueZ` above, which only ever look
 * for new devices during an explicit, timed window (`scanOnStart`, or an on-demand `ALL_DEVICES` scan).
 * BLE Manager already runs its own continuous scan server-side to build the device list the admin UI's
 * "BLE Manager" page shows - a device that's visible there but never appears in *this* plugin's own
 * picker unless `scanOnStart` happens to be ticked is exactly that mismatch: nothing was ever listening
 * for BLE Manager's advertisements outside a bounded window. This instead subscribes once, for good,
 * so a device shows up here as soon as BLE Manager itself has seen it - no manual scan required.
 *
 * Only runs a genuinely new (or long-expired, see `DISCOVERED_DEVICE_TTL_MS`) address through
 * `driver.identifyDevice()` - a real GATT connect+read. A device already in the persisted store just
 * gets `lastSeenAt` bumped via `touchDiscoveredDevice`, since re-identifying it on every ~1s
 * advertisement would otherwise hammer it (and the shared GATT slots) for no reason. `pending` guards
 * against two advertisements for the same brand-new device starting a second identify attempt while
 * the first is still connecting.
 */
export function startBleApiDiscoveryListener(app: ServerAPI, pluginId: string): () => void {
  const backend = bleApiBackend(app.bleApi, pluginId);
  const pending = new Set<string>();

  const identify = async (
    mac: string,
    name: string | undefined,
    rssi: number | undefined,
    manufacturerDataHex: Record<number, string> | undefined,
  ) => {
    const existing = loadDiscoveredDevices(app)[mac];
    if (existing) {
      if (Date.now() - existing.lastSeenAt < DISCOVERED_DEVICE_TTL_MS) {
        touchDiscoveredDevice(app, existing);
        return;
      }
    }
    if (pending.has(mac)) {
      return;
    }
    pending.add(mac);
    try {
      const found = await identifyOne(app, backend, mac, name, rssi, manufacturerDataHex);
      if (found) {
        recordScanResults(app, [found]);
      }
    } finally {
      pending.delete(mac);
    }
  };

  const unsubscribe = app.bleApi.onAdvertisement(pluginId, (adv) => {
    void identify(adv.mac, adv.name, adv.rssi, adv.manufacturerData);
  });

  // Seeds from whatever BLE Manager already knows about (e.g. a device it saw before this plugin
  // subscribed) - same manufacturer-data caveat as `runScanViaBleApi`'s equivalent seed loop; a driver
  // that needs it (rather than matching on name) picks it up once a fresh advertisement arrives above.
  void app.bleApi
    .getDevices()
    .then((known) => Promise.all(known.map((device) => identify(device.mac, device.name, device.rssi, undefined))))
    .catch((err) => app.debug(`discovery listener: could not read known devices: ${(err as Error).message}`));

  return unsubscribe;
}
