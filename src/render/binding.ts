import { DOMParser } from "@xmldom/xmldom";
import { Colour } from "../devices/types";
import { TemplateContext } from "./types";
import { applyFormat, DisplayUnits, formatDisplayUnits } from "./formatters";

const SOURCES = ["signalk", "resources", "einklabel", "label"] as const;
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
  /**
   * Only meaningful when `source === 'resources'` - the plugin id of the Resource Provider to query
   * (SignalK's `listResources(resType, params, providerId)`), e.g. `signalk-tides`. Optional - when
   * omitted, the server picks whichever provider is registered for `resource` (its "default"), which is
   * ambiguous/unpredictable when more than one plugin provides the same resource type (e.g. installing
   * a second tides plugin can silently make it the one used instead of the one the template was authored
   * for). Set this to pin a template to one provider regardless of what else is installed.
   */
  provider?: string;
  /**
   * For `source === 'einklabel'`, a dotted path into the plugin's own injected `meta` (e.g. `repainted`);
   * for `source === 'label'`, a dotted path into the physical label's own facts (`manufacturer`, `label`,
   * `width`, `height`, `colours`, `fonts`, `description`, `position` - see `buildLabelContext` below)
   * rather than into vessel/resource data.
   */
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
  /**
   * Substituted in place of the resolved value when that value is missing (`undefined`/`null`,
   * e.g. an unpublished SignalK path) - see `renderBinding`. Distinct from an *unset* default (this
   * field itself being `undefined`), which falls through to the pre-existing "" fallback - explicitly
   * writing `default=` (an empty value) still counts as "given", so a binding can deliberately default
   * to blank rather than to `substituteTextBindings`' own "???" below.
   */
  default?: string;
}

const KNOWN_KEYS = new Set(["source", "context", "resource", "provider", "path", "format", "category", "round", "assets", "default"]);

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
  if (fields.provider && source !== "resources") {
    throw new Error(`invalid binding "${desc}" - "provider" is only valid with source=resources`);
  }
  if (!fields.path) {
    throw new Error(`invalid binding "${desc}" - missing required "path" key`);
  }

  return {
    source,
    context,
    resource: fields.resource,
    provider: fields.provider,
    path: fields.path,
    format: fields.format,
    category: fields.category,
    round: fields.round !== undefined ? Number(fields.round) : undefined,
    assets: fields.assets,
    default: fields.default,
  };
}

/**
 * Key under which a `source=resources` binding's data is stored in `context.resources` (see
 * `assembleRawContext` in repaintScheduler.ts and `cli/liveContext.ts`'s equivalent) - incorporates
 * `provider` so two bindings naming the same `resource` type but different providers (e.g. pinning one
 * template's `tides` binding to `provider=signalk-tides` while another is left to the server's default)
 * don't collide on a single cache entry.
 */
export function resourceContextKey(binding: Pick<Binding, "resource" | "provider">): string {
  return binding.provider ? `${binding.resource}@${binding.provider}` : (binding.resource as string);
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

  if (binding.source === "label") {
    const label = context.label as Record<string, unknown> | undefined;
    if (label === undefined) {
      throw new Error('binding references source "label" but no "label" is present in the render context');
    }
    return getAtPath(label, binding.path);
  }

  const resources = context.resources as Record<string, unknown> | undefined;
  const resourceKey = resourceContextKey(binding);
  const resource = resources?.[resourceKey];
  if (resource === undefined) {
    throw new Error(`binding references resource "${resourceKey}" which is not present in the render context`);
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
 * 0. A missing value (`undefined`/`null`, e.g. an unpublished path) with an explicit `default=` given -
 *    that default, verbatim, bypassing every step below (there's nothing to format).
 * 1. An explicit named `format=` (anything other than `raw`) - `local_time`/`utc_offset`/`position`.
 * 2. An explicit `category=` - for values with no path metadata of their own, e.g. a `source=resources`
 *    value.
 * 3. Otherwise, a `signalk`-sourced value auto-converts to its path's own preferred display unit (from
 *    `context.pathMeta`) by default - `format=raw` opts out of this step only.
 * 4. Falls through to `round=` (`toFixed`), `JSON.stringify` for an unformatted object/array value
 *    (e.g. a path that resolved to a whole sub-tree rather than a leaf) instead of the useless
 *    `String(value)` -> `"[object Object]"`, else `String`. A missing value with no `default=` given
 *    still falls through to the pre-existing "" here, unchanged from before `default=` existed.
 */
export function renderBinding(binding: Binding, context: TemplateContext): string {
  const value = resolveBinding(binding, context);
  if ((value === null || value === undefined) && binding.default !== undefined) return binding.default;
  if (binding.format && binding.format !== "raw") return applyFormat(binding.format, value, context, binding.round);
  if (typeof value === "number") {
    if (binding.category) return formatDisplayUnits(value, resolveCategoryDisplayUnits(binding, context), binding.round);
    const displayUnits = binding.format === "raw" ? undefined : resolveDisplayUnits(binding, context);
    if (displayUnits) return formatDisplayUnits(value, displayUnits, binding.round);
    if (binding.round !== undefined) return value.toFixed(binding.round);
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean | bigint | symbol);
}

const COLOUR_HEX: Record<Colour, string> = { black: "#000000", white: "#FFFFFF", red: "#FF0000", yellow: "#FFFF00" };

/** The only `font-family` values `SvgRenderer` is guaranteed to render - see `expandGenericFontFamilies` in `./svgRenderer.ts`. */
const SAFE_FONT_FAMILIES = ["serif", "sans-serif", "monospace"];

/** Facts about one physical label a `source=label,path=...` binding can reference - see `buildLabelContext`. */
export interface LabelMeta {
  manufacturer: string;
  /** The physical panel's own size label, e.g. `'3.7"'` - `DeviceMetadata.label` verbatim, see `../devices/types.ts`. */
  label: string;
  width: number;
  height: number;
  colours: Colour[];
  description?: string;
  position?: { latitude: number; longitude: number };
}

/**
 * Builds the `context.label` object a `source=label,path=...` binding addresses (e.g.
 * `{source=label,path=width}` in free text, or a `<desc>source=label,path=width</desc>` in an SVG
 * template - every `{...}`/`<desc>` placeholder is a real binding, so a `label` path always needs the
 * explicit `source=label,path=` form to disambiguate it from a `signalk` self path). `colours`/`fonts`
 * are left as arrays (each colour entry pre-annotated with its hex code, e.g. `"black (#000000)"`)
 * rather than joined into a single string, so a caller can either use them bare (renders as JSON) or add
 * `format=csv` (see `./formatters.ts`) for a plain comma-separated list. `position`, if given, is rounded
 * to ~2 decimal places (~1.1km) - fine-grained enough to be meaningfully "for here", coarse enough that
 * ordinary GPS jitter at anchor doesn't change it tick to tick, which matters because `considerRepaint`
 * (`../repaintScheduler.ts`) folds this whole object into every device's dedup hash - full-precision
 * jitter here would otherwise force a repaint (and, for a provider-rendered template, a fresh paid API
 * call) far more often than the underlying position has actually meaningfully changed.
 */
export function buildLabelContext(meta: LabelMeta): Record<string, unknown> {
  const position = meta.position && {
    latitude: Math.round(meta.position.latitude * 100) / 100,
    longitude: Math.round(meta.position.longitude * 100) / 100,
  };
  return {
    manufacturer: meta.manufacturer,
    label: meta.label,
    width: meta.width,
    height: meta.height,
    colours: meta.colours.map((colour) => `${colour} (${COLOUR_HEX[colour]})`),
    fonts: SAFE_FONT_FAMILIES,
    description: meta.description ?? "",
    position: position ? applyFormat("position", position, {}, 2) : undefined,
  };
}

function placeholderContents(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1].trim()))];
}

/**
 * Every binding referenced across one or more free-text fragments - every `{...}` placeholder,
 * deduplicated across all of `texts` combined, parsed exactly the way a template's `<desc>` binding is
 * (`parseBinding` above), so a bare path (`{design.length}`, `source=signalk,context=self` shorthand),
 * the full binding grammar (`{source=signalk,path=navigation.position,format=position}`), and a
 * `source=label,path=...` binding all work uniformly. Pass the result to `assembleRawContext`
 * (`../repaintScheduler.ts`) exactly as a template's own bindings are - it fetches the `signalk`/
 * `resources`-sourced ones and silently ignores `label`/`einklabel`-sourced ones, which resolve directly
 * against `context.label`/`context.meta` instead (built by the caller, not fetched).
 *
 * A placeholder that isn't valid binding grammar (e.g. a typo like `{source=taheight}`) is silently
 * skipped here rather than thrown - the same per-field isolation `SvgRenderer` gives a bad `<desc>`
 * binding, so one malformed placeholder doesn't take down the whole text. `substituteTextBindings` hits
 * the identical parse error at substitution time and turns it into "???" for just that field.
 */
export function findTextBindings(...texts: string[]): Binding[] {
  const seen = new Set<string>();
  const bindings: Binding[] = [];
  for (const text of texts) {
    for (const key of placeholderContents(text)) {
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        bindings.push(parseBinding(key));
      } catch {
        // see doc comment above - left for `substituteTextBindings` to turn into "???"
      }
    }
  }
  return bindings;
}

/**
 * Substitutes every `{...}` placeholder in `text` with its resolved binding value against `context`
 * (built by `assembleRawContext` plus `context.label` from `buildLabelContext` - see
 * `findTextBindings`). Mirrors `renderBinding`'s per-field isolation, but substitutes "???" for anything
 * that resolves to no value at all (missing path, invalid binding grammar) rather than "" - prose with a
 * silently-blank word reads as a fact ("for the sailor of a m vessel"), not as a gap the reader would
 * notice. Two things override that "???": a binding that resolves successfully to a legitimately empty
 * string (e.g. an unset `{source=label,path=description}`) is left as empty, since that's a real answer,
 * not a miss; and a binding with an explicit `default=` uses that default instead, since the caller has
 * already said what a missing value should read as.
 */
export function substituteTextBindings(text: string, context: TemplateContext): string {
  return text.replace(/\{([^{}]+)\}/g, (_match, raw: string) => {
    const key = raw.trim();
    try {
      const binding = parseBinding(key);
      const value = resolveBinding(binding, context);
      if ((value === undefined || value === null) && binding.default === undefined) return "???";
      return renderBinding(binding, context);
    } catch {
      return "???";
    }
  });
}
