import { VendorDriver } from "./types";

const drivers = new Map<string, VendorDriver>();

export function registerDriver(driver: VendorDriver): void {
  drivers.set(driver.vendor, driver);
}

export function getDriver(vendor: string): VendorDriver | undefined {
  return drivers.get(vendor);
}

export function allDrivers(): VendorDriver[] {
  return [...drivers.values()];
}
