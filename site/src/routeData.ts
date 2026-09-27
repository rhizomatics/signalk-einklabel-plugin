import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

/** Pages with a Markdown version, as written to src/generated/markdown/ by scripts/sync-docs.mjs. */
const markdownPaths = new Set(
  Object.keys(import.meta.glob("./generated/markdown/**/*.md", { query: "?raw" })).map((path) => path.slice("./generated/markdown".length)),
);

/** Points each page at its Markdown version (see src/pages/[...slug].md.ts), for agents that look for one. */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.url.pathname;
  const markdownPath = route === "/" ? "/index.md" : `${route.replace(/\/$/, "")}.md`;
  if (!markdownPaths.has(markdownPath)) return;
  context.locals.starlightRoute.head.push({
    tag: "link",
    attrs: { rel: "alternate", type: "text/markdown", href: markdownPath },
  });
});
