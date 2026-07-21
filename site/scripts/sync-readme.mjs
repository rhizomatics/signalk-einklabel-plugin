#!/usr/bin/env node
// Regenerates the docs homepage from the repo README.md so the two never drift.
// Re-run automatically before `dev`/`build` (see package.json pre* scripts).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(siteDir, "..");

const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

const assetsSrc = resolve(rootDir, "docs/assets");
const assetsDest = resolve(siteDir, "src/assets/readme");
rmSync(assetsDest, { recursive: true, force: true });
mkdirSync(assetsDest, { recursive: true });
cpSync(assetsSrc, assetsDest, {
  recursive: true,
  filter: (src) => !src.endsWith(".DS_Store"),
});

let readme = readFileSync(resolve(rootDir, "README.md"), "utf8");

// Drop the leading `# Title` heading — it's identical to the site title (set in
// astro.config.mjs), so keeping it as the page title too would render as
// "eInk Labels for SignalK | eInk Labels for SignalK" in the browser tab.
readme = readme.replace(/^#\s+.+\n+/, "");
const title = "Overview";

// Images are referenced from the repo root as `docs/assets/...`; point them at the
// copy under src/assets so Astro's image pipeline can optimize + base-prefix them.
readme = readme.replaceAll("(docs/assets/", "(../../assets/readme/");

// README uses GFM-style `{#custom-id}` heading attributes, which Astro's markdown
// doesn't support natively (it would render the literal `{#id}` text). Strip the
// attribute and rewrite in-page links to the slug Astro's slugger derives instead.
const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-");

const customIdSlugs = new Map();
readme = readme.replace(/^(#{1,6}\s+.+?)\s*\{#([\w-]+)\}\s*$/gm, (_match, heading, customId) => {
  customIdSlugs.set(customId, slugify(heading.replace(/^#{1,6}\s+/, "")));
  return heading;
});
for (const [customId, slug] of customIdSlugs) {
  readme = readme.replaceAll(`(#${customId})`, `(#${slug})`);
}

const frontmatter = [
  "---",
  `title: ${JSON.stringify(title)}`,
  `description: ${JSON.stringify(pkg.description)}`,
  "---",
  "",
  "<!-- Generated from ../../../../README.md by scripts/sync-readme.mjs — do not edit directly. -->",
  "",
].join("\n");

const outDir = resolve(siteDir, "src/content/docs");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.md"), frontmatter + readme);
