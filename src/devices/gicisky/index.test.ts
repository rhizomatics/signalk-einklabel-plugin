import test from "node:test";
import assert from "node:assert/strict";
import { GiciskyDriver } from "./index";
import { GattConnection } from "../gattConnection";
import { BleBackend } from "../bleBackend";
import { Bitmap } from "../../render/types";
import { GICISKY_MANUFACTURER_ID, decodeAdvertisedInfo } from "./protocol";

const CMD_SERVICE = "0000fef0-0000-1000-8000-00805f9b34fb";
const CMD_CHAR = "0000fef1-0000-1000-8000-00805f9b34fb";
const IMG_CHAR = "0000fef2-0000-1000-8000-00805f9b34fb";

/**
 * Simulates a gicisky device's ack-per-write protocol: `write()` looks at what was just written and
 * schedules the matching notification on whatever `startNotifications` callback is currently
 * registered - mirrors the real device's behaviour closely enough to exercise `AckChannel`'s
 * single-slot dispatch and the chunked-transfer loop in `paint()` without a real GATT connection.
 */
function fakeGiciskyConnection(deviceChunkSize: number): { conn: GattConnection; writes: { charUuid: string; data: Buffer }[] } {
  const writes: { charUuid: string; data: Buffer }[] = [];
  let notify: ((data: Buffer) => void) | undefined;
  let nextPart = 0;

  const conn: GattConnection = {
    discoverServices: async () => [
      {
        uuid: CMD_SERVICE,
        characteristics: [
          { uuid: CMD_CHAR, properties: [] },
          { uuid: IMG_CHAR, properties: [] },
        ],
      },
    ],
    startNotifications: async (_service: string, _char: string, callback: (data: Buffer) => void) => {
      notify = callback;
    },
    stopNotifications: async () => {
      notify = undefined;
    },
    write: async (_service: string, charUuid: string, data: Buffer) => {
      writes.push({ charUuid, data: Buffer.from(data) });
      queueMicrotask(() => {
        if (charUuid === CMD_CHAR && data[0] === 0x01) {
          const ack = Buffer.alloc(3);
          ack[0] = 0x01;
          ack.writeUInt16LE(deviceChunkSize, 1);
          notify?.(ack);
        } else if (charUuid === CMD_CHAR && data[0] === 0x02) {
          notify?.(Buffer.from([0x02, 0x00]));
        } else if (charUuid === CMD_CHAR && data[0] === 0x03) {
          nextPart = 0;
          const ack = Buffer.alloc(6);
          ack[0] = 0x05;
          ack.writeUInt32LE(nextPart, 2);
          notify?.(ack);
        } else if (charUuid === IMG_CHAR) {
          nextPart += 1;
          const ack = Buffer.alloc(6);
          ack[0] = 0x05;
          ack.writeUInt32LE(nextPart, 2);
          notify?.(ack);
        }
      });
    },
    read: async () => Buffer.from([]),
    disconnect: async () => {},
    connected: true,
    onDisconnect: () => {},
  } as unknown as GattConnection;

  return { conn, writes };
}

function fakeBackend(conn: GattConnection, manufacturerData: Buffer | undefined = undefined): BleBackend {
  return {
    connectGatt: async () => conn,
    waitForManufacturerData: async () => manufacturerData,
  };
}

function tinyBlackBitmap(size: number): Bitmap {
  return { width: size, height: size, data: new Uint8Array(size * size * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
}

test("GiciskyDriver.paint", async (t) => {
  await t.test("uploads the encoded image in chunks and completes once the device acks the last part", async () => {
    const { conn, writes } = fakeGiciskyConnection(4 + 4); // header(4) + 4 bytes/chunk
    const driver = new GiciskyDriver();

    await driver.paint(tinyBlackBitmap(8), {
      address: "AA:BB:CC:DD:EE:FF",
      modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
      gattBackend: fakeBackend(conn),
    });

    const requestBlockSize = writes.filter((w) => w.charUuid === CMD_CHAR && w.data[0] === 0x01);
    const writeScreen = writes.filter((w) => w.charUuid === CMD_CHAR && w.data[0] === 0x02);
    const startTransfer = writes.filter((w) => w.charUuid === CMD_CHAR && w.data[0] === 0x03);
    const chunks = writes.filter((w) => w.charUuid === IMG_CHAR);

    assert.equal(requestBlockSize.length, 1);
    assert.equal(writeScreen.length, 1);
    assert.equal(startTransfer.length, 1);
    // An 8x8 BW bitmap packs to 8 bytes (1 bit/pixel, 8 px/row/byte) - at 4 payload bytes/chunk that's 2 chunks.
    assert.equal(chunks.length, 2);
    // Each image-data packet is a 4-byte LE part index followed by its chunk.
    assert.equal(chunks[0].data.readUInt32LE(0), 0);
    assert.equal(chunks[1].data.readUInt32LE(0), 1);
  });

  await t.test("throws when the device stalls, repeatedly re-requesting the same part", async () => {
    const { conn } = fakeGiciskyConnection(4 + 4);
    // Force the fake device to keep re-acking part 0 forever by overriding its write behaviour.
    let notify: ((data: Buffer) => void) | undefined;
    const stallingConn: GattConnection = {
      ...conn,
      startNotifications: async (_service: string, _char: string, callback: (data: Buffer) => void) => {
        notify = callback;
      },
      write: async (_service: string, charUuid: string, data: Buffer) => {
        queueMicrotask(() => {
          if (charUuid === CMD_CHAR && data[0] === 0x01) {
            const ack = Buffer.alloc(3);
            ack[0] = 0x01;
            ack.writeUInt16LE(8, 1);
            notify?.(ack);
          } else if (charUuid === CMD_CHAR && data[0] === 0x03) {
            const ack = Buffer.alloc(6);
            ack[0] = 0x05;
            ack.writeUInt32LE(0, 2);
            notify?.(ack);
          } else {
            const ack = Buffer.alloc(6);
            ack[0] = 0x05;
            ack.writeUInt32LE(0, 2); // always re-requests part 0
            notify?.(ack);
          }
        });
      },
    } as unknown as GattConnection;

    const driver = new GiciskyDriver();
    await assert.rejects(
      driver.paint(tinyBlackBitmap(8), {
        address: "AA:BB:CC:DD:EE:FF",
        modelOverride: { label: "test", width: 8, height: 8, voffset: 0, colours: ["black", "white"] },
        gattBackend: fakeBackend(stallingConn),
      }),
      /image transfer stalled/,
    );
  });

  await t.test("throws with a helpful message when no advertisement and no modelOverride are available", async () => {
    const { conn } = fakeGiciskyConnection(8);
    const driver = new GiciskyDriver();
    await assert.rejects(
      driver.paint(tinyBlackBitmap(8), { address: "AA:BB:CC:DD:EE:FF", gattBackend: fakeBackend(conn, undefined) }),
      /isn't advertising/,
    );
  });
});

test("GiciskyDriver.identifyDevice", async (t) => {
  await t.test("decodes advertised manufacturer data without connecting", async () => {
    const driver = new GiciskyDriver();
    // deviceId 0x0028 ("2.9\" BW"): hardware = (data[4]<<8)|data[0], deviceId = hardware & 0x3fff.
    const manufacturerData = Buffer.from([0x28, 50, 0, 0, 0]);
    const info = decodeAdvertisedInfo(manufacturerData);
    assert.equal(info?.deviceId, 0x0028);

    const found = await driver.identifyDevice({
      address: "AA:BB:CC:DD:EE:FF",
      name: "gicisky",
      manufacturerId: GICISKY_MANUFACTURER_ID,
      manufacturerData,
      rssi: -60,
    });

    assert.equal(found.pid, 0x0028);
    assert.equal(found.metadata?.label, '2.9" BW');
    assert.equal(found.batteryMv, 5000);
    assert.equal(found.rssi, -60);
  });
});
