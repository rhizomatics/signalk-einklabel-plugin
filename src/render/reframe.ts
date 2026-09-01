import { Bitmap } from "./types";

/**
 * How a rendered bitmap is fitted onto a device's actual panel size when the two don't match - see
 * `VendorDeviceConfig.reframe` for where the default (`"crop"`) actually lives; this type has none
 * of its own. `"fixed"` (the only behaviour that existed before this type did) makes no change,
 * leaving each vendor driver's own exact-size check in `encodeBitmap` to reject the mismatch;
 * `"scale"` scales the source onto the target dimensions independently per axis (not preserving
 * aspect ratio); `"crop"` keeps source pixels 1:1, placing them from the top-left and either
 * truncating whatever doesn't fit (source bigger than target) or leaving the extra target space
 * blank (source smaller).
 */
export type ReframeMode = "fixed" | "scale" | "crop";

/** Nearest-neighbour, not bilinear: the vendor colour quantisers threshold each pixel independently into a small fixed palette (see `nearestColour`/`classifyColour`), so blended edge pixels from interpolation would just be re-thresholded arbitrarily rather than improving the result. */
function scaleBitmap(bitmap: Bitmap, targetWidth: number, targetHeight: number): Bitmap {
  const data = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(bitmap.height - 1, Math.floor((y * bitmap.height) / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(bitmap.width - 1, Math.floor((x * bitmap.width) / targetWidth));
      const srcOffset = (srcY * bitmap.width + srcX) * 4;
      const dstOffset = (y * targetWidth + x) * 4;
      data.set(bitmap.data.subarray(srcOffset, srcOffset + 4), dstOffset);
    }
  }
  return { width: targetWidth, height: targetHeight, data };
}

/** Opaque white (matches an untouched label's own background) rather than transparent black, since the vendor colour quantisers treat a fully-transparent pixel the same as an opaque black one. */
function cropBitmap(bitmap: Bitmap, targetWidth: number, targetHeight: number): Bitmap {
  const data = new Uint8Array(targetWidth * targetHeight * 4).fill(255);
  const copyWidth = Math.min(bitmap.width, targetWidth);
  const copyHeight = Math.min(bitmap.height, targetHeight);
  for (let y = 0; y < copyHeight; y++) {
    const srcOffset = y * bitmap.width * 4;
    const dstOffset = y * targetWidth * 4;
    data.set(bitmap.data.subarray(srcOffset, srcOffset + copyWidth * 4), dstOffset);
  }
  return { width: targetWidth, height: targetHeight, data };
}

/** Applies `mode` to fit `bitmap` onto a `targetWidth`x`targetHeight` panel - a no-op whenever the size already matches, regardless of mode. */
export function reframeBitmap(bitmap: Bitmap, targetWidth: number, targetHeight: number, mode: ReframeMode): Bitmap {
  if (mode === "fixed" || (bitmap.width === targetWidth && bitmap.height === targetHeight)) {
    return bitmap;
  }
  return mode === "scale" ? scaleBitmap(bitmap, targetWidth, targetHeight) : cropBitmap(bitmap, targetWidth, targetHeight);
}
