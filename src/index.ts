import { ServerAPI, Plugin } from "@signalk/server-api";
import { createPlugin } from "./plugin";
import { registerDriver, getDriver, allDrivers } from "./devices/registry";
import {
  registerTemplateProvider as registerTemplateProviderImpl,
  findTemplateProvider as findTemplateProviderImpl,
  allTemplateProviders as allTemplateProvidersImpl,
} from "./render/templateProviders";
import { SvgRenderer } from "./render/svgRenderer";
import { bitmapToPng as bitmapToPngImpl } from "./render/png";
import { buildLabelContext, findTextBindings, substituteTextBindings } from "./render/binding";
import type {
  VendorDriver as VendorDriverType,
  DeviceMetadata as DeviceMetadataType,
  DiscoveredDevice as DiscoveredDeviceType,
  VendorDeviceConfig as VendorDeviceConfigType,
  Colour as ColourType,
} from "./devices/types";
import type {
  TemplateProvider as TemplateProviderType,
  TemplateRenderRequest as TemplateRenderRequestType,
} from "./render/templateProviders";
import type { LabelMeta as LabelMetaType } from "./render/binding";
import type { Bitmap as BitmapType, TemplateContext as TemplateContextType } from "./render/types";

/**
 * Public extension point for vendor packages. A package that adds support for a new
 * ESL vendor (e.g. `signalk-esl-shoplabelcorp-plugin`) imports this module and calls
 * `plugin.registerDriver(new ShopLabelCorpDriver())` from its own SignalK plugin's
 * `start()` (or at module load time). There's no scanning of installed packages -
 * registration is always an explicit call by the extension's own code.
 *
 * Declare this package as a regular `dependency` in the extension package (**not** a
 * `peerDependency` - the SignalK team's own guidance is that npm's peer-dependency resolution
 * interacts poorly with the server's plugin install layout), and declare the SignalK-level
 * relationship via `"signalk": { "requires": ["@rhizomatics/signalk-einklabel-plugin"] }` in the
 * extension's own package.json instead, so the App Store can install/report the dependency.
 */
function plugin(app: ServerAPI): Plugin {
  return createPlugin(app);
}

namespace plugin {
  export const registerVendorDriver = registerDriver;
  export const getVendorDriver = getDriver;
  export const allVendorDrivers = allDrivers;

  /**
   * Public extension point for a package offering an alternative to hand-authored SVG templates - e.g.
   * `@rhizomatics/signalk-einklabel-genai-plugin` generating content from an LLM prompt - see
   * `TemplateProvider`'s own doc comment (`./render/templateProviders.ts`) for the full contract. Same
   * regular-`dependency`-plus-`signalk.requires` convention as `registerVendorDriver` above.
   */
  export const registerTemplateProvider = registerTemplateProviderImpl;
  export const getTemplateProvider = findTemplateProviderImpl;
  export const allTemplateProviders = allTemplateProvidersImpl;

  /** Rasterizes an SVG string to a `Bitmap` - a template provider needs this to turn whatever SVG it produces (e.g. an LLM's response) into paintable pixels, exactly as a bundled template is rendered. */
  export const Renderer = SvgRenderer;
  /** Encodes a `Bitmap` as PNG bytes - useful for a CLI extension writing a preview file, same as the core plugin's own `render`/`generate` commands. */
  export const bitmapToPng = bitmapToPngImpl;

  /** Facts about one physical label (`source=label,path=...` bindings resolve against these) - see `./render/binding.ts`. */
  export const buildLabel = buildLabelContext;
  /** Every `{...}` placeholder referenced across one or more text fragments, parsed as bindings - see `./render/binding.ts`. */
  export const findBindingsInText = findTextBindings;
  /** Substitutes every `{...}` placeholder in `text` with its resolved binding value - see `./render/binding.ts`. */
  export const substituteBindingsInText = substituteTextBindings;

  export type VendorDriver = VendorDriverType;
  export type DeviceMetadata = DeviceMetadataType;
  export type DiscoveredDevice = DiscoveredDeviceType;
  export type VendorDeviceConfig = VendorDeviceConfigType;
  export type Colour = ColourType;

  export type TemplateProvider = TemplateProviderType;
  export type TemplateRenderRequest = TemplateRenderRequestType;
  export type LabelMeta = LabelMetaType;
  export type Bitmap = BitmapType;
  export type TemplateContext = TemplateContextType;
}

export = plugin;
