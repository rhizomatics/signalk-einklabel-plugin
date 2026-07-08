import { Bitmap } from "../../render/types";
import { Colour, DeviceMetadata } from "../types";

/** 2-bit colour codes used by the Wolink wire format. */
const enum WolinkColour {
  Black = 0b00,
  White = 0b01,
  Yellow = 0b10,
  Red = 0b11,
}

const WOLINK_CODE: Record<Colour, WolinkColour> = {
  black: WolinkColour.Black,
  white: WolinkColour.White,
  yellow: WolinkColour.Yellow,
  red: WolinkColour.Red,
};

/**
 * Where a classified colour isn't in a device's own palette, the nearest one that's actually
 * supported - e.g. a BWR-only panel (no yellow layer) gets the yellow bucket's pixels sent as red,
 * the closest available warm/accent colour, rather than a wire code the hardware doesn't render.
 */
const FALLBACK: Partial<Record<Colour, Colour>> = {
  yellow: "red",
  red: "black",
};

/** Mirrors the reference driver's `from_pillow` nearest-colour decision tree, then maps the result down onto whatever colours this particular device's panel actually supports (see `DeviceMetadata.colours`). */
function nearestColour(r: number, g: number, b: number, supported: Colour[]): WolinkColour {
  let colour: Colour = "black";
  if (r > 150 && g > 150 && b > 150) colour = "white";
  else if (r > 150 && g > 100 && b < 80) colour = "yellow";
  else if (r > 150 && g < 80 && b < 80) colour = "red";

  while (!supported.includes(colour)) {
    const fallback = FALLBACK[colour];
    if (!fallback) break;
    colour = fallback;
  }
  return WOLINK_CODE[colour];
}

/**
 * Quantises a common RGBA bitmap and packs it into the Wolink wire format: 2 bits per
 * pixel, 4 pixels per byte, column-major, with both axes flipped (RAM is x/y-flipped
 * relative to the displayed image). Mirrors `make_image`/`from_pillow` in the reference
 * driver (examples/device_driver/zhunyco/wolink_ble.py).
 *
 * Rows above `voffset` (present on some panel sizes) are sent as black, matching the
 * reference driver pasting the source image at a vertical offset onto a blank canvas.
 */
export function encodeBitmap(bitmap: Bitmap, metadata: DeviceMetadata): Buffer {
  const { width, height, voffset } = metadata;
  const contentHeight = height - voffset;
  if (bitmap.width !== width || bitmap.height !== contentHeight) {
    throw new Error(
      `zhsunyco paint: bitmap is ${bitmap.width}x${bitmap.height}, device "${metadata.label}" expects ${width}x${contentHeight}`,
    );
  }

  const bytesPerColumn = height / 4;
  const data = Buffer.alloc((width * height) / 4);

  for (let x = 0; x < width; x++) {
    const physX = width - 1 - x;
    for (let y = 0; y < height; y++) {
      const srcY = y - voffset;
      const colour = srcY >= 0 && srcY < bitmap.height ? samplePixel(bitmap, x, srcY, metadata.colours) : WolinkColour.Black;
      const physY = height - 1 - y;
      const byteIdx = physX * bytesPerColumn + Math.floor(physY / 4);
      const bitShift = 6 - (physY % 4) * 2;
      data[byteIdx] |= colour << bitShift;
    }
  }
  return data;
}

function samplePixel(bitmap: Bitmap, x: number, y: number, supported: Colour[]): WolinkColour {
  const offset = (y * bitmap.width + x) * 4;
  return nearestColour(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], supported);
}
