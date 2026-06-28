import test from 'node:test';
import assert from 'node:assert/strict';
import { Device } from 'node-ble';
import { connectWithTimeout, createBluetooth, withRetries } from './bleDiscovery';

test('createBluetooth refuses to run on a non-Linux platform', { skip: process.platform === 'linux' }, () => {
  assert.throws(() => createBluetooth(), /requires Linux/);
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
