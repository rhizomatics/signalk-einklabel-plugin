import test from 'node:test';
import assert from 'node:assert/strict';
import { allDrivers, getDriver, registerDriver } from './registry';
import { VendorDriver } from './types';

function fakeDriver(vendor: string): VendorDriver {
  return {
    vendor,
    matchesAdvertisement: () => false,
    metadataForPid: () => undefined,
    supportedDevices: () => [],
    identifyDevice: async () => {
      throw new Error('not implemented');
    },
    paint: async () => {},
  };
}

test('registry', async (t) => {
  await t.test('getDriver returns undefined for an unregistered vendor', () => {
    assert.equal(getDriver('__never-registered__'), undefined);
  });

  await t.test('registerDriver makes a driver findable by vendor and listed in allDrivers', () => {
    const driver = fakeDriver('__test-vendor-a__');
    registerDriver(driver);
    assert.equal(getDriver('__test-vendor-a__'), driver);
    assert.ok(allDrivers().includes(driver));
  });

  await t.test('registering a driver with the same vendor name replaces the previous one', () => {
    const first = fakeDriver('__test-vendor-b__');
    const second = fakeDriver('__test-vendor-b__');
    registerDriver(first);
    registerDriver(second);
    assert.equal(getDriver('__test-vendor-b__'), second);
    assert.equal(allDrivers().filter((d) => d.vendor === '__test-vendor-b__').length, 1);
  });
});
