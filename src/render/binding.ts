import { DOMParser } from "@xmldom/xmldom";
import { TemplateContext } from "./types";
import { applyFormat, DisplayUnits, formatDisplayUnits } from "./formatters";

const SOURCES = ["signalk", "resources", "einklabel"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Parsed form of a `<desc>`'s `key=value,key=value` content - see `parseBinding` for the grammar.
 */
export interface Binding {
  source: Source;
  /** `'self'` (default) or any other literal SignalK context as shown in the Data Browser, e.g. `vessels.urn:mrn:imo:mmsi:232345678`. */
  context: string;
  /** Required when `source === 'resources'` - the Resources API resource type, e.g. `tides`, `waypoints`. */
  resource?: string;
  /** For `source === 'einklabel'`, a dotted path into the plugin's own injected `meta` (e.g. `repainted`), rather than into vessel/resource data. */
  path: string;
  /** A named formatter (see `./formatters.ts`), or `'raw'` to suppress automatic unit conversion (see `renderBinding`). */
  format?: string;
  /** Explicit unit-preferences category (e.g. `depth`, `speed`, `temperature`) for a numeric value with no path metadata of its own, e.g. a `source=resources` value - see `../unitCategories.ts`. */
  category?: string;
  round?: number;
  /**
   * Only meaningful on an `<image>` element's binding (see `SvgRenderer`) - names an `assets/<name>`
   * directory (e.g. `assets=lunar_phases` for `templates/assets/lunar_phases/`) of `<value>.svg` files
   * to pick from by the resolved value (see `../assets.ts`'s `normalizeAssetKey`/`resolveAssetPath`).
   * Looked up under the user's configured templates directory first, then the plugin's own bundled
   * `templates/` directory - never relative to the specific template file itself, so overriding a
   * template doesn't also require duplicating its bundled asset sets.
   */
  assets?: string;
}

const KNOWN_KEYS = new Set(["source", "context", "resource", "path", "format", "category", "round", "assets"]);

/**
 * Parses a `<desc>` element's text content into a `Binding`, e.g.
 * `source=resources,resource=tides,path=extremes[0].level,category=depth,round=2` or, using the
 * defaults (`source=signalk,context=self`), plain `path=navigation.speedOverGround` (auto-converts via
 * that path's own metadata - see `renderBinding`). A bare path with no `key=value` pairs at all, e.g.
 * `environment.forecast.description`, is shorthand for `path=environment.forecast.description`
 * (source/context still default to signalk/self) - SignalK paths never contain `=`, so its absence
 * unambiguously signals this shorthand.
 */
export function parseBinding(desc: string): Binding {
  const trimmedDesc = desc.trim();
  if (trimmedDesc && !trimmedDesc.includes("=")) {
    return { source: "signalk", context: "self", path: trimmedDesc };
  }

  const fields: Record<string, string> = {};
  for (const pair of desc.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      throw new Error(`invalid binding "${desc}" - expected "key=value" pairs, got "${trimmed}"`);
    }
    const key = trimmed.slice(0, eq).trim();
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`invalid binding "${desc}" - unknown key "${key}"`);
    }
    fields[key] = trimmed.slice(eq + 1).trim();
  }

  const source = (fields.source ?? "signalk") as Source;
  if (!SOURCES.includes(source)) {
    throw new Error(`invalid binding "${desc}" - unknown source "${source}"`);
  }
  const context = fields.context ?? "self";
  if (source === "resources" && !fields.resource) {
    throw new Error(`invalid binding "${desc}" - source=resources requires a "resource" key`);
  }
  if (!fields.path) {
    throw new Error(`invalid binding "${desc}" - missing required "path" key`);
  }

  return {
    source,
    context,
    resource: fields.resource,
    path: fields.path,
    format: fields.format,
    category: fields.category,
    round: fields.round !== undefined ? Number(fields.round) : undefined,
    assets: fields.assets,
  };
}

/**
 * Parses every `<text>` and `<image>` element's `<desc>` binding out of raw SVG source - lets a caller
 * discover what data a template needs before fetching anything, with no separate config declaring it
 * (see `assembleRawContext` in repaintScheduler.ts). `<image>` bindings (see `SvgRenderer`) resolve to a
 * picked asset file rather than substituted text, but still need their underlying value fetched the same
 * way as a `<text>` binding.
 */
export function findBindings(svgSource: string): Binding[] {
  const doc = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  const bindings: Binding[] = [];
  for (const tagName of ["text", "image"]) {
    const elements = doc.getElementsByTagName(tagName);
    for (let i = 0; i < elements.length; i++) {
      const desc = elements.item(i)?.getElementsByTagName("desc").item(0);
      if (desc?.textContent) {
        bindings.push(parseBinding(desc.textContent));
      }
    }
  }
  return bindings;
}

/** Supports both `a.[0].b` and `a[0].b` array index notation, matching `setAtPath` in repaintScheduler.ts. */
function getAtPath(obj: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
  let node: unknown = obj;
  for (const segment of segments) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Resolves a parsed `Binding` against the render context assembled by `assembleRawContext`. */
export function resolveBinding(binding: Binding, context: TemplateContext): unknown {
  if (binding.source === "signalk") {
    const signalk = context.signalk as Record<string, unknown> | undefined;
    const vessel = signalk?.[binding.context];
    if (vessel === undefined) {
      throw new Error(`binding references context "${binding.context}" which is not present in the render context`);
    }
    return getAtPath(vessel, binding.path);
  }

  if (binding.source === "einklabel") {
    const meta = context.meta as Record<string, unknown> | undefined;
    if (meta === undefined) {
      throw new Error('binding references source "einklabel" but no "meta" is present in the render context');
    }
    return getAtPath(meta, binding.path);
  }

  const resources = context.resources as Record<string, unknown> | undefined;
  const resource = resources?.[binding.resource as string];
  if (resource === undefined) {
    throw new Error(`binding references resource "${binding.resource}" which is not present in the render context`);
  }
  return getAtPath(resource, binding.path);
}

/**
 * Looks up a `signalk`-sourced binding's path in `context.pathMeta` - a flat `{ [context]:
 * { [dottedPath]: { displayUnits } } }` map (see `../pathMeta.ts`), matching the flat shape
 * `GET .../vessels/<context>/meta` itself returns, unlike `context.signalk`'s nested tree. Unlike
 * `resolveBinding`, never throws - metadata is always best-effort (a `source=resources` binding, a
 * path with no metadata, or a server unreachable at `signalkApiUrl` all resolve to "no metadata"
 * rather than an error).
 */
function resolveDisplayUnits(binding: Binding, context: TemplateContext): DisplayUnits | undefined {
  if (binding.source !== "signalk") return undefined;
  const pathMeta = context.pathMeta as Record<string, Record<string, { displayUnits?: DisplayUnits }>> | undefined;
  return pathMeta?.[binding.context]?.[binding.path]?.displayUnits;
}

/**
 * Looks up an explicit `category=` binding's resolved conversion info from `context.categories` (built
 * by `fetchCategoryDisplayUnits` in `../unitCategories.ts`) - same throw-on-missing pattern as
 * `resolveBinding`'s context/resource lookups, since naming a category is a declared dependency.
 */
function resolveCategoryDisplayUnits(binding: Binding, context: TemplateContext): DisplayUnits {
  const categories = context.categories as Record<string, DisplayUnits> | undefined;
  const displayUnits = categories?.[binding.category as string];
  if (!displayUnits) {
    throw new Error(`binding references category "${binding.category}" which is not present in the render context`);
  }
  return displayUnits;
}

/**
 * Resolves a binding and renders it to text exactly as `SvgRenderer` does for a `<desc>` - shared so
 * the CLI's `field`/`fields` commands show the same thing a real render would.
 *
 * Precedence for a numeric value:
 * 1. An explicit named `format=` (anything other than `raw`) - `local_time`/`utc_offset`/`position`.
 * 2. An explicit `category=` - for values with no path metadata of their own, e.g. a `source=resources`
 *    value.
 * 3. Otherwise, a `signalk`-sourced value auto-converts to its path's own preferred display unit (from
 *    `context.pathMeta`) by default - `format=raw` opts out of this step only.
 * 4. Falls through to `round=` (`toFixed`), `JSON.stringify` for an unformatted object/array value
 *    (e.g. a path that resolved to a whole sub-tree rather than a leaf) instead of the useless
 *    `String(value)` -> `"[object Object]"`, else `String`.
 */
export function renderBinding(binding: Binding, context: TemplateContext): string {
  const value = resolveBinding(binding, context);
  if (binding.format && binding.format !== "raw") return applyFormat(binding.format, value, context, binding.round);
  if (typeof value === "number") {
    if (binding.category) return formatDisplayUnits(value, resolveCategoryDisplayUnits(binding, context), binding.round);
    const displayUnits = binding.format === "raw" ? undefined : resolveDisplayUnits(binding, context);
    if (displayUnits) return formatDisplayUnits(value, displayUnits, binding.round);
    if (binding.round !== undefined) return value.toFixed(binding.round);
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
