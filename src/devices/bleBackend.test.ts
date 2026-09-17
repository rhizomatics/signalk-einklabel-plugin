import test from "node:test";
import assert from "node:assert/strict";
import { BLEApi, BLEGattConnection } from "@signalk/server-api";
import { bleApiBackend } from "./bleBackend";

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
    const conn = fakeGattConnection();
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
    assert.equal(result, conn);
    assert.deepEqual(calls, ["release:AA:BB:CC:DD:EE:FF:my-plugin", "connect:AA:BB:CC:DD:EE:FF:my-plugin"]);
  });

  await t.test("proceeds even when releasing a stale claim fails (nothing to release)", async () => {
    const conn = fakeGattConnection();
    const bleApi = {
      releaseGATTDevice: async () => {
        throw new Error("not claimed");
      },
      connectGATT: async () => conn,
    } as unknown as BLEApi;

    assert.equal(await bleApiBackend(bleApi, "my-plugin").connectGatt("AA:BB:CC:DD:EE:FF", 1000), conn);
  });

  await t.test("rejects once the timeout elapses, then disconnects the connection if it resolves later", async () => {
    let disconnected = false;
    let resolveConnect: (conn: BLEGattConnection) => void;
    const bleApi = {
      releaseGATTDevice: async () => {},
      connectGATT: () =>
        new Promise<BLEGattConnection>((resolve) => {
          resolveConnect = resolve;
        }),
    } as unknown as BLEApi;

    await assert.rejects(bleApiBackend(bleApi, "my-plugin").connectGatt("AA:BB:CC:DD:EE:FF", 20), /timed out after 20ms/);

    resolveConnect!(fakeGattConnection({ disconnect: async () => void (disconnected = true) }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(disconnected, true);
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
