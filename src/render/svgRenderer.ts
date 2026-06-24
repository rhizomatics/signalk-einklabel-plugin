import { Bitmap, Renderer, TemplateContext } from './types';

/**
 * Renders an SVG+Handlebars template to a common RGB bitmap.
 * Library choice (resvg-wasm vs. alternatives) is still being evaluated — see spec.md review notes.
 */
export class SvgRenderer implements Renderer {
  async render(_svgTemplatePath: string, _context: TemplateContext, _width: number, _height: number): Promise<Bitmap> {
    throw new Error('SVG rendering not yet implemented');
  }
}
