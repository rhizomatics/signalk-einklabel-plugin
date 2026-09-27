import { deflateRawSync } from "zlib";

/**
 * Wolink block-deflate payload format, ported from the `zhsunyco_esl` package bundled with the
 * Home Assistant Wolink ESL integration (`zhsunyco_esl/protocol.py`):
 *
 *   A5 A6 <blockCount u8> 02, then per block: <1-based index u8> <compressedLength u16le> <raw deflate>
 *
 * Each block holds up to 8 KB of the uncompressed 2bpp buffer. Sent in place of the raw buffer,
 * followed by `COMMAND.refreshCompressed` carrying the compressed length.
 */
const WOLINK_BLOCK_SIZE = 8192;
const WOLINK_BLOCK_FORMAT = 0x02;

export function compressWolinkBlocks(data: Buffer): Buffer {
  const blockCount = Math.ceil(data.length / WOLINK_BLOCK_SIZE);
  if (blockCount > 0xff) {
    throw new Error(`zhsunyco compression: ${data.length} bytes needs ${blockCount} blocks, format allows at most 255`);
  }
  const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, blockCount, WOLINK_BLOCK_FORMAT])];
  for (let i = 0; i < blockCount; i++) {
    const deflated = deflateRawSync(data.subarray(i * WOLINK_BLOCK_SIZE, (i + 1) * WOLINK_BLOCK_SIZE), { level: 9 });
    const header = Buffer.alloc(3);
    header[0] = i + 1;
    header.writeUInt16LE(deflated.length, 1);
    parts.push(header, deflated);
  }
  return Buffer.concat(parts);
}
