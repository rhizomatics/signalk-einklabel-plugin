#!/usr/bin/env node
// Builds the site's pages from the repo's own Markdown - README.md as the home page, plus every page
// under docs/ - so GitHub, npm and the site all read from the same files and never drift.
// Runs automatically before `dev`/`build` (see package.json pre* scripts), and again on every change
// to those files while `astro dev` is running (see the `syncDocsOnChange` integration in astro.config.mjs).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import GithubSlugger from "github-slugger";

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(siteDir, "..");
export const docsDir = resolve(rootDir, "docs");
export const readmePath = resolve(rootDir, "README.md");
const contentDir = resolve(siteDir, "src/content/docs");
export const navPath = resolve(siteDir, "src/generated/nav.json");
const markdownDir = resolve(siteDir, "src/generated/markdown");
const SITE_URL = "https://signalk-einklabel.rhizomatics.org.uk";

const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

export const assetsSrc = resolve(docsDir, "assets");
const assetsDest = resolve(siteDir, "src/assets/readme");

/**
 * Images are referenced as docs/assets/...; copy them under src/assets so Astro's image pipeline
 * can optimize + base-prefix them.
 */
export function copyAssets() {
  rmSync(assetsDest, { recursive: true, force: true });
  mkdirSync(assetsDest, { recursive: true });
  cpSync(assetsSrc, assetsDest, { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
}

/** The site route for a repo Markdown file - README.md is the home page, and a directory's README.md its index. */
function routeFor(file) {
  const rel = relative(rootDir, file).replaceAll("\\", "/");
  if (rel === "README.md") return "/";
  const page = rel.replace(/^docs\//, "").replace(/\.md$/, "");
  return `/${page.replace(/(^|\/)README$/, "$1").replace(/\/$/, "")}/`.replace(/^\/\/$/, "/");
}

/** The URL a page's Markdown is served at for agents - `/getting-started.md` for `/getting-started/`, and `/index.md` for the home page. */
function markdownRouteFor(route) {
  return route === "/" ? "/index.md" : `${route.slice(0, -1)}.md`;
}

/** Where a repo Markdown file's generated page is written. */
function outputFor(file) {
  const route = routeFor(file);
  return route === "/" ? join(contentDir, "index.md") : join(contentDir, `${route.slice(1, -1)}.md`);
}

const ALERTS = { NOTE: "note", TIP: "tip", IMPORTANT: "note", WARNING: "caution", CAUTION: "danger" };

/**
 * A page's `##` sections for the sidebar, with the same anchor ids Astro gives them - every heading is
 * slugged in order (as Astro does), so a repeated heading gets the same `-1` suffix here as on the page.
 * `hasIntro` notes text before the first `##`, which gets its own "Introduction" link.
 */
function outline(markdown) {
  const slugger = new GithubSlugger();
  const sections = [];
  let inFence = false;
  let hasIntro = false;
  for (const line of markdown.split("\n")) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      const text = heading[2]
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_]/g, "");
      const slug = slugger.slug(text);
      if (heading[1] === "##") sections.push({ text, slug });
    } else if (sections.length === 0 && line.trim() && !line.startsWith("<!--")) {
      hasIntro = true;
    }
  }
  return { sections, hasIntro };
}

/** The generated page for one repo Markdown file, as `{ output, content, nav }`. */
function convert(file) {
  let markdown = readFileSync(file, "utf8");
  const output = outputFor(file);

  // The leading `# Title` becomes the page title - Starlight renders that itself.
  const heading = /^#\s+(.+)\n+/.exec(markdown);
  const title = file === resolve(rootDir, "README.md") ? "Overview" : (heading?.[1] ?? "Untitled");
  if (heading) markdown = markdown.slice(heading[0].length);

  // Relative links: to another page -> its site route; to docs/assets -> the copied asset.
  markdown = markdown.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (match, open, target, close) => {
    if (/^(https?:|mailto:|#)/.test(target)) {
      return target.startsWith(SITE_URL) ? `${open}${target.slice(SITE_URL.length) || "/"}${close}` : match;
    }
    const [path, anchor] = target.split("#");
    const resolved = resolve(dirname(file), path);
    if (path.endsWith(".md")) {
      if (!existsSync(resolved)) throw new Error(`${relative(rootDir, file)}: link to missing page ${target}`);
      return `${open}${routeFor(resolved)}${anchor ? `#${anchor}` : ""}${close}`;
    }
    if (resolved.startsWith(assetsSrc)) {
      const asset = join(assetsDest, relative(assetsSrc, resolved));
      return `${open}${relative(dirname(output), asset).replaceAll("\\", "/")}${close}`;
    }
    return match;
  });

  // GitHub alerts (`> [!TIP]`) -> Starlight asides (`:::tip`).
  markdown = markdown.replace(/^> \[!(\w+)\]\n((?:>.*\n?)+)/gm, (match, kind, body) => {
    const aside = ALERTS[kind.toUpperCase()];
    if (!aside) return match;
    return `:::${aside}\n${body.replace(/^> ?/gm, "").trimEnd()}\n:::\n`;
  });

  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(title === "Overview" ? [`description: ${JSON.stringify(pkg.description)}`] : []),
    "---",
    "",
    `<!-- Generated from ${relative(rootDir, file)} by scripts/sync-docs.mjs - do not edit directly. -->`,
    "",
  ].join("\n");

  return { output, content: frontmatter + markdown, nav: { route: routeFor(file), title, ...outline(markdown) } };
}

const RAW_ASSETS_URL = "https://raw.githubusercontent.com/rhizomatics/signalk-einklabel-plugin/main/docs/assets";

/**
 * A page's source Markdown as `{ output, content }`, for serving to agents at its `.md` URL (see
 * src/pages/[...slug].md.ts). Unlike the site page, it keeps the source as written - `# Title`,
 * GitHub alerts and all - with only the links made absolute: to another page -> that page's `.md`,
 * to docs/assets -> the file on GitHub.
 */
function agentMarkdown(file) {
  const content = readFileSync(file, "utf8").replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (match, open, target, close) => {
    if (target.startsWith(SITE_URL)) {
      const [path, anchor] = target.slice(SITE_URL.length).split("#");
      if (!path.endsWith("/")) return match;
      return `${open}${SITE_URL}${markdownRouteFor(path)}${anchor ? `#${anchor}` : ""}${close}`;
    }
    if (/^(https?:|mailto:|#)/.test(target)) return match;
    const [path, anchor] = target.split("#");
    const resolved = resolve(dirname(file), path);
    if (path.endsWith(".md")) return `${open}${SITE_URL}${markdownRouteFor(routeFor(resolved))}${anchor ? `#${anchor}` : ""}${close}`;
    if (resolved.startsWith(assetsSrc)) return `${open}${RAW_ASSETS_URL}/${relative(assetsSrc, resolved).replaceAll("\\", "/")}${close}`;
    return match;
  });
  return { output: join(markdownDir, markdownRouteFor(routeFor(file))), content };
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "assets" ? [] : markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function generatedFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? generatedFiles(path) : [path];
  });
}

/**
 * Regenerates every page, writing only the ones whose content changed and removing any left over
 * from a deleted source - so the dev server only reloads what actually changed. All pages are
 * converted before anything is written, so a mistake (e.g. a link to a missing page) leaves the
 * previous pages in place rather than half-updating them. Also writes each page's Markdown for agents
 * (see agentMarkdown) and the sidebar outline (see astro.config.mjs), returning whether the outline changed.
 */
export function syncPages() {
  const sources = [readmePath, ...markdownFiles(docsDir)];
  const pages = sources.map(convert);
  const agentPages = sources.map(agentMarkdown);
  for (const [dir, files] of [
    [contentDir, pages],
    [markdownDir, agentPages],
  ]) {
    const outputs = new Set(files.map((file) => file.output));
    for (const { output, content } of files) writeIfChanged(output, content);
    for (const stale of generatedFiles(dir).filter((path) => !outputs.has(path))) rmSync(stale);
  }
  return writeIfChanged(
    navPath,
    JSON.stringify(
      pages.map((page) => page.nav),
      null,
      2,
    ),
  );
}

/** Writes `content` unless it's already there, returning whether it did. */
function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  copyAssets();
  syncPages();
}
