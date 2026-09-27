import test from "node:test";
import { inflateRawSync } from "zlib";
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
 * records every write and, once a final refresh command (compressed or not) lands on the data
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
      const command = charUuid === WOLINK_CHARACTERISTIC_UUIDS.data ? data.readUInt16LE(0) : undefined;
      if (command === COMMAND.refreshUncompressed || command === COMMAND.refreshCompressed) {
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
    // At least one uploadBlock chunk plus the final refresh command.
    assert.ok(dataWrites.length >= 2);
    assert.equal(dataWrites[dataWrites.length - 1].data.readUInt16LE(0), COMMAND.refreshCompressed);
  });

  await t.test("compresses by default: uploads a block-deflate payload and refreshes with its compressed length", async () => {
    const { conn, writes } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008));
    const driver = new ZhsunycoDriver();

    await driver.paint(tinyBlackBitmap(8), {
      address: "AA:BB:CC:DD:EE:FF",
      modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
      gattBackend: fakeBackend(conn),
    });

    const dataWrites = writes.filter((w) => w.charUuid === WOLINK_CHARACTERISTIC_UUIDS.data);
    const uploaded = Buffer.concat(dataWrites.slice(0, -1).map((w) => w.data.subarray(6)));
    const refresh = dataWrites[dataWrites.length - 1].data;
    assert.equal(refresh.readUInt32LE(2), uploaded.length);
    assert.deepEqual([...uploaded.subarray(0, 4)], [0xa5, 0xa6, 1, 0x02]);
    const blockLength = uploaded.readUInt16LE(5);
    // 8x8 all-black at 2bpp is 16 zero bytes.
    assert.deepEqual(inflateRawSync(uploaded.subarray(7, 7 + blockLength)), Buffer.alloc(16));
  });

  await t.test("sends the raw buffer with the uncompressed refresh when compress is false", async () => {
    const { conn, writes } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008));
    const driver = new ZhsunycoDriver();

    await driver.paint(tinyBlackBitmap(8), {
      address: "AA:BB:CC:DD:EE:FF",
      modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
      compress: false,
      gattBackend: fakeBackend(conn),
    });

    const dataWrites = writes.filter((w) => w.charUuid === WOLINK_CHARACTERISTIC_UUIDS.data);
    const refresh = dataWrites[dataWrites.length - 1].data;
    assert.equal(refresh.readUInt16LE(0), COMMAND.refreshUncompressed);
    assert.equal(refresh.readUInt32LE(2), 16);
    assert.deepEqual(dataWrites[0].data.subarray(6), Buffer.alloc(16));
  });

  await t.test("reports each step through the log hook, so a stalled paint shows where it stopped", async () => {
    const { conn } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008));
    const steps: string[] = [];

    await new ZhsunycoDriver().paint(tinyBlackBitmap(8), {
      address: "AA:BB:CC:DD:EE:FF",
      modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
      gattBackend: fakeBackend(conn),
      log: (message) => steps.push(message),
    });

    assert.deepEqual(
      steps.map((step) => step.split(" ")[0]),
      ["connecting", "connected", "authenticated", "uploading", "refresh", "label"],
    );
    assert.equal(steps[steps.length - 1], "label reported the paint complete");
  });

  await t.test("logs the services it can see when the label's own service is missing", async () => {
    const { conn } = fakeZhsunycoConnection(fakeConfigBuffer(0x0008));
    const missing = {
      ...conn,
      read: async () => {
        throw new Error("Service not available");
      },
      discoverServices: async () => [{ uuid: "00001800-0000-1000-8000-00805f9b34fb", characteristics: [] }],
      disconnect: async () => {},
    } as unknown as GattConnection;
    const steps: string[] = [];

    await assert.rejects(
      new ZhsunycoDriver().paint(tinyBlackBitmap(8), {
        address: "AA:BB:CC:DD:EE:FF",
        gattBackend: fakeBackend(missing),
        log: (message) => steps.push(message),
      }),
      /Service not available/,
    );
    assert.match(steps[steps.length - 1], /services visible on this connection: 00001800-0000-1000-8000-00805f9b34fb$/);
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
