import test from "node:test";
import assert from "node:assert/strict";
import { mostRecentScheduledSlot } from "./repaintScheduler";

test("mostRecentScheduledSlot", async (t) => {
  await t.test("returns the slot exactly on the hour when now is exactly at a slot", () => {
    const now = new Date(2026, 5, 1, 8, 0, 0, 0);
    assert.deepEqual(mostRecentScheduledSlot(now, 8, 0), new Date(2026, 5, 1, 8, 0, 0, 0));
  });

  await t.test("returns the previous slot when now is between slots", () => {
    // Every 8h at minute 0 -> 00:00, 08:00, 16:00 - at 14:00 the most recent slot is 08:00.
    const now = new Date(2026, 5, 1, 14, 0, 0, 0);
    assert.deepEqual(mostRecentScheduledSlot(now, 8, 0), new Date(2026, 5, 1, 8, 0, 0, 0));
  });

  await t.test("accounts for intervalMinute - doesn't overshoot into the future", () => {
    // Every 8h at minute 30 -> 00:30, 08:30, 16:30 - at 08:15 the 08:30 slot hasn't happened
    // yet, so the most recent slot is still the previous one at 00:30.
    const now = new Date(2026, 5, 1, 8, 15, 0, 0);
    assert.deepEqual(mostRecentScheduledSlot(now, 8, 30), new Date(2026, 5, 1, 0, 30, 0, 0));
  });

  await t.test("rolls back across midnight into the previous day", () => {
    // Every 8h at minute 30 -> 00:30, 08:30, 16:30 - just after midnight (00:00) the 00:30 slot
    // hasn't happened yet, so the most recent slot is 16:30 the day before.
    const now = new Date(2026, 5, 2, 0, 0, 0, 0);
    assert.deepEqual(mostRecentScheduledSlot(now, 8, 30), new Date(2026, 5, 1, 16, 30, 0, 0));
  });

  await t.test("works for a 1-hour interval", () => {
    const now = new Date(2026, 5, 1, 14, 45, 0, 0);
    assert.deepEqual(mostRecentScheduledSlot(now, 1, 0), new Date(2026, 5, 1, 14, 0, 0, 0));
  });
});
