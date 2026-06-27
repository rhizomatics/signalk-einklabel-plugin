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
 * `{ signalk: {...}, resources: { [providerName]: ... } }` by `assembleRawContext` in repaintScheduler.ts.
 */
export type TemplateContext = Record<string, unknown>;

export interface Renderer {
  render(svgTemplatePath: string, context: TemplateContext, width: number, height: number): Promise<Bitmap>;
}
