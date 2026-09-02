import test from "node:test";
import assert from "node:assert/strict";
import { encodeBitmap } from "./encode";
import { Bitmap } from "../../render/types";
import { Colour, DeviceMetadata } from "../types";
import { GiciskyLayout } from "./layout";

const BLACK: [number, number, number] = [10, 10, 10];
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [200, 30, 30];
const YELLOW: [number, number, number] = [240, 210, 40];

function bitmap(width: number, height: number, pixels: [number, number, number, number?][]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  pixels.forEach(([r, g, b, a = 255], i) => data.set([r, g, b, a], i * 4));
  return { width, height, data };
}

function metadata(width: number, height: number, colours: Colour[]): DeviceMetadata {
  return { pid: 0, label: "test", width, height, voffset: 0, colours };
}

const PLAIN: GiciskyLayout = { rotation: 0, mirrorX: false, mirrorY: false, invertLuminance: false, fourColour: false, packing: "plain" };

test("gicisky encodeBitmap", async (t) => {
  await t.test("packs a BW plane MSB-first, 8 pixels/row/byte", () => {
    const bmp = bitmap(8, 1, [WHITE, BLACK, WHITE, BLACK, WHITE, BLACK, WHITE, BLACK]);
    const encoded = encodeBitmap(bmp, metadata(8, 1, ["black", "white"]), PLAIN);
    assert.equal(encoded.length, 1);
    assert.equal(encoded[0], 0b10101010);
  });

  await t.test("rotates 90 degrees counter-clockwise before packing", () => {
    // A 2x1 source (left=black, right=white) rotated 90 CCW becomes a 1x2 column: top=white, bottom=black.
    const bmp = bitmap(2, 1, [BLACK, WHITE]);
    const layout: GiciskyLayout = { ...PLAIN, rotation: 90 };
    const encoded = encodeBitmap(bmp, metadata(2, 1, ["black", "white"]), layout);
    assert.deepEqual([...encoded], [0b10000000, 0b00000000]);
  });

  await t.test("packs BW and red as two concatenated planes for a BWR device", () => {
    const bmp = bitmap(3, 1, [BLACK, WHITE, RED]);
    const encoded = encodeBitmap(bmp, metadata(3, 1, ["black", "white", "red"]), PLAIN);
    assert.deepEqual([...encoded], [0b01000000, 0b00100000]);
  });

  await t.test("packs a four-colour panel as 2 bits/pixel, 4 pixels/byte", () => {
    const bmp = bitmap(4, 1, [BLACK, WHITE, YELLOW, RED]);
    const layout: GiciskyLayout = { ...PLAIN, fourColour: true };
    const encoded = encodeBitmap(bmp, metadata(4, 1, ["black", "white", "red", "yellow"]), layout);
    assert.equal(encoded.length, 1);
    assert.equal(encoded[0], 0b00_01_10_11);
  });

  await t.test("invertLuminance swaps which pixels set the white bit", () => {
    const bmp = bitmap(2, 1, [BLACK, WHITE]);
    const layout: GiciskyLayout = { ...PLAIN, invertLuminance: true };
    const encoded = encodeBitmap(bmp, metadata(2, 1, ["black", "white"]), layout);
    // Normally white sets the bit; inverted, black does instead.
    assert.equal(encoded[0], 0b10000000);
  });

  await t.test("frames chunked (compression2) devices as [4B planeB length][0x74 chunk][0x74 chunk]", () => {
    const bmp = bitmap(8, 1, [WHITE, BLACK, BLACK, RED, BLACK, BLACK, BLACK, BLACK]);
    const layout: GiciskyLayout = { ...PLAIN, packing: "chunked" };
    const encoded = encodeBitmap(bmp, metadata(8, 1, ["black", "white", "red"]), layout);
    assert.deepEqual([...encoded], [1, 0, 0, 0, 0x74, 4, 1, 0b10000000, 0x74, 4, 1, 0b00010000]);
  });

  await t.test("throws for a device layout marked unsupported", () => {
    const layout: GiciskyLayout = { ...PLAIN, packing: "unsupported" };
    assert.throws(() => encodeBitmap(bitmap(1, 1, [BLACK]), metadata(1, 1, ["black", "white"]), layout));
  });

  await t.test("throws when the bitmap doesn't match the device's declared size", () => {
    assert.throws(() => encodeBitmap(bitmap(1, 1, [BLACK]), metadata(2, 2, ["black", "white"]), PLAIN));
  });

  await t.test("a mostly-transparent pixel is sent as white (blank paper), not black - undrawn SVG canvas is RGB (0,0,0) but not meant as ink", () => {
    const bmp = bitmap(2, 1, [[0, 0, 0, 0], WHITE]);
    const encoded = encodeBitmap(bmp, metadata(2, 1, ["black", "white"]), PLAIN);
    // Both pixels set the white-plane bit: the transparent one via the alpha check, the other via its own RGB.
    assert.equal(encoded[0], 0b11000000);
  });
});
