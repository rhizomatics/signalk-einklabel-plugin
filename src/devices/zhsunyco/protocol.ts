import { createCipheriv } from 'crypto';

/**
 * Wolink ESL GATT service ("WOLINKBLEESL2020") and characteristic UUIDs, transcribed
 * from the reference driver (examples/device_driver/zhunyco/wolink_ble.py).
 */
export const WOLINK_SERVICE_UUID = '30323032-4c53-4545-4c42-4b4e494c4f57';

export const WOLINK_CHARACTERISTIC_UUIDS = {
  data: '31323032-4c53-4545-4c42-4b4e494c4f57',
  config: '32323032-4c53-4545-4c42-4b4e494c4f57',
  authenticate: '33323032-4c53-4545-4c42-4b4e494c4f57',
  status: '34323032-4c53-4545-4c42-4b4e494c4f57',
  battery: '35323032-4c53-4545-4c42-4b4e494c4f57',
} as const;

export const COMMAND = {
  uploadBlock: 0xa500,
  refreshUncompressed: 0xa501,
} as const;

export interface AdvertisedDeviceInfo {
  pid: number;
  appVersion: string;
  hwVersion: string;
}

/** Decodes the 8-byte header shared by the advertising mirror and config characteristic. */
export function decodeAdvertisedInfo(data: Buffer): AdvertisedDeviceInfo | undefined {
  if (data.length < 8) {
    return undefined;
  }
  return {
    pid: data.readUInt16BE(2),
    appVersion: data.readUInt16BE(4).toString(16).padStart(4, '0'),
    hwVersion: data.readUInt16BE(6).toString(16).padStart(4, '0'),
  };
}

export function decodeBatteryMv(data: Buffer): number {
  return data.readUInt16BE(data.length - 2);
}

export function decodeStatus(data: Buffer): { busy: boolean; errorCode: number } {
  return { busy: data[0] === 0xff, errorCode: data[1] };
}

/** Builds the 6-byte command header: 2-byte LE command word + 4-byte LE offset/length. */
export function commandHeader(command: number, offsetOrLength = 0): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(command, 0);
  header.writeUInt32LE(offsetOrLength, 2);
  return header;
}

const AES_KEY_LENGTH = 16;
const AES_CHALLENGE_LENGTH = 16;

/**
 * Encrypts the device's auth challenge with the user-supplied AES-128 key (CBC, zero IV).
 *
 * The reference driver PKCS7-pads the challenge before encrypting and keeps only the
 * first ciphertext block. Since CBC's first output block depends only on the IV and the
 * plaintext's first block, that's equivalent to encrypting the (already block-sized)
 * challenge directly with padding disabled — so we skip the pad-then-truncate round trip.
 */
export function authResponse(challenge: Buffer, aesKeyHex: string): Buffer {
  const key = Buffer.from(aesKeyHex, 'hex');
  if (key.length !== AES_KEY_LENGTH) {
    throw new Error(`zhsunyco AES key must be ${AES_KEY_LENGTH} bytes (${AES_KEY_LENGTH * 2} hex chars), got ${key.length}`);
  }
  if (challenge.length !== AES_CHALLENGE_LENGTH) {
    throw new Error(`zhsunyco auth challenge expected ${AES_CHALLENGE_LENGTH} bytes, got ${challenge.length}`);
  }
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(challenge), cipher.final()]);
}
