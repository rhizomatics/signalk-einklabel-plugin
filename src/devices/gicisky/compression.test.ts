import test from "node:test";
import assert from "node:assert/strict";
import { frameChunkedPlanes, qlzCompressChunk } from "./compression";

/**
 * Expected outputs are generated from hass-gicisky's own `gicisky_ble/compression.py` `compress()`
 * (which also round-trips each through its `decompress()`), on inputs rebuilt identically below -
 * the device firmware only decodes the vendor's exact hash variant, so byte-for-byte agreement with
 * a reference that's known to work on real panels is what matters here.
 */
function lcg(n: number, seed: number): Buffer {
  const out = Buffer.alloc(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    out[i] = (s >> 16) & 0xff;
  }
  return out;
}

function labelLike(n: number): Buffer {
  return Buffer.from(Array.from({ length: n }, (_, i) => ((i * 37) % 11 < 3 ? (i * 13) & 0xff : 0xff)));
}

const CASES: Record<string, { planeA: Buffer; planeB: Buffer; expected: string }> = {
  blank: {
    planeA: Buffer.alloc(256, 0xff),
    planeB: Buffer.alloc(256),
    expected:
      "0001000075124010000080ffffffff000038ffffffff75124010000080ffffffff000038ffffffff75124010000080ffffff" +
      "ff000038ffffffff75124010000080ffffffff000038ffffffff751240100000800000000000003800000000751240100000" +
      "800000000000003800000000751240100000800000000000003800000000751240100000800000000000003800000000",
  },
  labelLike: {
    planeA: labelLike(320),
    planeB: Buffer.from(Array.from({ length: 320 }, (_, i) => (Math.floor(i / 40) % 2) * 0x0f)),
    expected:
      "4001000074434000ffff27ffff4effffffff8fffffb6ffffddffffffff1effff45ffff6cffffffffadffffd4fffffbffffff" +
      "ff3cffff63ffff8affffffffcbfffff2ffff19ffff744340ffff5affff81ffffa8ffffffffe9ffff10ffff37ffffffff78ff" +
      "ff9fffffc6ffffffff07ffff2effff55ffffffff96ffffbdffffe4ffffffff25ffff4cffff73744340ffffffffb4ffffdbff" +
      "ff02ffffffff43ffff6affff91ffffffffd2fffff9ffff20ffffffff61ffff88ffffaffffffffff0ffff17ffff3effffffff" +
      "7fffffa6ff744340ffcdffffffff0effff35ffff5cffffffff9dffffc4ffffebffffffff2cffff53ffff7affffffffbbffff" +
      "e2ffff09ffffffff4affff71ffff98ffffffffd9ffff74434000ffff27ffffffff68ffff8fffffb6fffffffff7ffff1effff" +
      "45ffffffff86ffffadffffd4ffffffff15ffff3cffff63ffffffffa4ffffcbfffff2ffffffff337517401001008000000000" +
      "0000240f0f0fff030f0f0f0f751b40100100800f0f0f0ffa030000000000250f0f0f0f0f0f0f0f751840100100800f0f0f0f" +
      "f0031c00000000001900000000752340100100800000000002000f0f0ff00325000000000000000000000000000000007518" +
      "4010010080000000000000140f0f0ff003210f0f0f0f",
  },
  random: {
    planeA: lcg(128, 1),
    planeB: lcg(128, 2),
    expected:
      "80000000744340c67e816b4bfbe2fb54f6bddf7c1ce18701bf31de56720f4767668759aa883c59ea56137bd285a1d83c5455" +
      "2f37ae655bda027998cce31a768e5fd9998f1f3f36744340ee43784d0dfabea6dae4868edc296d4eff56e17020fb8fb15805" +
      "90c509dc53cdaa3b489952d3529d069feab5c206139849b2011eac3288319c52469571368f577443408c21ff72edd718d94e" +
      "139513dc1b63fc9306f6bf9ce506e06db00a059ff275878e34b3bcb32be202c0a1518c8023b9ec6d6f3d640e9c23ec170750" +
      "033f018536744340df3a5c714fec000900c7af8559a0f13053d8955fd38d7082ca83d5ed0fd1d364f74b3168bab32b44859e" +
      "e9d65e28c31ebc573788e250a6f9ff3cd19c07f71769",
  },
  runs: {
    planeA: Buffer.from([1, 2, 3, ...Array(30).fill(7), ...Array(10).fill([9, 8]).flat(), ...Array(11).fill(7)]),
    planeB: Buffer.alloc(64, 0x55),
    expected:
      "400000007533404000008001020307070770031b090809080908090809080908090809080908090807070707000000800707" +
      "0707070707751240100000805555555500003855555555",
  },
};

test("gicisky frameChunkedPlanes", async (t) => {
  for (const [name, { planeA, planeB, expected }] of Object.entries(CASES)) {
    await t.test(`matches hass-gicisky's compress() byte for byte: ${name}`, () => {
      assert.equal(frameChunkedPlanes(planeA, planeB).toString("hex"), expected);
    });
  }

  await t.test("compress=false sends every chunk raw (0x74)", () => {
    const plane = Buffer.alloc(128, 0xff);
    const framed = frameChunkedPlanes(plane, plane, false);
    assert.equal(framed.length, 4 + 4 * (3 + 64));
    for (let offset = 4; offset < framed.length; offset += 3 + 64) {
      assert.deepEqual([...framed.subarray(offset, offset + 3)], [0x74, 3 + 64, 64]);
    }
  });
});

test("qlzCompressChunk returns undefined when there's nothing to gain", () => {
  assert.equal(qlzCompressChunk(lcg(64, 3)), undefined);
  assert.equal(qlzCompressChunk(Buffer.alloc(10)), undefined);
});
