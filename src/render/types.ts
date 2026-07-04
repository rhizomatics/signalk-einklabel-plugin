/**
 * Common raster output produced by the SVG renderer, before any
 * vendor-specific colour quantisation or bit-packing is applied.
 */
export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, top-left origin */
  data: Uint8Array;
}

/**
 * Render context a template's `<desc>` bindings resolve against - see `./binding.ts`. Shaped as
 * `{ signalk: { self: {...}, [vesselContext]: {...} }, resources: { [resourceName]: ... },
 * pathMeta: { [context]: { [dottedPath]: { displayUnits } } }, categories: { [categoryName]:
 * DisplayUnits } }` by `assembleRawContext` in repaintScheduler.ts, fetched fresh from a template's own
 * bindings every repaint - no separate config declares what a template needs. `pathMeta` is flat
 * (dotted-path keyed, matching `GET .../vessels/<context>/meta`'s own shape), unlike `signalk`'s nested
 * tree - it backs automatic unit conversion for a `signalk`-sourced numeric value (`format=raw` opts
 * out). `categories` backs an explicit `category=` binding, for a value with no path metadata of its
 * own (see `../unitCategories.ts`). `meta` (unrelated, plugin-injected) holds `repainted`, the ISO
 * timestamp of this repaint - resolved by a `source=einklabel` binding (see `considerRepaint`).
 */
export type TemplateContext = Record<string, unknown>;

export interface Renderer {
  render(svgTemplatePath: string, context: TemplateContext, width: number, height: number, templatesDir?: string, bundledTemplatesDir?: string): Promise<Bitmap>;
}
