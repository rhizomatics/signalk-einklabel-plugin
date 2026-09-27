import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { Binding, findBindings, readTemplateDimensions } from "../render/binding";
import { BUNDLED_TEMPLATES_DIR, listSvgFiles, listTemplateFamilies, listTemplateVariants } from "../config";
import { Colour, DeviceMetadata } from "../devices/types";
import { ZhsunycoDriver } from "../devices/zhsunyco";
import { GiciskyDriver } from "../devices/gicisky";

/**
 * Generates the "Template reference" blocks in the docs' example pages from the bundled templates
 * themselves - sizes, aspect ratios, colours, which supported labels each size fits, and the data
 * fields each one reads - so that reference can't drift from the templates it describes. Blocks sit
 * between `<!-- BEGIN GENERATED: <kind> [<template>] -->` and `<!-- END GENERATED -->` markers in
 * hand-written pages; everything outside them is left alone. Run `npm run docs:templates` to update,
 * and `templateReference.test.ts` fails when a block is stale.
 */

const TEMPLATE_SOURCE_URL = "https://github.com/rhizomatics/signalk-einklabel-plugin/blob/main/templates";
const MARKER = /<!-- BEGIN GENERATED: ([\w-]+)(?: ([^\s>]+))? -->[\s\S]*?<!-- END GENERATED -->/g;

interface TemplateFile {
  /** Path relative to the templates directory, e.g. `tides/416x240-BWRY.svg`. */
  path: string;
  width?: number;
  height?: number;
  colours?: Colour[];
  bindings: Binding[];
}

const COLOUR_LETTER: Record<Colour, string> = { black: "B", white: "W", red: "R", yellow: "Y" };

function supportedLabels(): DeviceMetadata[] {
  return [new ZhsunycoDriver(), new GiciskyDriver()].flatMap((driver) => driver.supportedDevices());
}

/** Every file a bundled template name covers - one for a plain `.svg`, one per variant for a family directory. */
function templateFiles(templatesDir: string, templateName: string): TemplateFile[] {
  const path = join(templatesDir, templateName);
  if (!existsSync(path)) {
    throw new Error(`template "${templateName}" not found in ${templatesDir}`);
  }
  const read = (relativePath: string, colours?: Colour[]): TemplateFile => {
    const source = readFileSync(join(templatesDir, relativePath), "utf-8");
    return { path: relativePath, ...readTemplateDimensions(source), colours, bindings: findBindings(source) };
  };
  if (statSync(path).isDirectory()) {
    return listTemplateVariants(path)
      .sort((a, b) => b.width - a.width || b.height - a.height)
      .map((variant) => read(`${templateName}/${variant.fileName}`, variant.colours));
  }
  return [read(templateName)];
}

function variantName(file: TemplateFile): string {
  return file.path
    .split("/")
    .pop()!
    .replace(/\.svg$/, "");
}

function aspectRatio(width: number, height: number): string {
  return `${(width / height).toFixed(2)} : 1`;
}

function matchingLabels(file: TemplateFile, labels: DeviceMetadata[]): string {
  const matches = labels
    .filter((label) => label.width === file.width && label.height - label.voffset === file.height)
    .map((label) => {
      const colours = label.colours.map((colour) => COLOUR_LETTER[colour]).join("");
      // Some models' own label already names their colours (e.g. Gicisky's `2.9" BWR`).
      const name = label.label.includes(colours) ? label.label : `${label.label} ${colours}`;
      return `${label.manufacturer ?? ""} ${name}`.trim();
    });
  return matches.length > 0 ? [...new Set(matches)].join(", ") : "none exactly - see [Reframing](../templates.md#reframing)";
}

function describeSource(binding: Binding): string {
  switch (binding.source) {
    case "signalk":
      return binding.context === "self" ? "Signal K path" : `Signal K path (${binding.context})`;
    case "resources":
      return `\`${binding.resource}\` resource${binding.provider ? ` (provider \`${binding.provider}\`)` : ""}`;
    case "einklabel":
      return "Plugin";
    case "label":
      return "Label details";
  }
}

function describeOptions(binding: Binding): string[] {
  return [
    binding.assets && `image from \`${binding.assets}\``,
    binding.format && `format \`${binding.format}\``,
    binding.category && `category \`${binding.category}\``,
    binding.round !== undefined && `round ${binding.round}`,
    binding.default !== undefined && `default \`${binding.default}\``,
  ].filter((option): option is string => Boolean(option));
}

/** A table row per distinct field - array indexes collapsed, so `extremes[0].time` and `extremes[2].time` are one row. */
function fieldsTable(files: TemplateFile[]): string {
  const rows = new Map<string, { source: string; path: string; options: Set<string>; usedIn: Set<string> }>();
  for (const file of files) {
    for (const binding of file.bindings) {
      const source = describeSource(binding);
      const path = binding.path.replace(/\[\d+\]/g, "[n]");
      const key = `${source}\u0000${path}`;
      const row = rows.get(key) ?? { source, path, options: new Set<string>(), usedIn: new Set<string>() };
      describeOptions(binding).forEach((option) => row.options.add(option));
      row.usedIn.add(variantName(file));
      rows.set(key, row);
    }
  }
  const showUsedIn = files.length > 1;
  const header = showUsedIn ? "| Source | Path | Options | Used in |\n|---|---|---|---|" : "| Source | Path | Options |\n|---|---|---|";
  const sorted = [...rows.values()].sort((a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path));
  const lines = sorted.map((row) => {
    const usedIn = row.usedIn.size === files.length ? "all" : [...row.usedIn].join(", ");
    const cells = [row.source, `\`${row.path}\``, [...row.options].join(", ") || "-", ...(showUsedIn ? [usedIn] : [])];
    return `| ${cells.join(" | ")} |`;
  });
  return [header, ...lines].join("\n");
}

/** The reference block for one bundled template name, e.g. `tides` (a family) or `tide.svg`. */
export function templateReference(templateName: string, templatesDir = BUNDLED_TEMPLATES_DIR): string {
  const files = templateFiles(templatesDir, templateName);
  const labels = supportedLabels();
  const sizes = files.map((file) => {
    const size = file.width && file.height ? `${file.width} × ${file.height}` : "-";
    const ratio = file.width && file.height ? aspectRatio(file.width, file.height) : "-";
    const colours = file.colours?.join(", ") ?? "-";
    return `| [\`${file.path}\`](${TEMPLATE_SOURCE_URL}/${file.path}) | ${size} | ${ratio} | ${colours} | ${matchingLabels(file, labels)} |`;
  });
  return [
    `**Template:** \`${templateName}\``,
    "",
    "| File | Size (px) | Aspect ratio | Colours | Fits these labels exactly |",
    "|---|---|---|---|---|",
    ...sizes,
    "",
    "**Data used**",
    "",
    fieldsTable(files),
  ].join("\n");
}

/** Every bundled template name a user can pick - plain `.svg` files and family directories, not dot-prefixed internals. */
export function bundledTemplateNames(templatesDir = BUNDLED_TEMPLATES_DIR): string[] {
  return [...listTemplateFamilies(templatesDir), ...listSvgFiles(templatesDir)].sort();
}

/** A one-row-per-template summary, linking each to the example page whose reference block covers it. */
export function templatesSummary(pagesByTemplate: Map<string, string>, templatesDir = BUNDLED_TEMPLATES_DIR): string {
  const rows = bundledTemplateNames(templatesDir).map((name) => {
    const files = templateFiles(templatesDir, name);
    const sizes = files.map((file) => (file.width && file.height ? `${file.width}×${file.height}` : "?")).join(", ");
    // Only what has to come from outside the plugin - its own and the label's details are always there.
    const external = files
      .flatMap((file) => file.bindings)
      .filter((binding) => binding.source === "signalk" || binding.source === "resources");
    const resources = external.filter((binding) => binding.source === "resources").map(describeSource);
    const paths = external.filter((binding) => binding.source === "signalk").map((binding) => `\`${binding.path}\``);
    const sources = [...new Set(resources), ...(paths.length > 0 ? [`Signal K ${[...new Set(paths)].sort().join(", ")}`] : [])];
    const page = pagesByTemplate.get(name);
    return `| ${page ? `[\`${name}\`](${page})` : `\`${name}\``} | ${sizes} | ${sources.join(", ") || "-"} |`;
  });
  return ["| Template | Sizes | Data needed |", "|---|---|---|", ...rows].join("\n");
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/**
 * Regenerates every marked block under `examplesDir`, returning each file's current and regenerated
 * content. `templates-summary` blocks link to whichever page holds a template's `template-reference`
 * block, so all pages are scanned for those first.
 */
export function regenerateExampleDocs(
  examplesDir: string,
  templatesDir = BUNDLED_TEMPLATES_DIR,
): { path: string; current: string; updated: string; stale: boolean }[] {
  const pages = markdownFiles(examplesDir).map((path) => ({ path, current: readFileSync(path, "utf-8") }));
  const pagesByTemplate = new Map<string, string>();
  for (const page of pages) {
    for (const match of page.current.matchAll(MARKER)) {
      if (match[1] === "template-reference" && match[2]) {
        pagesByTemplate.set(match[2], page.path.slice(examplesDir.length + 1));
      }
    }
  }
  return pages.map((page) => {
    const updated = page.current.replace(MARKER, (_block, kind: string, arg: string | undefined) => {
      const body =
        kind === "template-reference" && arg
          ? templateReference(arg, templatesDir)
          : kind === "templates-summary"
            ? templatesSummary(pagesByTemplate, templatesDir)
            : undefined;
      if (body === undefined) throw new Error(`${page.path}: unknown generated block "${kind}${arg ? ` ${arg}` : ""}"`);
      return `<!-- BEGIN GENERATED: ${kind}${arg ? ` ${arg}` : ""} -->\n<!-- Generated from the bundled templates by \`npm run docs:templates\` - do not edit by hand. -->\n\n${body}\n\n<!-- END GENERATED -->`;
    });
    return { ...page, updated, stale: ignoringTableAlignment(updated) !== ignoringTableAlignment(page.current) };
  });
}

/**
 * The formatter (`oxfmt`, run by `npm run docs:templates` after this) pads Markdown table columns to
 * line up, which this generator doesn't - so compare with that padding stripped, or a freshly
 * formatted page would always look stale.
 */
function ignoringTableAlignment(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => (line.startsWith("|") ? line.replace(/\s*\|\s*/g, "|").replace(/-{3,}/g, "---") : line))
    .join("\n");
}

export const EXAMPLES_DOCS_DIR = join(__dirname, "..", "..", "docs", "examples");

if (require.main === module) {
  const changed = regenerateExampleDocs(EXAMPLES_DOCS_DIR).filter((page) => page.stale);
  for (const page of changed) writeFileSync(page.path, page.updated);
  console.log(changed.length > 0 ? `updated ${changed.map((page) => page.path).join(", ")}` : "template docs already up to date");
}
