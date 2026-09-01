/**
 * Gicisky ESL BLE protocol, transcribed from two reference implementations in the sibling
 * `lab` checkouts:
 *  - gicisky-tag (github.com/xxxxx/gicisky-tag) - a minimal CLI writer/scanner.
 *  - hass-gicisky (github.com/eigger/hass-gicisky) - the more actively maintained Home
 *    Assistant integration, whose `gicisky_ble` package this mostly follows.
 */

/** BLE manufacturer ID Gicisky devices advertise under (20563 decimal). */
export const GICISKY_MANUFACTURER_ID = 0x5053;

/**
 * The two GATT characteristics used for painting, found dynamically rather than hardcoded:
 * both reference drivers walk every service whose UUID starts `0000f...`, collect their
 * characteristics, and sort by the 16-bit UUID value - the lowest (observed as `fef1`) is the
 * command/status characteristic, the next (observed as `fef2`) carries image data. Doing the
 * same walk here (see `findCommandAndImageCharacteristics` in `index.ts`) survives a firmware
 * that puts these under a different parent service UUID than expected.
 */
export const CANDIDATE_SERVICE_UUID_PREFIX = "0000f";

export interface AdvertisedInfo {
  /** `((data[4] << 8) | data[0]) & 0x3FFF` - matches this driver's `GICISKY_PID_METADATA` keys. */
  deviceId: number;
  /** Un-masked `(data[4] << 8) | data[0])`, kept only for logging - not currently used to disambiguate models. */
  hardware: number;
  firmware: number;
  batteryMv: number;
}

/**
 * Decodes the 5-byte manufacturer-data payload Gicisky devices advertise. Mirrors
 * `GiciskyBluetoothDeviceData._parse_gicisky` (hass-gicisky's `parser.py`).
 */
export function decodeAdvertisedInfo(data: Buffer): AdvertisedInfo | undefined {
  if (data.length !== 5) {
    return undefined;
  }
  const hardware = (data[4] << 8) | data[0];
  return {
    deviceId: hardware & 0x3fff,
    hardware,
    firmware: (data[2] << 8) | data[3],
    batteryMv: data[1] * 100,
  };
}

export const COMMAND = {
  requestBlockSize: 0x01,
  writeScreen: 0x02,
  startImageTransfer: 0x03,
} as const;

/** `write_start_with_response`'s ack: `[0x01, <blockSize LE16>]` - observed as 244 on real hardware. */
export function decodeBlockSize(ack: Buffer): number | undefined {
  if (ack.length < 3 || ack[0] !== COMMAND.requestBlockSize) {
    return undefined;
  }
  return ack.readUInt16LE(1);
}

/**
 * Builds the `writeScreen` command announcing the total encoded payload size.
 *
 * `compression2` devices (7.5"/10.2") expect a 6-byte packet with a trailing `0x01` flag byte;
 * every other device expects an 8-byte packet with 3 trailing zero bytes. Mirrors
 * `GiciskyClient._make_cmd_packet` (hass-gicisky's `writer.py`).
 */
export function writeScreenCommand(payloadLength: number, compression2: boolean): Buffer {
  if (compression2) {
    const packet = Buffer.alloc(6);
    packet[0] = COMMAND.writeScreen;
    packet.writeUInt32LE(payloadLength, 1);
    packet[5] = 0x01;
    return packet;
  }
  const packet = Buffer.alloc(8);
  packet[0] = COMMAND.writeScreen;
  packet.writeUInt32LE(payloadLength, 1);
  return packet;
}

/** Builds one image-data packet: a 4-byte LE part index followed by that part's chunk. */
export function imageChunkPacket(part: number, chunk: Buffer): Buffer {
  const packet = Buffer.alloc(4 + chunk.length);
  packet.writeUInt32LE(part, 0);
  chunk.copy(packet, 4);
  return packet;
}

/** Ack shared by `startImageTransfer` and every image-data chunk: `[0x05, 0x00, <nextPart LE32>]`. */
export function decodeTransferAck(ack: Buffer): { ok: boolean; nextPart: number } | undefined {
  if (ack.length < 6 || ack[0] !== 0x05) {
    return undefined;
  }
  return { ok: ack[1] === 0x00, nextPart: ack.readUInt32LE(2) };
}
