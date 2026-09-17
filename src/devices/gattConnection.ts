import { BLEGattConnection } from "@signalk/server-api";

/**
 * Service+characteristic-UUID-keyed GATT surface both BLE backends satisfy - `app.bleApi.connectGATT()`
 * already returns exactly this shape (it *is* `BLEGattConnection`), and `openNodeBleGattConnection`
 * (`bleDiscovery.ts`) adapts a node-ble `Device` to it. Device drivers (`zhsunyco`/`gicisky`) talk to
 * this instead of either BLE library directly, so they work unchanged under whichever backend a caller
 * hands them - see `bleBackend.ts`.
 */
export type GattConnection = BLEGattConnection;
