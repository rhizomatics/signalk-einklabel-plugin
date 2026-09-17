import { BLEApi } from "@signalk/server-api";
import { GattConnection } from "./gattConnection";
import { PLUGIN_NAME } from "../pluginVersion";
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

/**
 * Bounds the whole post-connect GATT session (service discovery, every read/write/notification a
 * driver's `paint()` makes until it calls `disconnect()`), not just the connect step above - unlike
 * `connectWithTimeout`/`bleApiBackend`'s connect race, neither backend's underlying `write()` or
 * `discoverServices()` has any timeout of its own, so a hang there (plausible against a flaky real
 * device) would otherwise sit forever with the connection, and any BLE Manager GATT claim, held open
 * - see `withSessionWatchdog`. Generous relative to any single driver operation's own timeout (e.g.
 * gicisky's 15s per-chunk ack) since it has to cover a whole multi-chunk image transfer, not one step
 * of it; it's a last-resort backstop, not a normal-path budget.
 */
const GATT_SESSION_WATCHDOG_MS = 5 * 60_000;

/**
 * Wraps a connected `GattConnection` so the session as a whole - not just the connect step - can't
 * hang forever. Starts a single timer when the connection opens; if `disconnect()` hasn't been
 * called (i.e. the caller's `paint()` hasn't finished, successfully or not) by the time it fires,
 * treats the session as stuck: calls `forceClose` (which must tear down the connection and, for a
 * shared backend, release any claim on it) and fails every call still outstanding or made afterwards.
 * `Promise.race`ing each call against that same failure - rather than just refusing new calls once
 * killed - is what actually unblocks a caller `await`ing a hung `write()`/`discoverServices()`:
 * forcing the underlying connection closed doesn't guarantee the hung call's own promise ever
 * settles, so the caller needs a second, independent way to move on.
 */
export function withSessionWatchdog(conn: GattConnection, timeoutMs: number, forceClose: () => Promise<void>): GattConnection {
  let killedError: Error | undefined;
  let resolveKilled: (err: Error) => void;
  const killed = new Promise<Error>((resolve) => {
    resolveKilled = resolve;
  });
  let settled = false;

  // `unref()` so this backstop timer never itself keeps the process alive (e.g. the CLI's `paint`
  // command exiting naturally once its work is done) - it only ever needs to fire while something
  // else is already keeping the event loop running anyway.
  const timer = setTimeout(() => {
    if (settled) return;
    killedError = new Error(`GATT session watchdog fired after ${timeoutMs}ms with no completion - forcing disconnect`);
    console.error(`${PLUGIN_NAME}: ${killedError.message}`);
    resolveKilled(killedError);
    void forceClose().catch(() => {});
  }, timeoutMs).unref();

  function guard<T>(op: () => Promise<T>): Promise<T> {
    if (killedError) return Promise.reject(killedError);
    const result = op();
    result.catch(() => {}); // observed here too, so losing the race below never surfaces as an unhandled rejection
    return Promise.race([result, killed.then((err) => Promise.reject(err))]);
  }

  return {
    read: (serviceUuid, charUuid) => guard(() => conn.read(serviceUuid, charUuid)),
    write: (serviceUuid, charUuid, data, withResponse) => guard(() => conn.write(serviceUuid, charUuid, data, withResponse)),
    startNotifications: (serviceUuid, charUuid, callback) => guard(() => conn.startNotifications(serviceUuid, charUuid, callback)),
    stopNotifications: (serviceUuid, charUuid) => guard(() => conn.stopNotifications(serviceUuid, charUuid)),
    discoverServices: () => guard(() => conn.discoverServices()),
    onDisconnect: conn.onDisconnect.bind(conn),
    get connected() {
      return conn.connected;
    },
    async disconnect() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killedError) return; // already forced closed by the watchdog above
      await conn.disconnect();
    },
  };
}

export function nodeBleBackend(): BleBackend {
  return {
    async connectGatt(address, timeoutMs) {
      const { bluetooth, destroy } = createBluetooth();
      try {
        const adapter = await bluetooth.defaultAdapter();
        const device = await getOrDiscoverDevice(adapter, address, DEVICE_DISCOVERY_TIMEOUT_MS);
        await connectWithTimeout(device, timeoutMs);
        const conn = openNodeBleGattConnection(device);
        let destroyed = false;
        const destroyOnce = () => {
          if (destroyed) return;
          destroyed = true;
          destroy();
        };
        const gatt: GattConnection = {
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
            try {
              await conn.disconnect();
            } finally {
              destroyOnce();
            }
          },
        };
        return withSessionWatchdog(gatt, GATT_SESSION_WATCHDOG_MS, async () => {
          // `device.disconnect()` can hang for the same underlying reason the operations
          // `withSessionWatchdog` already guards can (see its doc comment) - race it briefly rather
          // than awaiting it unbounded here too, but tear down the D-Bus connection either way so
          // those resources don't leak even if BlueZ's disconnect itself never completes.
          await Promise.race([gatt.disconnect(), sleep(5_000)]);
          destroyOnce();
        });
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
 * `connectWithTimeout` in `bleDiscovery.ts`) - races it against `timeoutMs`.
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
        // The server registers the claim as soon as `connectGATT()` is called, not once it succeeds -
        // giving up here without releasing it would leave the claim (and, once/if the connect attempt
        // does eventually land server-side, a live connection) orphaned indefinitely, since this
        // plugin never gets a handle back to disconnect it itself. `releaseGATTDevice` tears down
        // whatever the claim currently is, connected or still connecting, regardless of how the
        // original `connectGATT()` promise eventually settles - disconnecting it too if it does still
        // resolve afterwards, harmlessly, since a connection the server already released is a no-op to
        // disconnect again.
        void bleApi
          .releaseGATTDevice(address, pluginId)
          .catch(() => {})
          .then(() => connecting.then((c) => c.disconnect()).catch(() => {}));
        throw new Error(`connecting to device timed out after ${timeoutMs}ms`);
      }
      return withSessionWatchdog(conn, GATT_SESSION_WATCHDOG_MS, async () => {
        // Belt-and-suspenders, matching the timeout-cleanup above: `releaseGATTDevice` is the
        // authoritative claim release, `disconnect()` a secondary teardown of this specific handle -
        // do both regardless of which (if either) itself hangs or rejects.
        await Promise.allSettled([bleApi.releaseGATTDevice(address, pluginId), conn.disconnect()]);
      });
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
