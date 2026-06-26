import { Bitmap } from '../../render/types';
import { DeviceMetadata } from '../types';

/** 2-bit colour codes used by the Wolink wire format. */
const enum WolinkColour {
  Black = 0b00,
  White = 0b01,
  Yellow = 0b10,
  Red = 0b11,
}

/** Mirrors the reference driver's `from_pillow` nearest-colour decision tree. */
function nearestColour(r: number, g: number, b: number): WolinkColour {
  if (r > 150 && g > 150 && b > 150) return WolinkColour.White;
  if (r > 150 && g > 100 && b < 80) return WolinkColour.Yellow;
  if (r > 150 && g < 80 && b < 80) return WolinkColour.Red;
  return WolinkColour.Black;
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
      const colour = srcY >= 0 && srcY < bitmap.height ? samplePixel(bitmap, x, srcY) : WolinkColour.Black;
      const physY = height - 1 - y;
      const byteIdx = physX * bytesPerColumn + Math.floor(physY / 4);
      const bitShift = 6 - (physY % 4) * 2;
      data[byteIdx] |= colour << bitShift;
    }
  }
  return data;
}

function samplePixel(bitmap: Bitmap, x: number, y: number): WolinkColour {
  const offset = (y * bitmap.width + x) * 4;
  return nearestColour(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2]);
}
