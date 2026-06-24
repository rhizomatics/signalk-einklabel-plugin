import { Bitmap } from '../../render/types';
import { DeviceMetadata, DiscoveredDevice, VendorDeviceConfig, VendorDriver } from '../types';
import { ZHSUNYCO_PID_METADATA } from './metadata';

export class ZhsunycoDriver implements VendorDriver {
  readonly vendor = 'zhsunyco';

  matchesAdvertisement(name: string | undefined): boolean {
    return (name ?? '').startsWith('WL') || (name ?? '').startsWith('WOESL');
  }

  metadataForPid(pid: number): DeviceMetadata | undefined {
    return ZHSUNYCO_PID_METADATA[pid];
  }

  supportedDevices(): DeviceMetadata[] {
    return Object.values(ZHSUNYCO_PID_METADATA);
  }

  async scan(_durationMs: number): Promise<DiscoveredDevice[]> {
    throw new Error('zhsunyco BLE scan not yet implemented (BlueZ/D-Bus, Linux only)');
  }

  async paint(_bitmap: Bitmap, _config: VendorDeviceConfig): Promise<void> {
    throw new Error('zhsunyco BLE paint not yet implemented (BlueZ/D-Bus, Linux only)');
  }
}
