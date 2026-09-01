import { Device, GattCharacteristic, GattServer } from "@naugehyde/node-ble";
import { Bitmap } from "../../render/types";
import { DeviceMetadata, DiscoveredDevice, VendorDeviceConfig, VendorDriver } from "../types";
import { connectWithTimeout, createBluetooth, getOrDiscoverDevice } from "../bleDiscovery";
import { GICISKY_PID_METADATA } from "./metadata";
import { GICISKY_PID_LAYOUT, GiciskyLayout, defaultLayoutFor } from "./layout";
import { encodeBitmap } from "./encode";
import { reframeBitmap } from "../../render/reframe";
import {
  CANDIDATE_SERVICE_UUID_PREFIX,
  GICISKY_MANUFACTURER_ID,
  decodeAdvertisedInfo,
  decodeBlockSize,
  decodeTransferAck,
  imageChunkPacket,
  writeScreenCommand,
} from "./protocol";

const DEVICE_DISCOVERY_TIMEOUT_MS = 30_000;
const DEFAULT_PAINT_CONNECT_TIMEOUT_MS = 60_000;
const ACK_TIMEOUT_MS = 15_000;
/** Fallback if a device's `requestBlockSize` ack doesn't decode - matches the block size both reference drivers assume. */
const DEFAULT_BLOCK_SIZE = 244;
/** Bytes of image data per chunk: block size minus the 4-byte part-index header each chunk is prefixed with. */
const PART_INDEX_HEADER_LENGTH = 4;
const MAX_STALLED_REPEATS = 3;

export class GiciskyDriver implements VendorDriver {
  readonly vendor = "gicisky";

  matchesAdvertisement(_name: string | undefined, manufacturerId: number | undefined): boolean {
    return manufacturerId === GICISKY_MANUFACTURER_ID;
  }

  metadataForPid(pid: number): DeviceMetadata | undefined {
    return GICISKY_PID_METADATA.find((model) => model.pid === pid);
  }

  supportedDevices(): DeviceMetadata[] {
    return GICISKY_PID_METADATA;
  }

  async identifyDevice(
    device: Device,
    address: string,
    name: string | undefined,
    manufacturerId: number | undefined,
    manufacturerData: Buffer | undefined,
  ): Promise<DiscoveredDevice> {
    const info = manufacturerData ? decodeAdvertisedInfo(manufacturerData) : undefined;
    return {
      address,
      name,
      vendor: this.vendor,
      pid: info?.deviceId,
      metadata: info ? this.metadataForPid(info.deviceId) : undefined,
      manufacturerId,
      batteryMv: info?.batteryMv,
      rssi: await device
        .getRSSI()
        .then((value) => (value === undefined ? undefined : Number(value)))
        .catch(() => undefined),
    };
  }

  async paint(bitmap: Bitmap, config: VendorDeviceConfig): Promise<void> {
    const { bluetooth, destroy } = createBluetooth();
    try {
      const adapter = await bluetooth.defaultAdapter();
      const device = await getOrDiscoverDevice(adapter, config.address, DEVICE_DISCOVERY_TIMEOUT_MS);

      /**
       * Unlike zhsunyco, there's no GATT characteristic that reports the device's PID on demand -
       * the only source for it is the advertisement, cached on the `Device` object by BlueZ from
       * the last time it was seen (the same cache `identifyDevice`/a scan reads, just without
       * connecting first - see `forEachAdvertisedDevice` in `bleDiscovery.ts`).
       */
      const manufacturerData = await device
        .getManufacturerData()
        .then((data) => data[GICISKY_MANUFACTURER_ID.toString()])
        .catch(() => undefined);
      const info = manufacturerData ? decodeAdvertisedInfo(manufacturerData) : undefined;

      const metadata: DeviceMetadata | undefined = config.modelOverride
        ? { pid: info?.deviceId ?? 0, ...config.modelOverride }
        : info
          ? this.metadataForPid(info.deviceId)
          : undefined;
      if (!metadata) {
        throw new Error(
          info === undefined
            ? "gicisky device has no cached advertisement to identify it from - scan for it first, or pass --width/--height/--voffset/--colours to describe it manually"
            : `gicisky device reports unrecognised deviceId 0x${info.deviceId.toString(16).padStart(4, "0")} - ` +
                "pass --width/--height/--voffset/--colours to describe it manually",
        );
      }
      const layout: GiciskyLayout = (info && GICISKY_PID_LAYOUT[info.deviceId]) || defaultLayoutFor(metadata.colours);

      const framed = reframeBitmap(bitmap, metadata.width, metadata.height, config.reframe ?? "fixed");
      const payload = encodeBitmap(framed, metadata, layout);

      await connectWithTimeout(device, config.connectTimeoutMs ?? DEFAULT_PAINT_CONNECT_TIMEOUT_MS);
      try {
        const gatt = await device.gatt();
        const { cmd, img } = await findCommandAndImageCharacteristics(gatt);

        await cmd.startNotifications();
        try {
          const startAck = await writeAndAwaitAck(cmd, cmd, Buffer.from([0x01]));
          const chunkSize = (decodeBlockSize(startAck) ?? DEFAULT_BLOCK_SIZE) - PART_INDEX_HEADER_LENGTH;

          await writeAndAwaitAck(cmd, cmd, writeScreenCommand(payload.length, layout.packing === "chunked"));

          const startImageAck = await writeAndAwaitAck(cmd, cmd, Buffer.from([0x03]));
          const started = decodeTransferAck(startImageAck);
          if (!started?.ok) {
            throw new Error(`gicisky device rejected start-image-transfer request: ${startImageAck.toString("hex")}`);
          }

          let part = started.nextPart;
          let lastPart = -1;
          let repeats = 0;
          while (part * chunkSize < payload.length) {
            const chunk = payload.subarray(part * chunkSize, Math.min(part * chunkSize + chunkSize, payload.length));
            const ack = await writeAndAwaitAck(img, cmd, imageChunkPacket(part, chunk));
            const decoded = decodeTransferAck(ack);
            if (!decoded?.ok) {
              throw new Error(`gicisky device reported an error transferring image part ${part}: ${ack.toString("hex")}`);
            }
            if (decoded.nextPart === lastPart) {
              repeats++;
              if (repeats >= MAX_STALLED_REPEATS) {
                throw new Error(`gicisky image transfer stalled - device kept re-requesting part ${decoded.nextPart}`);
              }
            } else {
              repeats = 0;
              lastPart = decoded.nextPart;
            }
            part = decoded.nextPart;
          }
        } finally {
          await cmd.stopNotifications().catch(() => {});
        }
      } finally {
        await device.disconnect();
      }
    } finally {
      destroy();
    }
  }
}

/**
 * Walks every service whose UUID starts `0000f`, collecting their characteristics and sorting by
 * 16-bit UUID value - mirrors both reference drivers, which locate their command/image
 * characteristics this way rather than by a hardcoded service UUID (see `protocol.ts`).
 */
async function findCommandAndImageCharacteristics(gatt: GattServer): Promise<{ cmd: GattCharacteristic; img: GattCharacteristic }> {
  const candidates: { uuid: string; char: GattCharacteristic }[] = [];
  for (const serviceUuid of await gatt.services()) {
    if (!serviceUuid.toLowerCase().startsWith(CANDIDATE_SERVICE_UUID_PREFIX)) {
      continue;
    }
    const service = await gatt.getPrimaryService(serviceUuid);
    for (const charUuid of await service.characteristics()) {
      candidates.push({ uuid: charUuid, char: await service.getCharacteristic(charUuid) });
    }
  }
  candidates.sort((a, b) => parseInt(a.uuid.slice(4, 8), 16) - parseInt(b.uuid.slice(4, 8), 16));
  if (candidates.length < 2) {
    throw new Error(
      `gicisky device exposes ${candidates.length} candidate characteristic(s) under a "0000f..." service, expected at least 2`,
    );
  }
  return { cmd: candidates[0].char, img: candidates[1].char };
}

/** Writes `data` to `writeChar`, then awaits the next notification on `notifyChar` (which may be the same characteristic). */
function writeAndAwaitAck(writeChar: GattCharacteristic, notifyChar: GattCharacteristic, data: Buffer): Promise<Buffer> {
  const ack = new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      notifyChar.removeListener("valuechanged", onValue);
      reject(new Error("gicisky device did not acknowledge in time"));
    }, ACK_TIMEOUT_MS);
    function onValue(value: Buffer) {
      clearTimeout(timer);
      resolve(value);
    }
    notifyChar.once("valuechanged", onValue);
  });
  return writeChar.writeValueWithoutResponse(data).then(() => ack);
}
