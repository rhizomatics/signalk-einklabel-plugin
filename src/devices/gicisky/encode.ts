import { Bitmap } from "../../render/types";
import { Colour, DeviceMetadata } from "../types";
import { GiciskyLayout } from "./layout";
import { frameChunkedPlanes } from "./compression";

/**
 * Nearest-colour classification into a device's actual palette - same decision tree and
 * fallback-through-the-palette approach as `zhsunyco/encode.ts`'s `nearestColour`, duplicated
 * rather than shared since each vendor package here is self-contained (see README's
 * "ESL Vendor - Sub-package per vendor").
 */
const FALLBACK: Partial<Record<Colour, Colour>> = {
  yellow: "red",
  red: "black",
};

/** Below this, a pixel counts as "blank" rather than whatever colour its (possibly meaningless, for a fully transparent pixel) RGB happens to hold. */
const TRANSPARENT_ALPHA_THRESHOLD = 128;

/**
 * A mostly-transparent pixel - undrawn SVG canvas, e.g. a template resized without its background
 * rect following - classifies as white (blank paper), not the RGB-thresholds' own default of black:
 * resvg-wasm leaves transparent pixels at RGB (0,0,0), and without this check that reads as
 * ink-black rather than the blank label surface it actually represents.
 */
function classifyColour(r: number, g: number, b: number, a: number, supported: Colour[]): Colour {
  let colour: Colour = "black";
  if (a < TRANSPARENT_ALPHA_THRESHOLD) colour = "white";
  else if (r > 150 && g > 150 && b > 150) colour = "white";
  else if (r > 150 && g > 100 && b < 80) colour = "yellow";
  else if (r > 150 && g < 80 && b < 80) colour = "red";

  while (!supported.includes(colour)) {
    const fallback = FALLBACK[colour];
    if (!fallback) break;
    colour = fallback;
  }
  return colour;
}

/**
 * Rotates a bitmap 90 degrees counter-clockwise once (in the raster sense: x right, y down) -
 * equivalent to Pillow's `Image.rotate(90, expand=True)` / `numpy.rot90`, which the reference
 * driver relies on. `rotateBitmap` below composes this to cover 0/90/180/270.
 */
function rotate90(bitmap: Bitmap): Bitmap {
  const { width, height, data } = bitmap;
  const outWidth = height;
  const outHeight = width;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const ix = width - 1 - oy;
      const iy = ox;
      const srcOffset = (iy * width + ix) * 4;
      const dstOffset = (oy * outWidth + ox) * 4;
      out.set(data.subarray(srcOffset, srcOffset + 4), dstOffset);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

function rotateBitmap(bitmap: Bitmap, degrees: 0 | 90 | 180 | 270): Bitmap {
  let result = bitmap;
  for (let turns = degrees / 90; turns > 0; turns--) {
    result = rotate90(result);
  }
  return result;
}

/**
 * Packs one 1-bit plane, MSB-first, row-major (8 pixels/byte) - `predicate` decides whether a
 * given pixel's classified colour sets the bit.
 */
function packPlane(bitmap: Bitmap, layout: GiciskyLayout, supported: Colour[], predicate: (colour: Colour) => boolean): Buffer {
  const { width, height } = bitmap;
  const bytesPerRow = Math.ceil(width / 8);
  const plane = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = layout.mirrorX ? width - 1 - x : x;
      const sy = layout.mirrorY ? height - 1 - y : y;
      const offset = (sy * width + sx) * 4;
      const colour = classifyColour(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], bitmap.data[offset + 3], supported);
      if (predicate(colour)) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        plane[byteIndex] |= 0x80 >> (x % 8);
      }
    }
  }
  return plane;
}

/** 2-bit packing across the full palette, MSB-first, 4 pixels/byte, row-major: black=0, white=1, yellow=2, red=3. */
const FOUR_COLOUR_CODE: Record<Colour, number> = { black: 0, white: 1, yellow: 2, red: 3 };

function packFourColour(bitmap: Bitmap, layout: GiciskyLayout, supported: Colour[]): Buffer {
  const { width, height } = bitmap;
  const pixelsPerByte = 4;
  const bytesPerRow = Math.ceil(width / pixelsPerByte);
  const plane = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = layout.mirrorX ? width - 1 - x : x;
      const sy = layout.mirrorY ? height - 1 - y : y;
      const offset = (sy * width + sx) * 4;
      const colour = classifyColour(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], bitmap.data[offset + 3], supported);
      const code = FOUR_COLOUR_CODE[colour];
      const byteIndex = y * bytesPerRow + Math.floor(x / pixelsPerByte);
      const shift = 6 - (x % pixelsPerByte) * 2;
      plane[byteIndex] |= code << shift;
    }
  }
  return plane;
}

/**
 * Quantises a common RGBA bitmap and packs it into the wire format this model's `GiciskyLayout`
 * calls for. Mirrors `GiciskyClient._make_image_packet` (hass-gicisky's `writer.py`), except
 * colour selection uses palette-nearest classification (matching this codebase's `zhsunyco`
 * driver) rather than the reference driver's raw-luminance thresholds.
 */
export function encodeBitmap(bitmap: Bitmap, metadata: DeviceMetadata, layout: GiciskyLayout): Buffer {
  if (layout.packing === "unsupported") {
    throw new Error(
      `gicisky paint: device "${metadata.label}" isn't supported yet (needs compression/resize support this driver doesn't implement)`,
    );
  }
  if (bitmap.width !== metadata.width || bitmap.height !== metadata.height) {
    throw new Error(
      `gicisky paint: bitmap is ${bitmap.width}x${bitmap.height}, device "${metadata.label}" expects ${metadata.width}x${metadata.height}`,
    );
  }

  const rotated = rotateBitmap(bitmap, layout.rotation);
  const supported = metadata.colours;

  if (layout.fourColour) {
    return packFourColour(rotated, layout, supported);
  }

  const isWhite = (colour: Colour) => (layout.invertLuminance ? colour !== "white" : colour === "white");
  const bwPlane = packPlane(rotated, layout, supported, isWhite);

  if (!supported.includes("red")) {
    return bwPlane;
  }
  const redPlane = packPlane(rotated, layout, supported, (colour) => colour === "red");

  if (layout.packing === "chunked") {
    return frameChunkedPlanes(bwPlane, redPlane);
  }
  return Buffer.concat([bwPlane, redPlane]);
}
