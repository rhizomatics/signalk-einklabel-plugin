// @ts-check
import { readFileSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import { assetsSrc, copyAssets, docsDir, navPath, readmePath, syncPages } from "./scripts/sync-docs.mjs";

/** Pages whose sections are listed open in the sidebar - every other page starts collapsed. */
const EXPANDED = ["/", "/examples/"];

/** Top-level sidebar order, by route - anything under /examples/ is grouped under Examples instead. */
const PAGE_ORDER = ["/", "/getting-started/", "/templates/", "/examples/", "/bluetooth/", "/faq/", "/cli/", "/extending/"];

/**
 * One sidebar entry per page, expanded to its `##` sections (plus an "Introduction" link to any text
 * before the first one), from the outline scripts/sync-docs.mjs writes alongside the pages.
 */
function sidebar() {
  /** @type {{ route: string, title: string, hasIntro: boolean, sections: { text: string, slug: string }[] }[]} */
  let pages = [];
  try {
    pages = JSON.parse(readFileSync(navPath, "utf8"));
  } catch {
    // Not synced yet - `predev`/`prebuild` always sync first, so this is only a bare `astro` call.
  }
  /** @param {(typeof pages)[number]} page */
  // Some link must be the plain page URL, or Starlight won't recognise the current page and open its
  // group - so with no introduction, the first section (at the top of the page anyway) links there.
  const links = (page) => {
    const intro = page.hasIntro || page.sections.length === 0;
    return [
      ...(intro ? [{ label: "Introduction", link: page.route }] : []),
      ...page.sections.map((section, i) => ({
        label: section.text,
        link: !intro && i === 0 ? page.route : `${page.route}#${section.slug}`,
      })),
    ];
  };
  const byRoute = new Map(pages.map((page) => [page.route, page]));
  const examples = pages.filter((page) => page.route.startsWith("/examples/") && page.route !== "/examples/");
  const order = [
    ...PAGE_ORDER,
    ...pages.map((page) => page.route).filter((route) => !PAGE_ORDER.includes(route) && !route.startsWith("/examples/")),
  ];
  return order.flatMap((route) => {
    const page = byRoute.get(route);
    if (!page) return [];
    if (route === "/examples/") {
      return [
        {
          label: page.title,
          items: [...links(page), ...examples.map((example) => ({ label: example.title, collapsed: true, items: links(example) }))],
        },
      ];
    }
    return [{ label: page.title, collapsed: !EXPANDED.includes(route), items: links(page) }];
  });
}

/**
 * While `astro dev` runs, regenerates the pages whenever README.md or anything under docs/ changes -
 * they live outside src/, so Astro wouldn't otherwise notice. Astro then hot-reloads the regenerated
 * page itself. A failed sync (e.g. a link to a page that doesn't exist yet, mid-edit) is logged
 * rather than stopping the server.
 */
const configPath = fileURLToPath(import.meta.url);

/** @type {import("astro").AstroIntegration} */
const syncDocsOnChange = {
  name: "sync-docs-on-change",
  hooks: {
    "astro:server:setup": ({ server, logger }) => {
      server.watcher.add([readmePath, docsDir]);
      /** @param {string} path */
      const onChange = (path) => {
        if (path !== readmePath && !path.startsWith(docsDir)) return;
        try {
          if (path.startsWith(assetsSrc)) copyAssets();
          // The sidebar is built from the page outline when this config loads - touching the config
          // makes Astro restart and reload it, when a heading was added, renamed or removed.
          else if (syncPages()) utimesSync(configPath, new Date(), new Date());
          logger.info(`synced docs after change to ${path.slice(docsDir.length - "docs".length)}`);
        } catch (err) {
          logger.error(`docs sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      for (const event of ["add", "change", "unlink"]) server.watcher.on(event, onChange);
    },
  },
};

// https://astro.build/config
export default defineConfig({
  site: "https://signalk-einklabel.rhizomatics.org.uk",
  integrations: [
    syncDocsOnChange,
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
      // Pages are generated from ../README.md and ../docs/ by scripts/sync-docs.mjs.
      sidebar: sidebar(),
      // /llms.txt, /llms-full.txt and /llms-small.txt - the docs as plain Markdown for coding agents.
      plugins: [
        starlightLlmsTxt({
          projectName: "signalk-einklabel-plugin",
          details: [
            "A SignalK server plugin (npm `@rhizomatics/signalk-einklabel-plugin`) that renders SVG templates bound to",
            "SignalK paths and pushes them over Bluetooth Low Energy to eInk Electronic Shelf Labels (Gicisky and",
            "ZhSunyco labels). It also ships `esl-cli` for scanning, rendering and pushing images outside the server.",
          ].join(" "),
          promote: ["index*", "getting-started*", "templates*", "examples/**"],
          optionalLinks: [
            {
              label: "GitHub repository",
              url: "https://github.com/rhizomatics/signalk-einklabel-plugin",
              description: "source, bundled templates and issue tracker",
            },
            {
              label: "SignalK documentation",
              url: "https://demo.signalk.org/documentation/",
              description: "the SignalK server and data model the plugin reads from",
            },
          ],
        }),
      ],
    }),
  ],
});
