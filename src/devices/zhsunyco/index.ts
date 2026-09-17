import { Bitmap } from "../../render/types";
import { DeviceMetadata, DiscoveredDevice, VendorDeviceConfig, VendorDriver } from "../types";
import { sleep } from "../bleDiscovery";
import { nodeBleBackend } from "../bleBackend";
import { GattConnection } from "../gattConnection";
import { PLUGIN_NAME } from "../../pluginVersion";
import { ZHSUNYCO_PID_METADATA } from "./metadata";
import { encodeBitmap } from "./encode";
import { reframeBitmap } from "../../render/reframe";
import {
  AdvertisedDeviceInfo,
  COMMAND,
  WOLINK_CHARACTERISTIC_UUIDS,
  WOLINK_SERVICE_UUID,
  ZHSUNYCO_MANUFACTURER_ID,
  authResponse,
  commandHeader,
  decodeAdvertisedInfo,
  decodeBatteryMv,
  decodeStatus,
  resolveAesKey,
} from "./protocol";

/** node-ble has no MTU API; this matches the reference driver's mtu(247)-9 default. */
const UPLOAD_CHUNK_SIZE = 238;
const CHUNK_WRITE_DELAY_MS = 20;
const AUTH_SETTLE_DELAY_MS = 500;
const STATUS_WAIT_TIMEOUT_MS = 60_000;
/** Bounds `readDeviceDetails`' whole connect+read attempt during a scan - see its doc comment. */
const IDENTIFY_READ_TIMEOUT_MS = 10_000;
/** Fallback when `VendorDeviceConfig.connectTimeoutMs` is omitted (e.g. a bare CLI `paint` call) - matches `defaultConfig().paintConnectTimeoutSeconds`. */
const DEFAULT_PAINT_CONNECT_TIMEOUT_MS = 60_000;

export class ZhsunycoDriver implements VendorDriver {
  readonly vendor = "zhsunyco";

  matchesAdvertisement(name: string | undefined, manufacturerId: number | undefined): boolean {
    return manufacturerId === ZHSUNYCO_MANUFACTURER_ID || (name ?? "").startsWith("WL") || (name ?? "").startsWith("WOESL");
  }

  metadataForPid(pid: number, hwVersion?: string): DeviceMetadata | undefined {
    const candidates = ZHSUNYCO_PID_METADATA.filter((model) => model.pid === pid);
    return candidates.find((model) => model.hwVersion === hwVersion) ?? candidates.find((model) => model.hwVersion === undefined);
  }

  supportedDevices(): DeviceMetadata[] {
    return ZHSUNYCO_PID_METADATA;
  }

  async identifyDevice(
    {
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
    },
    connect: () => Promise<GattConnection>,
  ): Promise<DiscoveredDevice> {
    const advertisedInfo = manufacturerData ? decodeAdvertisedInfo(manufacturerData) : undefined;
    const { info, batteryMv } = await readDeviceDetails(address, advertisedInfo, connect);
    return {
      address,
      name,
      vendor: this.vendor,
      pid: info?.pid,
      hwVersion: info?.hwVersion,
      metadata: info ? this.metadataForPid(info.pid, info.hwVersion) : undefined,
      manufacturerId,
      batteryMv,
      rssi,
    };
  }

  async paint(bitmap: Bitmap, config: VendorDeviceConfig): Promise<void> {
    const aesKey = resolveAesKey(config.aesKey);

    const backend = config.gattBackend ?? nodeBleBackend();
    const conn = await backend.connectGatt(config.address, config.connectTimeoutMs ?? DEFAULT_PAINT_CONNECT_TIMEOUT_MS);
    try {
      const info = decodeAdvertisedInfo(await conn.read(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.config));
      if (!info) {
        throw new Error("zhsunyco device did not return valid config data");
      }
      const metadata = config.modelOverride ? { pid: info.pid, ...config.modelOverride } : this.metadataForPid(info.pid, info.hwVersion);
      if (!metadata) {
        throw new Error(
          `zhsunyco device reports unrecognised PID 0x${info.pid.toString(16).padStart(4, "0")} - ` +
            "pass --width/--height/--voffset/--colours to describe it manually",
        );
      }

      const statusReceived = new Promise<void>((resolve, reject) => {
        conn
          .startNotifications(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.status, (data) => {
            const { errorCode } = decodeStatus(data);
            if (errorCode === 0) {
              resolve();
            } else {
              reject(new Error(`zhsunyco device reported error 0x${errorCode.toString(16).padStart(2, "0")} after refresh`));
            }
          })
          .catch(reject);
      });

      try {
        const challenge = await conn.read(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.authenticate);
        await conn.write(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.authenticate, authResponse(challenge, aesKey), false);
        await sleep(AUTH_SETTLE_DELAY_MS);

        const framed = reframeBitmap(bitmap, metadata.width, metadata.height - metadata.voffset, config.reframe ?? "crop");
        const pixelData = encodeBitmap(framed, metadata);
        for (let offset = 0; offset < pixelData.length; offset += UPLOAD_CHUNK_SIZE) {
          const chunk = pixelData.subarray(offset, offset + UPLOAD_CHUNK_SIZE);
          await conn.write(
            WOLINK_SERVICE_UUID,
            WOLINK_CHARACTERISTIC_UUIDS.data,
            Buffer.concat([commandHeader(COMMAND.uploadBlock, offset), chunk]),
            true,
          );
          await sleep(CHUNK_WRITE_DELAY_MS);
        }
        await conn.write(
          WOLINK_SERVICE_UUID,
          WOLINK_CHARACTERISTIC_UUIDS.data,
          commandHeader(COMMAND.refreshUncompressed, pixelData.length),
          true,
        );

        // `Promise.race` can't cancel its loser, so once `statusReceived` settles (the common case)
        // this timer would otherwise sit alive for the rest of its 60s regardless - see the identical
        // reasoning on `readDeviceDetails`'s own race, below.
        let statusTimer: ReturnType<typeof setTimeout>;
        const statusTimeout = new Promise<void>((resolve) => {
          statusTimer = setTimeout(resolve, STATUS_WAIT_TIMEOUT_MS);
        });
        try {
          await Promise.race([statusReceived, statusTimeout]);
        } finally {
          clearTimeout(statusTimer!);
        }
      } finally {
        await conn.stopNotifications(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.status).catch(() => {});
      }
    } finally {
      await conn.disconnect();
    }
  }
}

/**
 * Battery level needs a connection regardless, so reuse it to also fill in the PID/hwVersion
 * when the advertisement didn't carry decodable manufacturer data - a scan matched purely by name
 * prefix can lack that, which would otherwise leave a real, nearby device's model (and so its entry
 * in the config UI's device picker - see `deviceOptions()` in `config.ts`) silently missing. Reads
 * the same config characteristic `paint()` reads, just to identify the device rather than to size a
 * render.
 */
async function readDeviceDetails(
  address: string,
  advertisedInfo: AdvertisedDeviceInfo | undefined,
  connect: () => Promise<GattConnection>,
): Promise<{ info: AdvertisedDeviceInfo | undefined; batteryMv: number | undefined }> {
  const fallback = { info: advertisedInfo, batteryMv: undefined };
  const read = async () => {
    let conn: GattConnection | undefined;
    try {
      conn = await connect();
      const batteryMv = decodeBatteryMv(await conn.read(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.battery));
      let info = advertisedInfo;
      if (!info) {
        info = decodeAdvertisedInfo(await conn.read(WOLINK_SERVICE_UUID, WOLINK_CHARACTERISTIC_UUIDS.config));
      }
      return { info, batteryMv };
    } catch (err) {
      // Swallowed rather than thrown - a device that refuses this connect (e.g. busy elsewhere,
      // out of range) should still show up in the scan with whatever the advertisement itself
      // carried, just without battery/PID-by-read. Logged so a blank battery column has a reason
      // instead of looking like the read was simply never attempted.
      console.error(`${PLUGIN_NAME}: zhsunyco [${address}]: battery/config read failed: ${(err as Error).message}`);
      return fallback;
    } finally {
      await conn?.disconnect().catch(() => {});
    }
  };
  // A GATT call has no timeout of its own - race the whole read so one unresponsive device can't
  // stall the rest of the scan (see `plugin.ts`'s `scanInProgress`, which otherwise stays set forever
  // and silently skips every later scan). `Promise.race` alone can't cancel its loser, so a `read()`
  // that settles fast (e.g. `connect` rejecting immediately because the device is busy elsewhere -
  // exactly the case this function's own doc comment covers) would otherwise leave this timer running
  // for the rest of its 30s regardless - harmless in the end, but needless to hold onto that long.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof fallback>((resolve) => {
    timer = setTimeout(() => {
      console.error(`${PLUGIN_NAME}: zhsunyco [${address}]: battery/config read timed out after ${IDENTIFY_READ_TIMEOUT_MS * 2}ms`);
      resolve(fallback);
    }, IDENTIFY_READ_TIMEOUT_MS * 3);
  });
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
