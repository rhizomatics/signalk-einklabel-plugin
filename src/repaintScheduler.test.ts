import test from "node:test";
import assert from "node:assert/strict";
import { oneAtATimePerKey, mostRecentScheduledSlot } from "./repaintScheduler";

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

test("oneAtATimePerKey", async (t) => {
  /** A `run` whose calls finish only when released, recording each start. */
  function controllable() {
    const started: string[] = [];
    const releases: ((ok: boolean) => void)[] = [];
    const run = (arg: { key: string; id: string }) =>
      new Promise<boolean>((resolve) => {
        started.push(arg.id);
        releases.push(resolve);
      });
    return { started, releases, run };
  }
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  await t.test("folds calls made mid-run into one follow-up with the latest arguments, after a success", async () => {
    const { started, releases, run } = controllable();
    const busy: string[] = [];
    const call = oneAtATimePerKey(
      (arg: { key: string; id: string }) => arg.key,
      run,
      (arg) => busy.push(arg.id),
    );

    const first = call({ key: "tides", id: "a" });
    void call({ key: "tides", id: "b" });
    void call({ key: "tides", id: "c" });
    await flush();
    assert.deepEqual(started, ["a"]);
    assert.deepEqual(busy, ["b", "c"]);

    releases[0](true);
    await flush();
    assert.deepEqual(started, ["a", "c"]);
    releases[1](true);
    await first;
  });

  await t.test("drops the follow-up when the current run failed", async () => {
    const { started, releases, run } = controllable();
    const call = oneAtATimePerKey((arg: { key: string; id: string }) => arg.key, run);

    const first = call({ key: "tides", id: "a" });
    void call({ key: "tides", id: "b" });
    await flush();
    releases[0](false);
    await first;
    assert.deepEqual(started, ["a"]);
  });

  await t.test("runs different keys independently", async () => {
    const { started, releases, run } = controllable();
    const call = oneAtATimePerKey((arg: { key: string; id: string }) => arg.key, run);

    void call({ key: "tides", id: "a" });
    void call({ key: "watch", id: "b" });
    await flush();
    assert.deepEqual(started, ["a", "b"]);
    releases.forEach((release) => release(true));
  });

  await t.test("frees the key even when the run throws", async () => {
    const call = oneAtATimePerKey(
      (arg: string) => arg,
      async () => {
        throw new Error("boom");
      },
    );
    await assert.rejects(call("tides"), /boom/);
    await assert.rejects(call("tides"), /boom/);
  });
});
