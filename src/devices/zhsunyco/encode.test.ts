import test from "node:test";
import assert from "node:assert/strict";
import { encodeBitmap } from "./encode";
import { Bitmap } from "../../render/types";
import { Colour, DeviceMetadata } from "../types";

/** A 1x4 solid-colour bitmap - narrow enough that the whole encoded output is one byte, with the
 * same pixel colour packed into all four 2-bit slots, so the byte value alone identifies the code
 * `encodeBitmap` chose for that colour. */
function solidBitmap(r: number, g: number, b: number): Bitmap {
  const data = new Uint8Array(4 * 4);
  for (let i = 0; i < 4; i++) {
    data.set([r, g, b, 255], i * 4);
  }
  return { width: 1, height: 4, data };
}

function metadata(colours: Colour[]): DeviceMetadata {
  return { pid: 0, label: "test", width: 1, height: 4, voffset: 0, colours };
}

const YELLOWISH: [number, number, number] = [250, 200, 50];
const REDDISH: [number, number, number] = [200, 50, 50];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACKISH: [number, number, number] = [10, 10, 10];

test("encodeBitmap colour quantisation", async (t) => {
  await t.test("a yellow-ish pixel is sent as yellow on a BWRY panel", () => {
    const encoded = encodeBitmap(solidBitmap(...YELLOWISH), metadata(["black", "white", "red", "yellow"]));
    assert.equal(encoded[0], 0b10101010);
  });

  await t.test("a yellow-ish pixel falls back to red on a BWR-only panel", () => {
    const encoded = encodeBitmap(solidBitmap(...YELLOWISH), metadata(["black", "white", "red"]));
    assert.equal(encoded[0], 0b11111111);
  });

  await t.test("a yellow-ish pixel falls back through red to black on a black/white-only panel", () => {
    const encoded = encodeBitmap(solidBitmap(...YELLOWISH), metadata(["black", "white"]));
    assert.equal(encoded[0], 0b00000000);
  });

  await t.test("a red-ish pixel falls back to black on a black/white-only panel", () => {
    const encoded = encodeBitmap(solidBitmap(...REDDISH), metadata(["black", "white"]));
    assert.equal(encoded[0], 0b00000000);
  });

  await t.test("white and black are unaffected by a reduced palette", () => {
    const bwr = metadata(["black", "white", "red"]);
    assert.equal(encodeBitmap(solidBitmap(...WHITE), bwr)[0], 0b01010101);
    assert.equal(encodeBitmap(solidBitmap(...BLACKISH), bwr)[0], 0b00000000);
  });
});
