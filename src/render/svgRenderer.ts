import { readFile } from 'fs/promises';
import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { Bitmap, Renderer, TemplateContext } from './types';
import { parseBinding, renderBinding, resolveBinding } from './binding';
import { describeAssetsDirProblem, normalizeAssetKey, resolveAssetPath } from './assets';
import { DEFAULT_FONT_PATHS, GENERIC_FONT_FAMILY_MAP } from './fonts';
import { PLUGIN_NAME } from '../pluginVersion';

let wasmReady: Promise<void> | undefined;

function ensureWasmInitialized(): Promise<void> {
  if (!wasmReady) {
    wasmReady = readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).then((buffer) => initWasm(buffer));
  }
  return wasmReady;
}

// Only matches the CSS `font-family:` declaration inside a style="..." attribute, not the bare
// XML `font-family="..."` presentation attribute - rewriting the latter in place would require
// quote-aware handling of the surrounding XML attribute delimiter to avoid corrupting the
// document, and it's unnecessary: resvg-wasm (and any browser) prefers the style declaration
// whenever both are present, and every <text>/<tspan> in our templates sets one.
const GENERIC_FONT_FAMILY_PATTERN = /font-family\s*:\s*(['"]?)(sans-serif|serif|monospace)\1(?=\s*[;"])/g;

/**
 * Rewrites CSS generic font-family keywords to the literal embedded name of the bundled font
 * that backs each bucket (see GENERIC_FONT_FAMILY_MAP, ./fonts.ts), e.g. `font-family:sans-serif`
 * becomes `font-family:'Roboto',sans-serif`. resvg-wasm only selects a font by exact name match -
 * it does not route generic keywords to "the right" loaded font itself (see project memory) - so
 * this lets templates use plain `serif`/`sans-serif`/`monospace` (as Inkscape writes by default)
 * instead of every template author having to hardcode each bundled font's exact embedded name.
 * The original generic keyword is kept as a trailing fallback so the rewritten value stays valid
 * CSS for preview in e.g. Inkscape or a browser; it's inert as far as resvg-wasm is concerned.
 */
function expandGenericFontFamilies(svgSource: string): string {
  return svgSource.replace(GENERIC_FONT_FAMILY_PATTERN, (_match, _quote: string, generic: string) => {
    return `font-family:'${GENERIC_FONT_FAMILY_MAP[generic]}',${generic}`;
  });
}

/**
 * Renders an SVG+binding template to a common RGBA bitmap.
 *
 * Binding model: a `<text>` element with a `<desc>` child has that child's
 * content parsed as a flat `key=value,key=value` binding against the render
 * context and substituted in as the element's text, e.g.
 * `<desc>source=resources,resource=tides,path=extremes[0].time,format=local_time</desc>`
 * (see `./binding.ts` for the grammar and `./formatters.ts` for the `format=` registry).
 * The `<text>` element's own visible content is left untouched in the source
 * file - it's just a placeholder so the template looks sane while laying it
 * out in an SVG editor - and is only overwritten in the in-memory copy used
 * for this render. `<text>` elements with no `<desc>` are left as static text.
 * Scoped to `<text>` rather than all elements with an id - setting `textContent`
 * on a structural element (e.g. the root `<svg>`) wipes its children, and
 * `getElementsByTagName` is a live NodeList, so that previously truncated the
 * whole tree and rendered blank.
 *
 * Non-textual inclusion: an `<image>` element with a `<desc>` child works the same way, except the
 * resolved value picks one of a directory of `.svg` files (an `assets=` key, required, names that
 * directory - see `./assets.ts`) rather than substituting text, and the element is dropped entirely
 * (rather than showing an error placeholder) whenever the value is unavailable or doesn't map to a
 * file - e.g. a device without the `derived-data` plugin installed simply shows no moon-phase icon.
 * The matched file's contents are inlined as a `data:image/svg+xml;base64,...` URI so no filesystem
 * access happens at resvg-wasm's render step.
 *
 * resvg-wasm cannot see the host's installed fonts (`loadSystemFonts`/`fontFiles`
 * are silently no-ops under plain Node) - it only renders text if given font
 * bytes directly via `fontBuffers`, read from disk by us. Without at least one
 * font path configured, all text elements render as nothing, with no error.
 * Defaults to the bundled monospace/sans-serif/serif trio (see ./fonts.ts) so
 * templates can use plain CSS generic font-family keywords.
 */
export class SvgRenderer implements Renderer {
  private fontBuffers?: Promise<Uint8Array[]>;

  constructor(private readonly fontPaths: string[] = DEFAULT_FONT_PATHS) {
    if (fontPaths.length === 0) {
      throw new Error('SvgRenderer requires at least one font path - resvg-wasm cannot use host system fonts');
    }
  }

  private loadFontBuffers(): Promise<Uint8Array[]> {
    if (!this.fontBuffers) {
      this.fontBuffers = Promise.all(this.fontPaths.map(async (path) => new Uint8Array(await readFile(path))));
    }
    return this.fontBuffers;
  }

  async render(svgTemplatePath: string, context: TemplateContext, width: number, height: number, fallbackTemplateDir?: string): Promise<Bitmap> {
    const [, fontBuffers] = await Promise.all([ensureWasmInitialized(), this.loadFontBuffers()]);

    const svgSource = expandGenericFontFamilies(await readFile(svgTemplatePath, 'utf-8'));
    const doc = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
    const elements = doc.getElementsByTagName('text');

    for (let i = 0; i < elements.length; i++) {
      const element = elements.item(i);
      if (!element) continue;

      const descElement = element.getElementsByTagName('desc').item(0);
      if (!descElement) continue;

      // Scoped to this one element - a single bad/unavailable binding (e.g. a resource that hasn't
      // loaded yet) must not blank out every other field on the label, nor abort the whole repaint.
      try {
        const binding = parseBinding(descElement.textContent ?? '');
        element.textContent = renderBinding(binding, context);
      } catch (err) {
        console.error(`${PLUGIN_NAME}: field "${descElement.textContent}" failed to render: ${(err as Error).message}`);
        element.textContent = 'ERROR';
      }
    }

    // Collected up front, rather than iterated live like the `<text>` loop above - some of these get
    // removed outright (see below), and removing from a live NodeList while iterating it by index would
    // skip whatever shifts into the removed slot.
    const imageElements: XmlElement[] = [];
    const rawImageElements = doc.getElementsByTagName('image');
    for (let i = 0; i < rawImageElements.length; i++) {
      const element = rawImageElements.item(i);
      if (element) imageElements.push(element);
    }

    for (const element of imageElements) {
      const descElement = element.getElementsByTagName('desc').item(0);
      if (!descElement) continue;

      // Same one-field-at-a-time isolation as the `<text>` loop - and the same "no value" outcome
      // (here, dropping the element rather than blanking to 'ERROR' text) for a value that isn't
      // available at all as for one that doesn't map to any asset file, per the binding's contract.
      try {
        const binding = parseBinding(descElement.textContent ?? '');
        if (!binding.assets) {
          throw new Error('an <image> binding requires an "assets" key naming the directory to pick a file from');
        }
        const key = normalizeAssetKey(resolveBinding(binding, context));
        const assetPath = key && resolveAssetPath(svgTemplatePath, binding.assets, key);
        if (!assetPath) {
          const dirProblem = describeAssetsDirProblem(svgTemplatePath, binding.assets);
          console.error(
            key
              ? `${PLUGIN_NAME}: image "${descElement.textContent}" has no asset file for value "${key}" in "${binding.assets}"`
              : `${PLUGIN_NAME}: image "${descElement.textContent}" resolved to no usable value to pick an asset file with`,
          );
          console.error(`${PLUGIN_NAME}: ${dirProblem ?? `assets directory for "${binding.assets}" checked out fine - the miss is just this value's`}`);
          element.parentNode?.removeChild(element);
          continue;
        }
        const assetSource = await readFile(assetPath, 'utf-8');
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(assetSource).toString('base64')}`;
        const hrefAttr = element.getAttribute('href') !== null ? 'href' : 'xlink:href';
        element.setAttribute(hrefAttr, dataUri);
      } catch (err) {
        console.error(`${PLUGIN_NAME}: image "${descElement.textContent}" failed to render: ${(err as Error).message}`);
        element.parentNode?.removeChild(element);
      }
    }

    const svgOutput = new XMLSerializer().serializeToString(doc);
    const resvg = new Resvg(svgOutput, {
      fitTo: { mode: 'width', value: width },
      font: { fontBuffers },
    });
    const rendered = resvg.render();

    if (rendered.width !== width || rendered.height !== height) {
      throw new Error(
        `rendered size ${rendered.width}x${rendered.height} does not match requested ${width}x${height} - check the template's width/height/viewBox`,
      );
    }

    return { width: rendered.width, height: rendered.height, data: rendered.pixels };
  }
}
