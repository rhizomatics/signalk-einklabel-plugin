import type { APIRoute, GetStaticPaths } from "astro";

/** Each page's source Markdown, as written to src/generated/markdown/ by scripts/sync-docs.mjs. */
const pages = import.meta.glob<string>("../generated/markdown/**/*.md", { query: "?raw", import: "default", eager: true });

/** Serves each page's Markdown at its `.md` URL - `/getting-started.md`, `/index.md` for the home page - for agents. */
export const getStaticPaths = (() =>
  Object.entries(pages).map(([path, markdown]) => ({
    params: { slug: path.slice("../generated/markdown/".length, -".md".length) },
    props: { markdown },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => new Response(props.markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
