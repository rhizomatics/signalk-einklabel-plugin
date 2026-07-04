import test from 'node:test';
import assert from 'node:assert/strict';
import { Adapter, Device } from '@naugehyde/node-ble';
import {
  connectWithTimeout,
  createBluetooth,
  forEachAdvertisedDevice,
  getManufacturerId,
  getOrDiscoverDevice,
  withDiscovery,
  withRetries,
} from './bleDiscovery';

test('createBluetooth refuses to run on a non-Linux platform', { skip: process.platform === 'linux' }, () => {
  assert.throws(() => createBluetooth(), /requires Linux/);
});

test('withDiscovery refuses to run on a non-Linux platform', { skip: process.platform === 'linux' }, async () => {
  await assert.rejects(
    withDiscovery(10, async () => 'unreachable'),
    /requires Linux/,
  );
});

test('getManufacturerId', async (t) => {
  await t.test('returns the numeric key of the advertised manufacturer data', async () => {
    const device = { getManufacturerData: async () => ({ 0x0157: Buffer.from([1, 2]) }) } as unknown as Device;
    assert.equal(await getManufacturerId(device), 0x0157);
  });

  await t.test('returns undefined when no manufacturer data is advertised', async () => {
    const device = { getManufacturerData: async () => ({}) } as unknown as Device;
    assert.equal(await getManufacturerId(device), undefined);
  });

  await t.test('returns undefined when reading manufacturer data fails', async () => {
    const device = {
      getManufacturerData: async () => {
        throw new Error('not connected');
      },
    } as unknown as Device;
    assert.equal(await getManufacturerId(device), undefined);
  });
});

test('forEachAdvertisedDevice', async (t) => {
  await t.test('reads each device\'s advertisement once and hands it to fn', async () => {
    const devices: Record<string, Device> = {
      'AA:AA:AA:AA:AA:AA': {
        getName: async () => 'Label 1',
        getManufacturerData: async () => ({ 0x0157: Buffer.from([9]) }),
      } as unknown as Device,
      'BB:BB:BB:BB:BB:BB': {
        getName: async () => undefined,
        getManufacturerData: async () => ({}),
      } as unknown as Device,
    };
    const adapter = {
      devices: async () => Object.keys(devices),
      getDevice: async (address: string) => devices[address],
    } as unknown as Adapter;

    const seen: { address: string; name?: string; manufacturerId?: number; manufacturerData?: Buffer }[] = [];
    await forEachAdvertisedDevice(adapter, async (advertised) => {
      seen.push({
        address: advertised.address,
        name: advertised.name,
        manufacturerId: advertised.manufacturerId,
        manufacturerData: advertised.manufacturerData,
      });
    });

    assert.deepEqual(seen, [
      { address: 'AA:AA:AA:AA:AA:AA', name: 'Label 1', manufacturerId: 0x0157, manufacturerData: Buffer.from([9]) },
      { address: 'BB:BB:BB:BB:BB:BB', name: undefined, manufacturerId: undefined, manufacturerData: undefined },
    ]);
  });

  await t.test('skips a device BlueZ drops from its cache between listing and lookup', async () => {
    const adapter = {
      devices: async () => ['AA:AA:AA:AA:AA:AA'],
      getDevice: async () => {
        throw new Error('org.bluez.Error.DoesNotExist');
      },
    } as unknown as Adapter;

    let calls = 0;
    await forEachAdvertisedDevice(adapter, async () => {
      calls++;
    });
    assert.equal(calls, 0);
  });
});

test('getOrDiscoverDevice', async (t) => {
  await t.test('returns an already-known device without starting discovery', async () => {
    const device = {} as unknown as Device;
    let startDiscoveryCalls = 0;
    const adapter = {
      getDevice: async () => device,
      isDiscovering: async () => false,
      startDiscovery: async () => {
        startDiscoveryCalls++;
      },
    } as unknown as Adapter;

    assert.equal(await getOrDiscoverDevice(adapter, 'AA:AA:AA:AA:AA:AA', 1000), device);
    assert.equal(startDiscoveryCalls, 0);
  });

  await t.test('starts and stops discovery around waitDevice when BlueZ has no cached device', async () => {
    const device = {} as unknown as Device;
    const calls: string[] = [];
    const adapter = {
      getDevice: async () => {
        throw new Error('org.bluez.Error.DoesNotExist');
      },
      isDiscovering: async () => false,
      startDiscovery: async () => {
        calls.push('start');
      },
      stopDiscovery: async () => {
        calls.push('stop');
      },
      waitDevice: async () => {
        calls.push('wait');
        return device;
      },
    } as unknown as Adapter;

    assert.equal(await getOrDiscoverDevice(adapter, 'AA:AA:AA:AA:AA:AA', 1000), device);
    assert.deepEqual(calls, ['start', 'wait', 'stop']);
  });

  await t.test('does not toggle discovery when it was already running', async () => {
    const device = {} as unknown as Device;
    const calls: string[] = [];
    const adapter = {
      getDevice: async () => {
        throw new Error('org.bluez.Error.DoesNotExist');
      },
      isDiscovering: async () => true,
      startDiscovery: async () => {
        calls.push('start');
      },
      stopDiscovery: async () => {
        calls.push('stop');
      },
      waitDevice: async () => {
        calls.push('wait');
        return device;
      },
    } as unknown as Adapter;

    assert.equal(await getOrDiscoverDevice(adapter, 'AA:AA:AA:AA:AA:AA', 1000), device);
    assert.deepEqual(calls, ['wait']);
  });

  await t.test('stops discovery even when waitDevice rejects (device never showed up)', async () => {
    const calls: string[] = [];
    const adapter = {
      getDevice: async () => {
        throw new Error('org.bluez.Error.DoesNotExist');
      },
      isDiscovering: async () => false,
      startDiscovery: async () => {
        calls.push('start');
      },
      stopDiscovery: async () => {
        calls.push('stop');
      },
      waitDevice: async () => {
        calls.push('wait');
        throw new Error('timed out waiting for device');
      },
    } as unknown as Adapter;

    await assert.rejects(getOrDiscoverDevice(adapter, 'AA:AA:AA:AA:AA:AA', 1000), /timed out waiting for device/);
    assert.deepEqual(calls, ['start', 'wait', 'stop']);
  });
});

test('withRetries', async (t) => {
  await t.test('returns the first successful result without retrying', async () => {
    let calls = 0;
    const result = await withRetries(3, async () => {
      calls++;
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  await t.test('retries after a failure and returns the eventual success', async () => {
    let calls = 0;
    const result = await withRetries(3, async (attempt) => {
      calls++;
      if (attempt < 2) throw new Error('not yet');
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  await t.test('throws the last error once attempts are exhausted', async () => {
    let calls = 0;
    await assert.rejects(
      withRetries(3, async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }),
      /fail 3/,
    );
    assert.equal(calls, 3);
  });

  await t.test('treats anything less than 1 as a single attempt', async () => {
    let calls = 0;
    await assert.rejects(
      withRetries(0, async () => {
        calls++;
        throw new Error('fail');
      }),
    );
    assert.equal(calls, 1);
  });
});

test('connectWithTimeout', async (t) => {
  await t.test('resolves when connect() resolves before the timeout', async () => {
    const device = { connect: async () => {}, disconnect: async () => {} } as unknown as Device;
    await connectWithTimeout(device, 1000);
  });

  await t.test('rejects when connect() never settles within the timeout', async () => {
    const device = {
      connect: () => new Promise<void>(() => {}),
      disconnect: async () => {},
    } as unknown as Device;
    await assert.rejects(connectWithTimeout(device, 20), /timed out after 20ms/);
  });

  await t.test('propagates a connect() rejection that happens before the timeout', async () => {
    const device = {
      connect: async () => {
        throw new Error('no route to device');
      },
      disconnect: async () => {},
    } as unknown as Device;
    await assert.rejects(connectWithTimeout(device, 1000), /no route to device/);
  });
});
