/**
 * @naugehyde/node-ble's shipped typings use `export =`, which doesn't support the named
 * imports the rest of this codebase uses. This is a direct transcription of the public
 * surface documented in its README/JSDoc (https://github.com/chrvadala/node-ble),
 * limited to what this driver uses.
 */
declare module "@naugehyde/node-ble" {
  import { EventEmitter } from "events";

  export class GattCharacteristic extends EventEmitter {
    getUUID(): Promise<string>;
    getFlags(): Promise<string[]>;
    isNotifying(): Promise<boolean>;
    readValue(offset?: number): Promise<Buffer>;
    writeValue(
      value: Buffer,
      optionsOrOffset?: number | { offset?: number; type?: "command" | "request" | "reliable" },
    ): Promise<void>;
    writeValueWithoutResponse(value: Buffer, offset?: number): Promise<void>;
    writeValueWithResponse(value: Buffer, offset?: number): Promise<void>;
    startNotifications(): Promise<void>;
    stopNotifications(): Promise<void>;
  }

  export class GattService {
    isPrimary(): Promise<boolean>;
    getUUID(): Promise<string>;
    characteristics(): Promise<string[]>;
    getCharacteristic(uuid: string): Promise<GattCharacteristic>;
  }

  export class GattServer {
    services(): Promise<string[]>;
    getPrimaryService(uuid: string): Promise<GattService>;
  }

  export class Device extends EventEmitter {
    getName(): Promise<string>;
    getAddress(): Promise<string>;
    getAddressType(): Promise<string>;
    getAlias(): Promise<string>;
    getRSSI(): Promise<number>;
    getTXPower(): Promise<number>;
    getManufacturerData(): Promise<Record<string, Buffer>>;
    getAdvertisingData(): Promise<Record<string, Buffer>>;
    getServiceData(): Promise<Record<string, Buffer>>;
    isPaired(): Promise<boolean>;
    isConnected(): Promise<boolean>;
    pair(): Promise<void>;
    cancelPair(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    gatt(): Promise<GattServer>;
  }

  export class Adapter {
    getAddress(): Promise<string>;
    getAddressType(): Promise<string>;
    getName(): Promise<string>;
    getAlias(): Promise<string>;
    isPowered(): Promise<boolean>;
    isDiscovering(): Promise<boolean>;
    startDiscovery(): Promise<void>;
    stopDiscovery(): Promise<void>;
    devices(): Promise<string[]>;
    getDevice(address: string): Promise<Device>;
    waitDevice(address: string, timeout?: number, discoveryInterval?: number): Promise<Device>;
  }

  export class Bluetooth {
    adapters(): Promise<string[]>;
    defaultAdapter(): Promise<Adapter>;
    getAdapter(name: string): Promise<Adapter>;
    activeAdapters(): Promise<Adapter[]>;
  }

  export function createBluetooth(): { bluetooth: Bluetooth; destroy: () => void };
}
