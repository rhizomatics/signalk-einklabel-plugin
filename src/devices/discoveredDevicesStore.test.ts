import test from "node:test";
import assert from "node:assert/strict";
import { DISCOVERED_DEVICE_TTL_MS, mergeDiscoveredDevices } from "./discoveredDevicesStore";
import { DiscoveredDevice } from "./types";

function device(address: string, overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return { address, vendor: "zhsunyco", pid: 0x14, ...overrides };
}

test("mergeDiscoveredDevices", async (t) => {
  await t.test("adds devices found in a scan with no prior history", () => {
    const now = 1000;
    const merged = mergeDiscoveredDevices({}, [device("aa:aa")], now);
    assert.deepEqual(merged, { "aa:aa": { address: "aa:aa", vendor: "zhsunyco", pid: 0x14, lastSeenAt: now } });
  });

  await t.test("bumps lastSeenAt for a device found again", () => {
    const previous = { "aa:aa": { ...device("aa:aa"), lastSeenAt: 1000 } };
    const merged = mergeDiscoveredDevices(previous, [device("aa:aa")], 2000);
    assert.equal(merged["aa:aa"].lastSeenAt, 2000);
  });

  await t.test("keeps a previously seen device that's missing from this scan, within the TTL", () => {
    const previous = { "aa:aa": { ...device("aa:aa"), lastSeenAt: 1000 } };
    const merged = mergeDiscoveredDevices(previous, [], 1000 + DISCOVERED_DEVICE_TTL_MS - 1);
    assert.ok(merged["aa:aa"]);
    assert.equal(merged["aa:aa"].lastSeenAt, 1000);
  });

  await t.test("drops a previously seen device once its lastSeenAt is older than the TTL", () => {
    const previous = { "aa:aa": { ...device("aa:aa"), lastSeenAt: 1000 } };
    const merged = mergeDiscoveredDevices(previous, [], 1000 + DISCOVERED_DEVICE_TTL_MS);
    assert.equal(merged["aa:aa"], undefined);
  });

  await t.test("keeps devices found this scan and drops expired ones in the same merge", () => {
    const previous = {
      "aa:aa": { ...device("aa:aa"), lastSeenAt: 0 },
      "bb:bb": { ...device("bb:bb"), lastSeenAt: 1000 },
    };
    const merged = mergeDiscoveredDevices(previous, [device("bb:bb")], DISCOVERED_DEVICE_TTL_MS);
    assert.equal(merged["aa:aa"], undefined);
    assert.equal(merged["bb:bb"].lastSeenAt, DISCOVERED_DEVICE_TTL_MS);
  });
});
