import { BLEApi } from "@signalk/server-api";
import { GattConnection } from "./gattConnection";
import {
  connectWithTimeout,
  createBluetooth,
  getOrDiscoverDevice,
  openNodeBleGattConnection,
  sleep,
  waitForManufacturerData as waitForManufacturerDataViaBlueZ,
} from "./bleDiscovery";

/**
 * Opens a connection to `address` and (for gicisky) re-scans for a fresh advertisement carrying its
 * manufacturer data - the two BLE-hardware-access operations a `paint()` needs beyond the
 * backend-agnostic `GattConnection` a connection itself exposes. `nodeBleBackend()` talks to BlueZ
 * directly; `bleApiBackend()` routes through the SignalK server's BLE Manager API (`app.bleApi`) so
 * this plugin shares the adapter with other BLE plugins instead of contending for it - see
 * `VendorDeviceConfig.gattBackend` in `types.ts` for how a driver picks one.
 */
export interface BleBackend {
  connectGatt(address: string, timeoutMs: number): Promise<GattConnection>;
  waitForManufacturerData(address: string, manufacturerId: number, timeoutMs: number): Promise<Buffer | undefined>;
}

/** How long to wait for BlueZ to have (or acquire) a `Device` object for the target address before giving up - a separate budget from the connect step itself, matching both drivers' previous hardcoded constant. */
const DEVICE_DISCOVERY_TIMEOUT_MS = 30_000;

export function nodeBleBackend(): BleBackend {
  return {
    async connectGatt(address, timeoutMs) {
      const { bluetooth, destroy } = createBluetooth();
      try {
        const adapter = await bluetooth.defaultAdapter();
        const device = await getOrDiscoverDevice(adapter, address, DEVICE_DISCOVERY_TIMEOUT_MS);
        await connectWithTimeout(device, timeoutMs);
        const conn = openNodeBleGattConnection(device);
        return {
          read: conn.read.bind(conn),
          write: conn.write.bind(conn),
          startNotifications: conn.startNotifications.bind(conn),
          stopNotifications: conn.stopNotifications.bind(conn),
          discoverServices: conn.discoverServices.bind(conn),
          onDisconnect: conn.onDisconnect.bind(conn),
          get connected() {
            return conn.connected;
          },
          async disconnect() {
            await conn.disconnect();
            destroy();
          },
        };
      } catch (err) {
        destroy();
        throw err;
      }
    },
    async waitForManufacturerData(address, manufacturerId, timeoutMs) {
      const { bluetooth, destroy } = createBluetooth();
      try {
        const adapter = await bluetooth.defaultAdapter();
        const device = await getOrDiscoverDevice(adapter, address, DEVICE_DISCOVERY_TIMEOUT_MS);
        return await waitForManufacturerDataViaBlueZ(adapter, device, manufacturerId, timeoutMs);
      } finally {
        destroy();
      }
    },
  };
}

/**
 * `bleApi.connectGATT()` has no timeout of its own, same story as node-ble's `Device#connect()` (see
 * `connectWithTimeout` in `bleDiscovery.ts`) - races it against `timeoutMs` and disconnects in the
 * background if it eventually resolves after the caller has already given up.
 */
export function bleApiBackend(bleApi: BLEApi, pluginId: string): BleBackend {
  return {
    async connectGatt(address, timeoutMs) {
      // A previous ungraceful stop (crash, plugin reload mid-paint) can leave a stale GATT claim
      // registered under our own pluginId, which would otherwise block this connect with
      // "already claimed" until the server restarts - see signalk-bluetti-plugin's BleManagerDevice
      // for the same defensive call. A no-op if we don't currently hold the claim.
      await bleApi.releaseGATTDevice(address, pluginId).catch(() => {});

      const connecting = bleApi.connectGATT(address, pluginId);
      let timedOut = false;
      const conn = await Promise.race([connecting, sleep(timeoutMs).then(() => void (timedOut = true))]);
      if (timedOut || !conn) {
        connecting.then((c) => c.disconnect()).catch(() => {});
        throw new Error(`connecting to device timed out after ${timeoutMs}ms`);
      }
      return conn;
    },
    async waitForManufacturerData(address, manufacturerId, timeoutMs) {
      // Unlike node-ble's `device.getManufacturerData()`, there's no cached-instant-read path here -
      // `BLEDeviceInfo` (from `getDevices()`/`getDevice()`) carries mac/name/rssi/seenBy but not
      // manufacturer data (see `BLEDeviceInfoSchema` in `@signalk/server-api`'s `ble-schemas.ts`) -
      // only the streamed `BLEAdvertisement` does. So this always actively waits on the stream.
      return new Promise<Buffer | undefined>((resolve) => {
        const timer = setTimeout(() => {
          unsubscribe();
          resolve(undefined);
        }, timeoutMs);
        const unsubscribe = bleApi.onAdvertisement(pluginId, (adv) => {
          if (adv.mac !== address) return;
          const hex = adv.manufacturerData?.[manufacturerId];
          if (hex === undefined) return;
          clearTimeout(timer);
          unsubscribe();
          resolve(Buffer.from(hex, "hex"));
        });
      });
    },
  };
}
