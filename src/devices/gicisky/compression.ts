/**
 * Wire framing for `packing: "chunked"` devices (the 7.5"/10.2" panels).
 *
 * Each 64-byte chunk of a plane is sent either as a `0x75`-tagged QuickLZ-compressed block or a
 * `0x74`-tagged raw one, whichever the compressor decides - a port of hass-gicisky's
 * `gicisky_ble/compression.py`. That's QuickLZ Level 1, but with the vendor firmware's 6-bit
 * (64-bucket) hash rather than stock QuickLZ's 12-bit one: match tokens carry a hash-table slot, not
 * an offset, and the panel's decoder only ever fills 64 slots - a token naming a slot above that
 * reads one that was never written and silently decodes garbage. So this must stay byte-compatible
 * with the vendor's hash, not just any valid QuickLZ.
 *
 * One deliberate difference from hass-gicisky: `UNCONDITIONAL_MATCHLEN` is stock QuickLZ's 6, not
 * its 12, so matches may start closer to a chunk's end. That's what the vendor's own app does - with
 * 6 this reproduces 483 of the 486 distinct `0x75` chunks in Cabalist's BLE captures of the app
 * (https://github.com/Cabalist/gicisky_image_notes) byte for byte, against 408 with 12. The other 3
 * are chunks the app sends "compressed" despite them growing; this sends those raw (`0x74`) instead.
 */

const CHUNK_SIZE = 64;
const RAW_CHUNK_TAG = 0x74;
const COMPRESSED_CHUNK_TAG = 0x75;

const CWORD_LEN = 4;
const HASH_VALUES = 64;
const NO_ENTRY = -1;
const MIN_OFFSET = 2;
const UNCONDITIONAL_MATCHLEN = 6;
const UNCOMPRESSED_END = 4;
/** Control-word sentinel: the top bit marks where the 31 flag bits below it run out. */
const CWORD_SENTINEL = 0x80000000;

function hashOf(fetch: number): number {
  return ((fetch >>> 12) ^ fetch) & (HASH_VALUES - 1);
}

function read3(data: Buffer, pos: number): number {
  return pos + 3 > data.length ? 0 : data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16);
}

/** Whether the `n + 1` bytes from `pos` are all equal. */
function allSame(data: Buffer, pos: number, n: number): boolean {
  if (pos < 0 || pos + n >= data.length) return false;
  for (let i = 1; i <= n; i++) {
    if (data[pos + i] !== data[pos]) return false;
  }
  return true;
}

/**
 * QuickLZ L1 compression of one chunk, mirroring `_qlz_compress_core` step for step (including its
 * quirks, e.g. the run-of-identical-bytes special case) so the output matches the vendor app's byte for
 * byte. Returns `undefined` when compressing wouldn't save anything.
 */
export function qlzCompressChunk(source: Buffer): Buffer | undefined {
  const size = source.length;
  const lastByte = size - 1;
  const lastMatchStart = lastByte - UNCONDITIONAL_MATCHLEN - UNCOMPRESSED_END;
  if (lastMatchStart < 0) return undefined;

  const out = Buffer.alloc(size * 2 + 400);
  let cwordPtr = 0;
  let dst = CWORD_LEN;
  let cword = CWORD_SENTINEL;
  let src = 0;
  let lits = 0;
  const hashOffset = new Int32Array(HASH_VALUES).fill(NO_ENTRY);
  const hashCache = new Int32Array(HASH_VALUES);

  const flushCword = () => {
    out.writeUInt32LE(((cword >>> 1) | CWORD_SENTINEL) >>> 0, cwordPtr);
    cwordPtr = dst;
    dst += CWORD_LEN;
    cword = CWORD_SENTINEL;
  };

  while (src <= lastMatchStart) {
    if ((cword & 1) === 1) {
      if (src > size >> 1 && dst > src - (src >> 5)) return undefined;
      flushCword();
    }

    const fetch = read3(source, src);
    const h = hashOf(fetch);
    const cached = fetch ^ hashCache[h];
    hashCache[h] = fetch;
    const o = hashOffset[h];
    hashOffset[h] = src;

    if (
      (cached & 0xffffff) === 0 &&
      o !== NO_ENTRY &&
      (src - o > MIN_OFFSET || (src === o + 1 && lits >= 3 && src > 3 && allSame(source, src - 3, 6)))
    ) {
      let matchLen = 3;
      const remaining = Math.min(255, lastByte - UNCOMPRESSED_END - src + 1);
      while (matchLen < remaining && source[src + matchLen] === source[o + matchLen]) matchLen++;

      const hShifted = h << 4;
      cword = ((cword >>> 1) | CWORD_SENTINEL) >>> 0;
      if (matchLen < 18) {
        out.writeUInt16LE((matchLen - 2) | hShifted, dst);
        dst += 2;
      } else {
        out.writeUInt16LE(hShifted, dst);
        out[dst + 2] = matchLen;
        dst += 3;
      }
      src += matchLen;
      lits = 0;
    } else {
      lits++;
      out[dst++] = source[src++];
      cword >>>= 1;
    }
  }

  while (src <= lastByte) {
    if ((cword & 1) === 1) flushCword();
    if (src <= lastByte - 2) {
      const f = read3(source, src);
      const hh = hashOf(f);
      hashCache[hh] = f;
      hashOffset[hh] = src;
    }
    out[dst++] = source[src++];
    cword >>>= 1;
  }

  while ((cword & 1) !== 1) cword >>>= 1;
  out.writeUInt32LE(((cword >>> 1) | CWORD_SENTINEL) >>> 0, cwordPtr);

  return dst >= size ? undefined : out.subarray(0, dst);
}

function chunkPlane(data: Buffer, compress: boolean): Buffer {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.length));
    const compressed = compress ? qlzCompressChunk(chunk) : undefined;
    const body = compressed ?? chunk;
    chunks.push(Buffer.from([compressed ? COMPRESSED_CHUNK_TAG : RAW_CHUNK_TAG, 3 + body.length, chunk.length]), body);
  }
  return Buffer.concat(chunks);
}

/**
 * Frames two equal-length bit-planes (e.g. BW and red) as `[4-byte LE length of planeB]` followed
 * by each plane's chunked bytes, matching `compress()`'s output shape in the reference driver.
 * `compress: false` sends every chunk raw (`0x74`), like hass-gicisky's `force_raw`.
 */
export function frameChunkedPlanes(planeA: Buffer, planeB: Buffer, compress = true): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(planeB.length, 0);
  return Buffer.concat([header, chunkPlane(planeA, compress), chunkPlane(planeB, compress)]);
}
