import test from "node:test";
import assert from "node:assert/strict";
import { ZhsunycoDriver } from "./index";
import { GattConnection } from "../gattConnection";
import { BleBackend } from "../bleBackend";
import { Bitmap } from "../../render/types";
import { COMMAND, WOLINK_CHARACTERISTIC_UUIDS, ZHSUNYCO_MANUFACTURER_ID } from "./protocol";

function tinyBlackBitmap(size: number): Bitmap {
  return { width: size, height: size, data: new Uint8Array(size * size * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
}

function fakeConfigBuffer(pid: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeUInt16BE(pid, 2);
  buf.writeUInt16BE(1, 4);
  buf.writeUInt16BE(1, 6);
  return buf;
}

/**
 * Simulates a zhsunyco device: `read()` answers config/auth-challenge/battery reads, `write()`
 * records every write and, once the final `refreshUncompressed` command lands on the data
 * characteristic, delivers a status notification to whatever `startNotifications` callback is
 * currently registered on the status characteristic - exercises the persistent-callback status wait
 * (`GattConnection`'s shape) in place of node-ble's per-call `.once("valuechanged")`.
 */
function fakeZhsunycoConnection(
  configBuffer: Buffer,
  options: { challenge?: Buffer; batteryMv?: number; statusErrorCode?: number } = {},
): { conn: GattConnection; writes: { charUuid: string; data: Buffer; withResponse?: boolean }[] } {
  const challenge = options.challenge ?? Buffer.alloc(16, 0x42);
  const batteryBuf = Buffer.alloc(2);
  batteryBuf.writeUInt16BE(options.batteryMv ?? 3700);
  const writes: { charUuid: string; data: Buffer; withResponse?: boolean }[] = [];
  let statusCallback: ((data: Buffer) => void) | undefined;

  const conn: GattConnection = {
    discoverServices: async () => [],
    read: async (_service: string, charUuid: string) => {
      if (charUuid === WOLINK_CHARACTERISTIC_UUIDS.config) return configBuffer;
      if (charUuid === WOLINK_CHARACTERISTIC_UUIDS.authenticate) return challenge;
      if (charUuid === WOLINK_CHARACTERISTIC_UUIDS.battery) return batteryBuf;
      throw new Error(`unexpected read on ${charUuid}`);
    },
    write: async (_service: string, charUuid: string, data: Buffer, withResponse?: boolean) => {
      writes.push({ charUuid, data: Buffer.from(data), withResponse });
      if (charUuid === WOLINK_CHARACTERISTIC_UUIDS.data && data.readUInt16LE(0) === COMMAND.refreshUncompressed) {
        queueMicrotask(() => statusCallback?.(Buffer.from([0x00, options.statusErrorCode ?? 0x00])));
      }
    },
    startNotifications: async (_service: string, charUuid: string, callback: (data: Buffer) => void) => {
      if (charUuid === WOLINK_CHARACTERISTIC_UUIDS.status) statusCallback = callback;
    },
    stopNotifications: async () => {
      statusCallback = undefined;
    },
    disconnect: async () => {},
    connected: true,
    onDisconnect: () => {},
  } as unknown as GattConnection;

  return { conn, writes };
}

function fakeBackend(conn: GattConnection): BleBackend {
  return {
    connectGatt: async () => conn,
    waitForManufacturerData: async () => undefined,
  };
}

test("ZhsunycoDriver.paint", async (t) => {
  await t.test("authenticates, uploads the image, and completes once the device reports success", async () => {
    const { conn, writes } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008));
    const driver = new ZhsunycoDriver();

    await driver.paint(tinyBlackBitmap(8), {
      address: "AA:BB:CC:DD:EE:FF",
      modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
      gattBackend: fakeBackend(conn),
    });

    const authWrites = writes.filter((w) => w.charUuid === WOLINK_CHARACTERISTIC_UUIDS.authenticate);
    const dataWrites = writes.filter((w) => w.charUuid === WOLINK_CHARACTERISTIC_UUIDS.data);
    assert.equal(authWrites.length, 1);
    assert.equal(authWrites[0].withResponse, false);
    // At least one uploadBlock chunk plus the final refreshUncompressed command.
    assert.ok(dataWrites.length >= 2);
    assert.equal(dataWrites[dataWrites.length - 1].data.readUInt16LE(0), COMMAND.refreshUncompressed);
  });

  await t.test("throws when the device reports an error status after refresh", async () => {
    const { conn } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008), { statusErrorCode: 0x01 });
    const driver = new ZhsunycoDriver();

    await assert.rejects(
      driver.paint(tinyBlackBitmap(8), {
        address: "AA:BB:CC:DD:EE:FF",
        modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
        gattBackend: fakeBackend(conn),
      }),
      /reported error 0x01/,
    );
  });

  await t.test("throws for an unrecognised PID with no modelOverride to fall back on", async () => {
    const { conn } = fakeZhsunycoConnection(fakeConfigBuffer(0xffff));
    const driver = new ZhsunycoDriver();

    await assert.rejects(
      driver.paint(tinyBlackBitmap(8), { address: "AA:BB:CC:DD:EE:FF", gattBackend: fakeBackend(conn) }),
      /unrecognised PID/,
    );
  });
});

test("ZhsunycoDriver.identifyDevice", async (t) => {
  await t.test("reads battery over a live connection and keeps the advertisement's PID", async () => {
    const driver = new ZhsunycoDriver();
    const manufacturerData = fakeConfigBuffer(0x0008);
    const { conn } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008), { batteryMv: 4100 });

    const found = await driver.identifyDevice(
      { address: "AA:BB:CC:DD:EE:FF", name: "WL-test", manufacturerId: ZHSUNYCO_MANUFACTURER_ID, manufacturerData, rssi: -55 },
      async () => conn,
    );

    assert.equal(found.pid, 0x0008);
    assert.equal(found.rssi, -55);
    assert.equal(found.batteryMv, 4100);
  });

  await t.test("falls back to the advertisement alone (no battery) when the connect for it fails", async () => {
    const driver = new ZhsunycoDriver();
    const manufacturerData = fakeConfigBuffer(0x0008);

    const found = await driver.identifyDevice(
      { address: "AA:BB:CC:DD:EE:FF", name: "WL-test", manufacturerId: ZHSUNYCO_MANUFACTURER_ID, manufacturerData, rssi: -55 },
      async () => {
        throw new Error("device busy elsewhere");
      },
    );

    assert.equal(found.pid, 0x0008);
    assert.equal(found.batteryMv, undefined);
  });
});
