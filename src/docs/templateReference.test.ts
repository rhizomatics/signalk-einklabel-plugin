import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES_DOCS_DIR, bundledTemplateNames, regenerateExampleDocs, templateReference } from "./templateReference";

test("docs/examples' generated template reference blocks are up to date", () => {
  const stale = regenerateExampleDocs(EXAMPLES_DOCS_DIR)
    .filter((page) => page.stale)
    .map((page) => page.path);
  assert.deepEqual(stale, [], "run `npm run docs:templates` to regenerate them");
});

test("every bundled template has a reference block on some example page", () => {
  const pages = regenerateExampleDocs(EXAMPLES_DOCS_DIR)
    .map((page) => page.current)
    .join("\n");
  for (const name of bundledTemplateNames()) {
    assert.ok(pages.includes(`<!-- BEGIN GENERATED: template-reference ${name} -->`), name);
  }
});

test("templateReference", async (t) => {
  const reference = templateReference("tides");

  await t.test("lists each size variant with its aspect ratio and the labels it fits exactly", () => {
    assert.match(reference, /`tides\/416x240-BWRY\.svg`.*\| 416 × 240 \| 1\.73 : 1 \| black, white, red, yellow \| Zhsunyco 3\.7" BWRY \|/);
  });

  await t.test("collapses array indexes so each field appears once, with every option it's used with", () => {
    const timeRows = reference.split("\n").filter((line) => line.includes("`extremes[n].time`"));
    assert.equal(timeRows.length, 1);
    assert.match(timeRows[0], /format `local_time`, format `day_mon`/);
  });

  await t.test("notes which variants use a field that not all of them do", () => {
    assert.match(reference, /\| Signal K path \| `environment\.moon\.phaseName` \| image from `lunar_phases` \| 416x240-BWRY \|/);
  });
});
