import { Bitmap } from "../../render/types";
import { DeviceMetadata, DiscoveredDevice, VendorDeviceConfig, VendorDriver } from "../types";
import { nodeBleBackend } from "../bleBackend";
import { GattConnection } from "../gattConnection";
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

/** How long to actively rescan for a fresh advertisement when the cached one is missing/stale - see `BleBackend.waitForManufacturerData`. */
const MANUFACTURER_DATA_RESCAN_TIMEOUT_MS = 15_000;
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

  async identifyDevice({
    address,
    name,
    manufacturerId,
    manufacturerData,
    rssi,
  }: {
    address: string;
    name: string | undefined;
    manufacturerId: number | undefined;
    manufacturerData: Buffer | undefined;
    rssi: number | undefined;
  }): Promise<DiscoveredDevice> {
    const info = manufacturerData ? decodeAdvertisedInfo(manufacturerData) : undefined;
    return {
      address,
      name,
      vendor: this.vendor,
      pid: info?.deviceId,
      metadata: info ? this.metadataForPid(info.deviceId) : undefined,
      manufacturerId,
      batteryMv: info?.batteryMv,
      rssi,
    };
  }

  async paint(bitmap: Bitmap, config: VendorDeviceConfig): Promise<void> {
    const backend = config.gattBackend ?? nodeBleBackend();

    /**
     * Unlike zhsunyco, there's no GATT characteristic that reports the device's PID on demand -
     * the only source for it is the advertisement. That cache can be empty or stale (e.g. nothing
     * has actively scanned since the adapter/provider last restarted) even though a connect below
     * would succeed instantly via BlueZ's/the BLE Manager's own device cache - so rescan for a fresh
     * advertisement here rather than failing on the first read.
     */
    const manufacturerData = await backend.waitForManufacturerData(
      config.address,
      GICISKY_MANUFACTURER_ID,
      MANUFACTURER_DATA_RESCAN_TIMEOUT_MS,
    );
    const info = manufacturerData ? decodeAdvertisedInfo(manufacturerData) : undefined;
    // A device that's quiet right now (e.g. still refreshing from the last paint) can still be painted
    // when its PID is already known from config/a previous scan - the connect below doesn't need the
    // advertisement, only this lookup does.
    const pid = info?.deviceId ?? config.pid;

    const metadata: DeviceMetadata | undefined = config.modelOverride
      ? { pid: pid ?? 0, ...config.modelOverride }
      : pid !== undefined
        ? this.metadataForPid(pid)
        : undefined;
    if (!metadata) {
      throw new Error(
        pid === undefined
          ? "gicisky device isn't advertising - rescanned but got nothing back (out of range, asleep, or already connected " +
              "elsewhere) - pass --width/--height/--voffset/--colours to describe it manually"
          : `gicisky device reports unrecognised deviceId 0x${pid.toString(16).padStart(4, "0")} - ` +
              "pass --width/--height/--voffset/--colours to describe it manually",
      );
    }
    const layout: GiciskyLayout = (pid !== undefined && GICISKY_PID_LAYOUT[pid]) || defaultLayoutFor(metadata.colours);

    const framed = reframeBitmap(bitmap, metadata.width, metadata.height, config.reframe ?? "crop");
    const payload = encodeBitmap(framed, metadata, layout);

    const conn = await backend.connectGatt(config.address, config.connectTimeoutMs ?? DEFAULT_PAINT_CONNECT_TIMEOUT_MS);
    try {
      const { cmdServiceUuid, cmdUuid, imgServiceUuid, imgUuid } = await findCommandAndImageCharacteristics(conn);
      const ack = new AckChannel();
      await conn.startNotifications(cmdServiceUuid, cmdUuid, ack.onNotify);
      try {
        const startAck = await writeAndAwaitAck(conn, cmdServiceUuid, cmdUuid, Buffer.from([0x01]), ack);
        const chunkSize = (decodeBlockSize(startAck) ?? DEFAULT_BLOCK_SIZE) - PART_INDEX_HEADER_LENGTH;

        await writeAndAwaitAck(conn, cmdServiceUuid, cmdUuid, writeScreenCommand(payload.length, layout.packing === "chunked"), ack);

        const startImageAck = await writeAndAwaitAck(conn, cmdServiceUuid, cmdUuid, Buffer.from([0x03]), ack);
        const started = decodeTransferAck(startImageAck);
        if (!started?.ok) {
          throw new Error(`gicisky device rejected start-image-transfer request: ${startImageAck.toString("hex")}`);
        }

        let part = started.nextPart;
        let lastPart = -1;
        let repeats = 0;
        while (part * chunkSize < payload.length) {
          const chunk = payload.subarray(part * chunkSize, Math.min(part * chunkSize + chunkSize, payload.length));
          const ackData = await writeAndAwaitAck(conn, imgServiceUuid, imgUuid, imageChunkPacket(part, chunk), ack);
          const decoded = decodeTransferAck(ackData);
          if (decoded && !decoded.ok && part * chunkSize + chunk.length >= payload.length) {
            // The device answers the final chunk with a non-zero status (seen: `05 08 00000000`) once
            // it has the whole image and starts refreshing - the transfer's done, not failed. Matches
            // hass-gicisky's writer, which ends the transfer on any non-zero status rather than erroring.
            break;
          }
          if (!decoded?.ok) {
            throw new Error(`gicisky device reported an error transferring image part ${part}: ${ackData.toString("hex")}`);
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
        await conn.stopNotifications(cmdServiceUuid, cmdUuid).catch(() => {});
      }
    } finally {
      await conn.disconnect();
    }
  }
}

/**
 * Single-slot "await the next notification" dispatcher - the gicisky protocol is strictly
 * request/response (never more than one write in flight), so a persistent `startNotifications`
 * callback (`GattConnection`'s shape, unlike node-ble's per-call `.once("valuechanged")`) just needs
 * to hand its next delivery to whichever `waitForAck` call is currently pending. Mirrors how
 * signalk-bluetti-plugin's `ProtocolSession.feed()` dispatches notification bytes to a single
 * pending request.
 */
class AckChannel {
  private pending: { resolve: (data: Buffer) => void; timer: ReturnType<typeof setTimeout> } | undefined;

  onNotify = (data: Buffer): void => {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.resolve(data);
  };

  waitForAck(timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error("gicisky device did not acknowledge in time"));
      }, timeoutMs);
      this.pending = { resolve, timer };
    });
  }
}

/** Writes `data` to `(writeServiceUuid, writeUuid)`, then awaits the next ack delivered to `ack`. */
async function writeAndAwaitAck(
  conn: GattConnection,
  writeServiceUuid: string,
  writeUuid: string,
  data: Buffer,
  ack: AckChannel,
): Promise<Buffer> {
  const pending = ack.waitForAck(ACK_TIMEOUT_MS);
  await conn.write(writeServiceUuid, writeUuid, data, false);
  return pending;
}

/**
 * Walks every service whose UUID starts `0000f`, collecting their characteristics and sorting by
 * 16-bit UUID value - mirrors both reference drivers, which locate their command/image
 * characteristics this way rather than by a hardcoded service UUID (see `protocol.ts`).
 */
async function findCommandAndImageCharacteristics(
  conn: GattConnection,
): Promise<{ cmdServiceUuid: string; cmdUuid: string; imgServiceUuid: string; imgUuid: string }> {
  const candidates: { serviceUuid: string; uuid: string }[] = [];
  for (const service of await conn.discoverServices()) {
    if (!service.uuid.toLowerCase().startsWith(CANDIDATE_SERVICE_UUID_PREFIX)) {
      continue;
    }
    for (const characteristic of service.characteristics) {
      candidates.push({ serviceUuid: service.uuid, uuid: characteristic.uuid });
    }
  }
  candidates.sort((a, b) => parseInt(a.uuid.slice(4, 8), 16) - parseInt(b.uuid.slice(4, 8), 16));
  if (candidates.length < 2) {
    throw new Error(
      `gicisky device exposes ${candidates.length} candidate characteristic(s) under a "0000f..." service, expected at least 2`,
    );
  }
  return {
    cmdServiceUuid: candidates[0].serviceUuid,
    cmdUuid: candidates[0].uuid,
    imgServiceUuid: candidates[1].serviceUuid,
    imgUuid: candidates[1].uuid,
  };
}
