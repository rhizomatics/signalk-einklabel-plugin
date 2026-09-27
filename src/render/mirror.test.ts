import test from "node:test";
import assert from "node:assert/strict";
import { Bitmap } from "./types";
import { mirrorBitmap } from "./mirror";

/** 3x2 bitmap whose red channel encodes each pixel's own index (y * 3 + x), so a test can tell which source pixel ended up where. */
function indexedBitmap(): Bitmap {
  const data = new Uint8Array(3 * 2 * 4);
  for (let i = 0; i < 6; i++) data.set([i, 0, 0, 255], i * 4);
  return { width: 3, height: 2, data };
}

function redChannel(bitmap: Bitmap): number[] {
  return Array.from({ length: bitmap.width * bitmap.height }, (_, i) => bitmap.data[i * 4]);
}

test("mirrorBitmap", async (t) => {
  await t.test("none returns the same bitmap", () => {
    const bitmap = indexedBitmap();
    assert.equal(mirrorBitmap(bitmap, "none"), bitmap);
  });

  await t.test("horizontal flips each row", () => {
    assert.deepEqual(redChannel(mirrorBitmap(indexedBitmap(), "horizontal")), [2, 1, 0, 5, 4, 3]);
  });

  await t.test("vertical flips row order", () => {
    assert.deepEqual(redChannel(mirrorBitmap(indexedBitmap(), "vertical")), [3, 4, 5, 0, 1, 2]);
  });

  await t.test("both rotates 180 degrees", () => {
    assert.deepEqual(redChannel(mirrorBitmap(indexedBitmap(), "both")), [5, 4, 3, 2, 1, 0]);
  });

  await t.test("does not modify the source bitmap", () => {
    const bitmap = indexedBitmap();
    mirrorBitmap(bitmap, "both");
    assert.deepEqual(redChannel(bitmap), [0, 1, 2, 3, 4, 5]);
  });
});
