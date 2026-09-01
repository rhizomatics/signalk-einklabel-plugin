import test from "node:test";
import assert from "node:assert/strict";
import { decodeAdvertisedInfo, decodeBlockSize, decodeTransferAck, imageChunkPacket, writeScreenCommand } from "./protocol";

test("gicisky protocol", async (t) => {
  await t.test("decodeAdvertisedInfo parses a 5-byte manufacturer-data payload", () => {
    const info = decodeAdvertisedInfo(Buffer.from([0x33, 30, 0x01, 0x40, 0x00]));
    assert.deepEqual(info, { deviceId: 0x0033, hardware: 0x0033, firmware: 0x0140, batteryMv: 3000 });
  });

  await t.test("decodeAdvertisedInfo masks the high bits of the deviceId", () => {
    // hardware = (0xC0 << 8) | 0x2e = 0xC02E; masked to 14 bits -> 0x002E.
    const info = decodeAdvertisedInfo(Buffer.from([0x2e, 25, 0x00, 0x00, 0xc0]));
    assert.equal(info?.deviceId, 0x002e);
    assert.equal(info?.hardware, 0xc02e);
  });

  await t.test("decodeAdvertisedInfo rejects a payload of the wrong length", () => {
    assert.equal(decodeAdvertisedInfo(Buffer.from([1, 2, 3, 4])), undefined);
  });

  await t.test("decodeBlockSize reads the LE16 block size out of a requestBlockSize ack", () => {
    assert.equal(decodeBlockSize(Buffer.from([0x01, 0xf4, 0x00])), 244);
  });

  await t.test("decodeBlockSize rejects an ack for a different command", () => {
    assert.equal(decodeBlockSize(Buffer.from([0x02, 0x00])), undefined);
  });

  await t.test("writeScreenCommand builds a plain 8-byte packet for non-chunked devices", () => {
    assert.deepEqual([...writeScreenCommand(100, false)], [0x02, 100, 0, 0, 0, 0, 0, 0]);
  });

  await t.test("writeScreenCommand builds a 6-byte packet with the chunked flag for compression2 devices", () => {
    assert.deepEqual([...writeScreenCommand(100, true)], [0x02, 100, 0, 0, 0, 0x01]);
  });

  await t.test("imageChunkPacket prefixes the chunk with a 4-byte LE part index", () => {
    assert.deepEqual([...imageChunkPacket(2, Buffer.from([0xaa, 0xbb]))], [2, 0, 0, 0, 0xaa, 0xbb]);
  });

  await t.test("decodeTransferAck reads success and next-part out of a transfer ack", () => {
    assert.deepEqual(decodeTransferAck(Buffer.from([0x05, 0x00, 10, 0, 0, 0])), { ok: true, nextPart: 10 });
    assert.deepEqual(decodeTransferAck(Buffer.from([0x05, 0x01, 0, 0, 0, 0])), { ok: false, nextPart: 0 });
  });

  await t.test("decodeTransferAck rejects a too-short or wrongly-tagged ack", () => {
    assert.equal(decodeTransferAck(Buffer.from([0x05, 0x00])), undefined);
    assert.equal(decodeTransferAck(Buffer.from([0x02, 0x00, 0, 0, 0, 0])), undefined);
  });
});
