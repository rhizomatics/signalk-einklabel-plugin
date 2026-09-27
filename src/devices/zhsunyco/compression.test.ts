import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "zlib";
import { compressWolinkBlocks } from "./compression";

/** Walks the block framing back apart and inflates each block - the inverse the device firmware performs. */
function decompress(payload: Buffer): { blockCount: number; indices: number[]; data: Buffer } {
  assert.deepEqual([...payload.subarray(0, 2)], [0xa5, 0xa6]);
  assert.equal(payload[3], 0x02);
  const blockCount = payload[2];
  const indices: number[] = [];
  const blocks: Buffer[] = [];
  let offset = 4;
  for (let i = 0; i < blockCount; i++) {
    indices.push(payload[offset]);
    const length = payload.readUInt16LE(offset + 1);
    blocks.push(inflateRawSync(payload.subarray(offset + 3, offset + 3 + length)));
    offset += 3 + length;
  }
  assert.equal(offset, payload.length);
  return { blockCount, indices, data: Buffer.concat(blocks) };
}

test("compressWolinkBlocks", async (t) => {
  await t.test("round-trips a buffer spanning several 8 KB blocks, with 1-based indices", () => {
    // 416x240 at 2bpp - the confirmed 3.7" panel's buffer size, 4 blocks (the last one partial).
    const raw = Buffer.alloc(24960, 0x55);
    raw.fill(0x00, 1000, 3000);
    const { blockCount, indices, data } = decompress(compressWolinkBlocks(raw));
    assert.equal(blockCount, 4);
    assert.deepEqual(indices, [1, 2, 3, 4]);
    assert.deepEqual(data, raw);
  });

  await t.test("shrinks a mostly-blank label buffer substantially", () => {
    const raw = Buffer.alloc(24960, 0x55);
    assert.ok(compressWolinkBlocks(raw).length < raw.length / 20);
  });

  await t.test("emits a single block for a buffer under 8 KB", () => {
    const raw = Buffer.from([1, 2, 3, 4, 5]);
    const { blockCount, data } = decompress(compressWolinkBlocks(raw));
    assert.equal(blockCount, 1);
    assert.deepEqual(data, raw);
  });
});
