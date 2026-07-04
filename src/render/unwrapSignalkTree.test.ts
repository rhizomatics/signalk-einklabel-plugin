import test from "node:test";
import assert from "node:assert/strict";
import { unwrapSignalkTree } from "./unwrapSignalkTree";

test("unwrapSignalkTree", async (t) => {
  await t.test("unwraps a leaf's { value, $source, timestamp } wrapper to the bare value", () => {
    assert.equal(
      unwrapSignalkTree({
        path: "environment.moon.phaseName",
        value: "Waning Gibbous",
        $source: "derived-data",
        timestamp: "2026-07-04T00:00:00Z",
      }),
      "Waning Gibbous",
    );
  });

  await t.test("recurses into a namespace object of further-wrapped leaves", () => {
    assert.deepEqual(unwrapSignalkTree({ moon: { phaseName: { value: "New Moon" }, phase: { value: 0.02 } } }), {
      moon: { phaseName: "New Moon", phase: 0.02 },
    });
  });

  await t.test("recurses into arrays", () => {
    assert.deepEqual(unwrapSignalkTree([{ value: 1 }, { value: 2 }]), [1, 2]);
  });

  await t.test("passes through a bare scalar unchanged - e.g. app.getSelfPath('uuid')", () => {
    assert.equal(unwrapSignalkTree("urn:mrn:signalk:uuid:abc123"), "urn:mrn:signalk:uuid:abc123");
    assert.equal(unwrapSignalkTree(undefined), undefined);
    assert.equal(unwrapSignalkTree(null), null);
  });
});
