// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Written by scripts/sync-readme.mjs (runs via the predev/prebuild npm scripts,
// before Astro ever loads this file) from the README's `##` section headings.
const sectionsPath = fileURLToPath(new URL("src/generated/readme-sections.json", import.meta.url));
/** @type {{ text: string, slug: string }[]} */
let readmeSections = [];
try {
  readmeSections = JSON.parse(readFileSync(sectionsPath, "utf8"));
} catch {
  // First run before `npm run sync-readme` has ever executed - sidebar just omits them.
}

// https://astro.build/config
export default defineConfig({
  site: "https://rhizomatics.github.io",
  base: "/signalk-einklabel-plugin",
  integrations: [
    starlight({
      title: "eInk Labels for SignalK",
      description: "Display SignalK data on eInk Electronic Shelf Labels over Bluetooth Low Energy",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rhizomatics/signalk-einklabel-plugin",
        },
      ],
      sidebar: [
        {
          label: "Guide",
          items: [
            { label: "Overview", link: "/" },
            ...readmeSections.map(({ text, slug }) => ({ label: text, link: `/#${slug}` })),
            { autogenerate: { directory: "guides" } },
          ],
        },
      ],
    }),
  ],
});
