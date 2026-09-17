import test from "node:test";
import assert from "node:assert/strict";
import { BLEApi, BLEGattConnection } from "@signalk/server-api";
import { bleApiBackend, withSessionWatchdog } from "./bleBackend";

function fakeGattConnection(overrides: Record<string, unknown> = {}): BLEGattConnection {
  return {
    read: async () => Buffer.from([]),
    write: async () => {},
    startNotifications: async () => {},
    stopNotifications: async () => {},
    discoverServices: async () => [],
    disconnect: async () => {},
    connected: true,
    onDisconnect: () => {},
    ...overrides,
  } as unknown as BLEGattConnection;
}

test("bleApiBackend.connectGatt", async (t) => {
  await t.test("releases any stale claim before connecting, then returns the connection", async () => {
    const calls: string[] = [];
    const conn = fakeGattConnection({ disconnect: async () => void calls.push("disconnect") });
    const bleApi = {
      releaseGATTDevice: async (mac: string, pluginId: string) => {
        calls.push(`release:${mac}:${pluginId}`);
      },
      connectGATT: async (mac: string, pluginId: string) => {
        calls.push(`connect:${mac}:${pluginId}`);
        return conn;
      },
    } as unknown as BLEApi;

    const result = await bleApiBackend(bleApi, "my-plugin").connectGatt("AA:BB:CC:DD:EE:FF", 1000);
    // `connectGatt` now wraps the raw connection in a session watchdog (see `withSessionWatchdog`),
    // so the result is no longer the same object - check it delegates to `conn` instead.
    assert.equal(result.connected, conn.connected);
    await result.disconnect();
    assert.deepEqual(calls, ["release:AA:BB:CC:DD:EE:FF:my-plugin", "connect:AA:BB:CC:DD:EE:FF:my-plugin", "disconnect"]);
  });

  await t.test("proceeds even when releasing a stale claim fails (nothing to release)", async () => {
    const conn = fakeGattConnection();
    const bleApi = {
      releaseGATTDevice: async () => {
        throw new Error("not claimed");
      },
      connectGATT: async () => conn,
    } as unknown as BLEApi;

    const result = await bleApiBackend(bleApi, "my-plugin").connectGatt("AA:BB:CC:DD:EE:FF", 1000);
    assert.equal(result.connected, true);
  });

  await t.test("rejects once the timeout elapses, releasing the claim and disconnecting if it resolves later", async () => {
    let disconnected = false;
    const releaseCalls: string[] = [];
    let resolveConnect: (conn: BLEGattConnection) => void;
    const bleApi = {
      releaseGATTDevice: async (mac: string) => {
        releaseCalls.push(mac);
      },
      connectGATT: () =>
        new Promise<BLEGattConnection>((resolve) => {
          resolveConnect = resolve;
        }),
    } as unknown as BLEApi;

    await assert.rejects(bleApiBackend(bleApi, "my-plugin").connectGatt("AA:BB:CC:DD:EE:FF", 20), /timed out after 20ms/);
    // Once before connecting (clearing any stale claim), once again on timeout - the server registers
    // the claim as soon as connectGATT() is called, not once it succeeds, so giving up without
    // releasing it would leave the claim orphaned.
    assert.deepEqual(releaseCalls, ["AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF"]);

    resolveConnect!(fakeGattConnection({ disconnect: async () => void (disconnected = true) }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(disconnected, true);
  });
});

test("withSessionWatchdog", async (t) => {
  await t.test("delegates calls through while the session stays within its timeout", async () => {
    let forceClosed = false;
    const conn = fakeGattConnection({ read: async () => Buffer.from([1, 2, 3]) });
    const gatt = withSessionWatchdog(conn, 1000, async () => void (forceClosed = true));

    assert.deepEqual(await gatt.read("service", "char"), Buffer.from([1, 2, 3]));
    assert.equal(gatt.connected, true);
    await gatt.disconnect();
    assert.equal(forceClosed, false);
  });

  await t.test("forces the connection closed and fails a hung call once the watchdog fires", async () => {
    const forceCloseCalls: string[] = [];
    const conn = fakeGattConnection({
      // Never settles - simulates a `write()`/`discoverServices()` that hangs against a flaky
      // device, which is exactly what the watchdog exists to bound.
      write: () => new Promise<void>(() => {}),
    });
    const gatt = withSessionWatchdog(conn, 20, async () => void forceCloseCalls.push("closed"));

    await assert.rejects(gatt.write("service", "char", Buffer.from([]), false), /watchdog fired after 20ms/);
    assert.deepEqual(forceCloseCalls, ["closed"]);

    // Any later call on the same connection fails immediately too, rather than issuing another
    // real operation against a connection the watchdog has already torn down.
    await assert.rejects(gatt.read("service", "char"), /watchdog fired after 20ms/);
  });

  await t.test("disconnecting after the watchdog already fired is a no-op, not a second force-close", async () => {
    let forceCloseCount = 0;
    let underlyingDisconnectCount = 0;
    const conn = fakeGattConnection({
      discoverServices: () => new Promise<never>(() => {}),
      disconnect: async () => void underlyingDisconnectCount++,
    });
    const gatt = withSessionWatchdog(conn, 20, async () => void forceCloseCount++);

    await assert.rejects(gatt.discoverServices());
    await gatt.disconnect();

    assert.equal(forceCloseCount, 1);
    assert.equal(underlyingDisconnectCount, 0);
  });
});

test("bleApiBackend.waitForManufacturerData", async (t) => {
  await t.test("resolves with the hex-decoded payload from a matching advertisement", async () => {
    let deliver: ((adv: unknown) => void) | undefined;
    let unsubscribed = false;
    const bleApi = {
      onAdvertisement: (_pluginId: string, cb: (adv: unknown) => void) => {
        deliver = cb;
        return () => void (unsubscribed = true);
      },
    } as unknown as BLEApi;

    const pending = bleApiBackend(bleApi, "my-plugin").waitForManufacturerData("AA:BB:CC:DD:EE:FF", 0x0157, 1000);
    deliver!({ mac: "AA:BB:CC:DD:EE:FF", manufacturerData: { [0x0157]: "0102" } });

    assert.deepEqual(await pending, Buffer.from([1, 2]));
    assert.equal(unsubscribed, true);
  });

  await t.test("ignores advertisements from a different device or without the target manufacturer ID", async () => {
    let deliver: ((adv: unknown) => void) | undefined;
    const bleApi = {
      onAdvertisement: (_pluginId: string, cb: (adv: unknown) => void) => {
        deliver = cb;
        return () => {};
      },
    } as unknown as BLEApi;

    const pending = bleApiBackend(bleApi, "my-plugin").waitForManufacturerData("AA:BB:CC:DD:EE:FF", 0x0157, 50);
    deliver!({ mac: "11:22:33:44:55:66", manufacturerData: { [0x0157]: "0102" } });
    deliver!({ mac: "AA:BB:CC:DD:EE:FF", manufacturerData: { 0x9999: "ff" } });

    assert.equal(await pending, undefined);
  });

  await t.test("resolves undefined and unsubscribes once the timeout elapses with nothing matching", async () => {
    let unsubscribed = false;
    const bleApi = {
      onAdvertisement: () => () => void (unsubscribed = true),
    } as unknown as BLEApi;

    assert.equal(await bleApiBackend(bleApi, "my-plugin").waitForManufacturerData("AA:BB:CC:DD:EE:FF", 0x0157, 20), undefined);
    assert.equal(unsubscribed, true);
  });
});
