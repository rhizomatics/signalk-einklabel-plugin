/**
 * Wire framing for `packing: "chunked"` devices (the 7.5"/10.2" panels).
 *
 * The vendor firmware's real format supports each 64-byte chunk being either a `0x75`-tagged
 * QuickLZ-compressed block or a `0x74`-tagged raw one - see hass-gicisky's `gicisky_ble/compression.py`,
 * which ports a vendor-specific 64-bucket-hash variant of QuickLZ Level 1 to produce the smaller
 * `0x75` form. This driver always emits the `0x74` raw form instead: larger over the wire, but the
 * framing itself (chunk headers, the part1/part2 split) is unchanged, so a device that accepts
 * hass-gicisky's output accepts this too - it just costs more BLE writes per repaint than a real
 * compressor would.
 */

const CHUNK_SIZE = 64;
const RAW_CHUNK_TAG = 0x74;

function chunkRaw(data: Buffer): Buffer {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.length));
    const header = Buffer.from([RAW_CHUNK_TAG, 3 + chunk.length, chunk.length]);
    chunks.push(header, chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Frames two equal-length bit-planes (e.g. BW and red) as `[4-byte LE length of planeB]` followed
 * by each plane's raw-chunked bytes, matching `compress()`'s output shape in the reference driver.
 */
export function frameChunkedPlanes(planeA: Buffer, planeB: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(planeB.length, 0);
  return Buffer.concat([header, chunkRaw(planeA), chunkRaw(planeB)]);
}
