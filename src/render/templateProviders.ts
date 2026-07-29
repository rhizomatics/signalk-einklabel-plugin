import { Colour } from "../devices/types";
import { Binding } from "./binding";
import { Bitmap, TemplateContext } from "./types";

/**
 * Everything a `TemplateProvider` needs to render one device's repaint - the same
 * signalk/resources/pathMeta/categories/meta context an ordinary SVG template's `<desc>` bindings
 * resolve against (specifically, whatever `describeBindings` asked for), plus `context.label` (see
 * `buildLabelContext` in `./binding.ts`), already built by `considerRepaint` (`../repaintScheduler.ts`)
 * exactly as it would be for any other device. A `TemplateProvider` never gets direct `ServerAPI`
 * access itself - like `SvgRenderer`, it only ever sees this already-assembled context.
 */
export interface TemplateRenderRequest {
  /** The exact string picked from the "Template" dropdown, e.g. `"forecast (GenAI)"` - see `TemplateProvider.listTemplates`. */
  templateName: string;
  context: TemplateContext;
  width: number;
  height: number;
  colours: Colour[];
}

/**
 * Public extension point for a package that wants to offer an alternative way to produce a device's
 * content, alongside hand-authored SVG templates - e.g. `@rhizomatics/signalk-einklabel-genai-plugin`
 * generating content from an LLM prompt. Mirrors `VendorDriver`/`registerDriver`
 * (`../devices/registry.ts`): an extension declares this package as a regular `dependency` (**not** a
 * `peerDependency` - see `registerVendorDriver`'s own doc comment in `../index.ts` for why) plus
 * `"signalk": { "requires": [...] }` in its own package.json, calls `esl.registerTemplateProvider(...)`
 * from its own SignalK plugin's `start()`, and its entries show up in the same "Template" dropdown as
 * ordinary `.svg` files, distinguished only by `suffix`.
 */
export interface TemplateProvider {
  /** Appended to every one of this provider's entries in the "Template" dropdown, e.g. `"(GenAI)"`. */
  suffix: string;
  /**
   * Every template name this provider currently offers, already including `suffix` (e.g.
   * `["forecast (GenAI)"]`) - called fresh each time the config schema is built, so newly added/removed
   * entries show up without a plugin restart.
   */
  listTemplates(): string[];
  /**
   * The `signalk`/`resources` bindings one of `listTemplates()`'s entries needs (e.g. a prompt
   * referencing `{design.length.overall}`) - `considerRepaint` fetches these the same way it would an
   * SVG template's own `<desc>` bindings, *before* calling `render()`, so `request.context` arrives
   * already populated. A `TemplateProvider` has no other way to get live SignalK data into its own
   * render, since it never receives `ServerAPI` directly.
   */
  describeBindings(templateName: string): Binding[];
  /**
   * Renders one of `listTemplates()`'s exact strings. Rejecting routes the repaint through the same
   * bundled fallback-warning template any other render failure gets (see `RENDER_FALLBACK_TEMPLATE_NAME`,
   * `../config.ts`, and `considerRepaint`) - never leaving the previous, possibly now-wrong, content on
   * screen unmarked.
   */
  render(request: TemplateRenderRequest): Promise<Bitmap>;
}

const providers: TemplateProvider[] = [];

export function registerTemplateProvider(provider: TemplateProvider): void {
  providers.push(provider);
}

export function allTemplateProviders(): TemplateProvider[] {
  return providers;
}

/** The registered provider (if any) whose `listTemplates()` currently offers `templateName`. */
export function findTemplateProvider(templateName: string): TemplateProvider | undefined {
  return providers.find((provider) => provider.listTemplates().includes(templateName));
}
