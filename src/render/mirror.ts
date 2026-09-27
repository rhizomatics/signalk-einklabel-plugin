import { Bitmap } from "./types";

/**
 * Flips the rendered image before it's encoded for the panel - for hardware whose RAM layout is
 * mirrored relative to what a driver's encoder assumes (the Wolink HA integration found the 2.9"
 * and 3.5" panels differ from the 3.7" this plugin's zhsunyco encoder was confirmed against), or a
 * label that's simply mounted upside down (`"both"` is a 180° rotation).
 */
export type MirrorMode = "none" | "horizontal" | "vertical" | "both";

export const MIRROR_MODES: MirrorMode[] = ["none", "horizontal", "vertical", "both"];

/** Returns `bitmap` unchanged for `"none"`, otherwise a flipped copy. */
export function mirrorBitmap(bitmap: Bitmap, mode: MirrorMode): Bitmap {
  if (mode === "none") {
    return bitmap;
  }
  const { width, height } = bitmap;
  const flipX = mode === "horizontal" || mode === "both";
  const flipY = mode === "vertical" || mode === "both";
  const data = new Uint8Array(bitmap.data.length);
  for (let y = 0; y < height; y++) {
    const srcY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const srcX = flipX ? width - 1 - x : x;
      const srcOffset = (srcY * width + srcX) * 4;
      data.set(bitmap.data.subarray(srcOffset, srcOffset + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
