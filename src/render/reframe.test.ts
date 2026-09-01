import test from "node:test";
import assert from "node:assert/strict";
import { Bitmap } from "./types";
import { reframeBitmap } from "./reframe";

/** Builds a solid-colour bitmap, or (via `pixel(x, y)`) one where each pixel is coloured by its own coordinates - lets a test tell which source pixel ended up where. */
function makeBitmap(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set(pixel(x, y), offset);
    }
  }
  return { width, height, data };
}

function pixelAt(bitmap: Bitmap, x: number, y: number): [number, number, number, number] {
  const offset = (y * bitmap.width + x) * 4;
  return [bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], bitmap.data[offset + 3]];
}

test("reframeBitmap", async (t) => {
  await t.test("fixed mode never changes the bitmap, even when the size differs from the target", () => {
    const bitmap = makeBitmap(2, 2, () => [1, 2, 3, 4]);
    assert.equal(reframeBitmap(bitmap, 10, 10, "fixed"), bitmap);
  });

  await t.test("is a no-op under any mode once the size already matches the target", () => {
    const bitmap = makeBitmap(3, 3, () => [9, 9, 9, 9]);
    assert.equal(reframeBitmap(bitmap, 3, 3, "scale"), bitmap);
    assert.equal(reframeBitmap(bitmap, 3, 3, "crop"), bitmap);
  });

  await t.test("scale stretches a smaller source up to fill the target", () => {
    // left column red, right column blue
    const bitmap = makeBitmap(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const scaled = reframeBitmap(bitmap, 4, 1, "scale");
    assert.deepEqual(
      [0, 1, 2, 3].map((x) => pixelAt(scaled, x, 0)),
      [
        [255, 0, 0, 255],
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 255, 255],
      ],
    );
  });

  await t.test("scale shrinks a bigger source down to fit the target", () => {
    const bitmap = makeBitmap(4, 1, (x) => [x * 10, 0, 0, 255]);
    const scaled = reframeBitmap(bitmap, 2, 1, "scale");
    assert.equal(scaled.width, 2);
    assert.equal(scaled.height, 1);
  });

  await t.test("crop truncates a bigger source from the top-left, dropping the rest", () => {
    const bitmap = makeBitmap(4, 4, (x, y) => [x, y, 0, 255]);
    const cropped = reframeBitmap(bitmap, 2, 2, "crop");
    assert.equal(cropped.width, 2);
    assert.equal(cropped.height, 2);
    assert.deepEqual(pixelAt(cropped, 0, 0), [0, 0, 0, 255]);
    assert.deepEqual(pixelAt(cropped, 1, 1), [1, 1, 0, 255]);
  });

  await t.test("crop places a smaller source at the top-left and leaves the rest opaque white", () => {
    const bitmap = makeBitmap(1, 1, () => [0, 0, 0, 255]);
    const cropped = reframeBitmap(bitmap, 2, 2, "crop");
    assert.deepEqual(pixelAt(cropped, 0, 0), [0, 0, 0, 255]);
    assert.deepEqual(pixelAt(cropped, 1, 0), [255, 255, 255, 255]);
    assert.deepEqual(pixelAt(cropped, 0, 1), [255, 255, 255, 255]);
    assert.deepEqual(pixelAt(cropped, 1, 1), [255, 255, 255, 255]);
  });
});
