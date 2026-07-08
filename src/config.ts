import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { ServerAPI } from "@signalk/server-api";
import { DiscoveredDevice } from "./devices/types";
import { SIGNALK_API_URL_OPTIONS } from "./resolveApiUrl";

/**
 * Special `device` value meaning "every currently-known discovered device" instead of one specific
 * BLE address - lets a single `DeviceConfig` entry (one template, one trigger) broadcast to every
 * physical label without picking each one out of the scan dropdown individually, e.g. several
 * identical labels on a boat, or just to skip the scan-then-select step for the common single-label
 * case. Resolved lazily at repaint time (see `resolveTargets` in `repaintScheduler.ts`), triggering
 * an on-demand scan itself if nothing's been discovered yet.
 */
export const ALL_DEVICES = "ALL";

export interface DeviceConfig {
  friendlyName: string;
  /**
   * Either `"<vendor>:<pid>[:<hwVersion>]@<address>"`, picked from a combined enum of recently
   * scanned devices so one selection sets both the model (width/height/colours, known without a
   * live BLE read) and the BLE address, or the special value `ALL_DEVICES` (see above).
   */
  device: string;
  /** Per-device override; if omitted, the vendor driver may fall back to a stock/manufacturer-default key. */
  aesKey?: string;
  templateName: string;
  repaintTrigger: "subscription" | "interval";
  /** SignalK path to subscribe to when `repaintTrigger` is `subscription` - a repaint is considered on every delta. */
  triggerPath?: string;
  /** When `repaintTrigger` is `interval`: repaint every N hours... */
  intervalHours?: number;
  /** ...at this minute past the hour. */
  intervalMinute?: number;
  /** One-shot override to repaint even if the data is unchanged; cleared automatically once that repaint completes. */
  forceRepaint?: boolean;
}

export interface PluginConfig {
  /**
   * Directory the plugin scans for template files, instead of an upload UI - follows
   * signalk-parquet's convention: empty for the default, a relative path resolved against
   * `~/.signalk`, or an absolute path. Use `resolveTemplatesDir` to turn this into an actual path.
   */
  templatesDir: string;
  /**
   * Run a short BLE scan on plugin start and report discoveries via plugin status, like
   * signalk-bluetti-plugin does. Off by default - a `device: ALL_DEVICES` entry scans on demand the
   * first time it has nothing discovered yet (see `resolveTargets` in `repaintScheduler.ts`), and an
   * explicit device selection only ever needed this to populate the dropdown once at initial setup.
   */
  scanOnStart: boolean;
  /** How long the startup scan runs, in seconds. */
  scanDurationSeconds: number;
  /** How long to wait for a device to accept a BLE connection before giving up on a repaint attempt, in seconds. */
  paintConnectTimeoutSeconds: number;
  /** How many times to attempt a repaint (including the first try) before giving up and reporting failure. */
  paintRetries: number;
  /**
   * How long after plugin start to hold off on every repaint trigger (startup check, interval, and
   * subscription alike) - the first minute or two of a SignalK server's life is a chaos of plugin
   * dependency sequencing (e.g. `derived-data` may not have published `environment.moon.phaseName`
   * yet), so a repaint attempted immediately at startup can render with missing/wrong data, and hash
   * dedup (see `considerRepaint`) then means it silently stays that way until the underlying data
   * happens to change again. Defaults to 120s - see `startRepaintScheduler`.
   */
  settleSeconds: number;
  /**
   * Base URL of this SignalK server, used for: (1) a `signalk`-sourced numeric value's automatic unit
   * conversion (`GET .../vessels/<context>/meta`, see `../pathMeta.ts`) unless `format=raw`, and (2) an
   * explicit `category=` binding (e.g. `category=depth` on a resource-sourced value with no path
   * metadata of its own, see `../unitCategories.ts`). Neither has an in-process equivalent reachable via
   * the plugin API - confirmed against the signalk-server source, this resolution only happens in its
   * REST layer.
   *
   * Always the local loopback address - the plugin runs on the same host as the server, so it's
   * reachable regardless of any external reverse proxy. Left unset, the plugin probes
   * `SIGNALK_API_URL_OPTIONS` at startup (in likelihood order: 3000 for a bare `npm install`, then
   * 80/443 for container/systemd installs) and uses whichever responds - see `./resolveApiUrl.ts`. Set
   * explicitly only to skip probing or to confirm a specific one is reachable; either way, it must allow
   * anonymous read access - the plugin has no login flow.
   */
  signalkApiUrl?: string;
  devices: DeviceConfig[];
}

/**
 * The package's own bundled `templates/` directory (ships alongside `dist/`, see
 * package.json's `files`) - templates here are always available, but a same-named template in the
 * user's `templatesDir` takes priority. Exported so `SvgRenderer` can fall back to it when resolving
 * an `assets=` binding's directory (see `resolveAssetPath` in `./render/assets.ts`) - overriding a
 * bundled template shouldn't also require duplicating its bundled asset sets (e.g.
 * `templates/assets/lunar_phases`) just to keep a binding the override never touched working.
 */
export const BUNDLED_TEMPLATES_DIR = join(__dirname, "..", "templates");

const SIGNALK_HOME_DIR = join(homedir(), ".signalk");
const DEFAULT_TEMPLATES_DIR = join(SIGNALK_HOME_DIR, "einklabel", "templates");

export function defaultConfig(): PluginConfig {
  return {
    templatesDir: "",
    scanOnStart: false,
    scanDurationSeconds: 20,
    paintConnectTimeoutSeconds: 30,
    paintRetries: 3,
    settleSeconds: 120,
    devices: [],
  };
}

const PLUGIN_CONFIG_KEYS = [
  "templatesDir",
  "scanOnStart",
  "scanDurationSeconds",
  "paintConnectTimeoutSeconds",
  "paintRetries",
  "settleSeconds",
  "signalkApiUrl",
  "devices",
] as const;

/**
 * `app.readPluginOptions()`/`savePluginOptions()` aren't actually symmetric despite what their doc
 * comments imply: signalk-server's `readPluginOptions()` returns the *whole* on-disk file
 * (`{ configuration, enabled, enableDebug, enableLogging }`), not just the `configuration` object
 * `savePluginOptions()` writes into - see signalk-server's `interfaces/plugins.ts`
 * (`appCopy.readPluginOptions = () => getPluginOptions(plugin.id)` vs.
 * `appCopy.savePluginOptions = (configuration, cb) => savePluginOptions(id, { ...getPluginOptions(id), configuration }, cb)`).
 * Spreading that return value straight back into a save call therefore nests the whole file one level
 * deeper inside its own `configuration` key every time (see `support/signalk-einklabel-plugin.json` and
 * `clearForceRepaint` in `./repaintScheduler.ts`). Unwrapping any such nesting and keeping only recognised
 * fields here means every save collapses back down instead of growing, self-healing an already-corrupted file.
 */
export function readCurrentConfig(app: ServerAPI): Partial<PluginConfig> {
  let raw: unknown = app.readPluginOptions();
  while (
    raw &&
    typeof raw === "object" &&
    "configuration" in raw &&
    typeof (raw as { configuration: unknown }).configuration === "object"
  ) {
    raw = (raw as { configuration: unknown }).configuration;
  }
  const result: Partial<PluginConfig> = {};
  if (raw && typeof raw === "object") {
    for (const key of PLUGIN_CONFIG_KEYS) {
      if (key in raw) {
        (result as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
      }
    }
  }
  return result;
}

/**
 * Resolves the user-facing `templatesDir` setting to an actual directory, mirroring
 * signalk-parquet's `outputDirectory` convention: empty means the default location, a relative
 * path is resolved against `~/.signalk` (where SignalK itself stores its config by default), and
 * an absolute path is used as-is.
 */
export function resolveTemplatesDir(templatesDir: string | undefined): string {
  const trimmed = templatesDir?.trim();
  if (!trimmed) {
    return DEFAULT_TEMPLATES_DIR;
  }
  return isAbsolute(trimmed) ? trimmed : join(SIGNALK_HOME_DIR, trimmed);
}

/**
 * Enum for the combined "device" field, built from recently scanned devices - including ones a
 * driver identified as its vendor but whose PID isn't in its metadata table yet (clearly labelled,
 * so the user can at least see what was found and report the PID; repainting such a device still
 * does nothing without a model override, since there's no width/height to render with) - plus, as a
 * fallback, whatever's already saved so an existing selection doesn't vanish from the dropdown just
 * because this particular run hasn't re-scanned it yet. `ALL_DEVICES` is always offered first,
 * regardless of what's been scanned - see its own doc comment.
 */
function deviceOptions(discovered: DiscoveredDevice[], current: PluginConfig): { values: string[]; labels: string[] } {
  const values: string[] = [ALL_DEVICES];
  const labels: string[] = ["All discovered devices"];
  const seen = new Set<string>([ALL_DEVICES]);

  for (const found of discovered) {
    if (found.pid === undefined) {
      continue;
    }
    const modelToken = [found.vendor, found.pid, found.hwVersion].filter((part) => part !== undefined).join(":");
    const value = `${modelToken}@${found.address}`;
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    values.push(value);
    const label = found.metadata
      ? `${found.vendor} ${found.metadata.label} (${found.address})`
      : `${found.vendor} unrecognised PID 0x${found.pid.toString(16).padStart(4, "0")} (${found.address})`;
    labels.push(label);
  }

  for (const device of current.devices) {
    if (!seen.has(device.device)) {
      seen.add(device.device);
      values.push(device.device);
      labels.push(`${device.device} (not seen in last scan)`);
    }
  }

  return { values, labels };
}

export function parseDevice(device: string): { vendor: string; pid: number; hwVersion?: string; address: string } | undefined {
  const [modelToken, address] = device.split("@");
  const [vendor, pidStr, hwVersion] = (modelToken ?? "").split(":");
  const pid = Number(pidStr);
  return vendor && address && Number.isInteger(pid) ? { vendor, pid, hwVersion, address } : undefined;
}

function listSvgFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".svg"));
  } catch {
    return [];
  }
}

/** Local templates take priority over a same-named bundled one; both show up as options. */
function templateNameOptions(templatesDir: string): string[] {
  const local = listSvgFiles(templatesDir);
  const bundled = listSvgFiles(BUNDLED_TEMPLATES_DIR).filter((name) => !local.includes(name));
  return [...local, ...bundled];
}

/** Resolves a template name to an actual file path - a local template overrides the bundled one of the same name. */
export function resolveTemplatePath(templatesDir: string, templateName: string): string {
  const localPath = join(templatesDir, templateName);
  return existsSync(localPath) ? localPath : join(BUNDLED_TEMPLATES_DIR, templateName);
}

/** JSON Schema forbids an empty `enum` array, so only attach one when there's at least one option - otherwise the whole config schema fails validation. */
function withEnum<T extends object>(schema: T, values: string[], names?: string[]): T & { enum?: string[]; enumNames?: string[] } {
  return values.length > 0 ? { ...schema, enum: values, ...(names ? { enumNames: names } : {}) } : schema;
}

export function configSchema(app: ServerAPI, discovered: DiscoveredDevice[] = []): object {
  const defaults = defaultConfig();
  const current = { ...defaults, ...readCurrentConfig(app) };
  const { values: deviceValues, labels: deviceLabels } = deviceOptions(discovered, current);

  return {
    type: "object",
    properties: {
      templatesDir: {
        type: "string",
        title: "Templates directory",
        description:
          `Relative path from ~/.signalk (e.g., "esl/templates" becomes ~/.signalk/esl/templates). ` +
          `Leave empty for default (${DEFAULT_TEMPLATES_DIR}). Absolute paths also supported. A template here ` +
          "with the same name as a bundled one takes priority. Also used to override SVG assets, like the bundled lunar_phases.",
        default: defaults.templatesDir,
      },
      scanOnStart: {
        type: "boolean",
        title: "Scan for devices on plugin start",
        description:
          'Runs a short BLE scan so discovered devices show up in a device\'s "Device" picker below. ' +
          'Not needed if every device uses "All discovered devices" - that scans on demand instead.',
        default: defaults.scanOnStart,
      },
      scanDurationSeconds: {
        type: "number",
        title: "Scan duration (seconds)",
        description: 'How long the startup scan runs - increase if devices are missing from the "Device" picker below.',
        minimum: 1,
        default: defaults.scanDurationSeconds,
      },
      paintConnectTimeoutSeconds: {
        type: "number",
        title: "Paint connect timeout (seconds)",
        description: "How long to wait for a device to accept a BLE connection before giving up on a repaint attempt.",
        minimum: 1,
        default: defaults.paintConnectTimeoutSeconds,
      },
      paintRetries: {
        type: "number",
        title: "Paint retries",
        description: "How many times to attempt a repaint (including the first try) before giving up and reporting failure.",
        minimum: 1,
        default: defaults.paintRetries,
      },
      settleSeconds: {
        type: "number",
        title: "Settle time after plugin start (seconds)",
        description:
          "Holds off every repaint (startup check, interval, and subscription alike) until this long after the plugin starts - " +
          "the first minute or two of SignalK startup often has many errors as plugins start before the paths they depend on are ready, so data a template needs " +
          "(e.g. from the derived-data plugin) may not be published yet.",
        minimum: 0,
        default: defaults.settleSeconds,
      },
      signalkApiUrl: {
        type: "string",
        title: "SignalK API base URL (leave blank to auto-detect)",
        description:
          "Used for plugin access to SignalK REST APIs not yet integrated for direct plugin access. Left blank, the plugin probes the likely options at startup (3000, 80, 443 ) - only set this manually to skip probing. Anonymous read access is required.",
        enum: ["", ...SIGNALK_API_URL_OPTIONS],
      },
      devices: {
        type: "array",
        title: "Devices",
        items: {
          type: "object",
          required: ["friendlyName", "device", "templateName", "repaintTrigger"],
          properties: {
            friendlyName: { type: "string", title: "Friendly name" },
            device: withEnum(
              {
                type: "string",
                title: "Device",
                description:
                  "Either a specific device found by a scan (plugin start, or `esl-cli scan`), setting both the model and BLE " +
                  'address, or "All discovered devices" to paint this same template/trigger to every device the plugin currently ' +
                  "knows about - simplest for a single label, and also covers several identical labels without listing each one.",
              },
              deviceValues,
              deviceLabels,
            ),

            templateName: withEnum({ type: "string", title: "Template" }, templateNameOptions(resolveTemplatesDir(current.templatesDir))),
            repaintTrigger: {
              type: "string",
              title: "Repaint trigger",
              enum: ["subscription", "interval"],
            },
            triggerPath: {
              type: "string",
              title: "Trigger SignalK path (if repaint trigger is subscription)",
            },
            intervalHours: {
              type: "number",
              title: "Repaint every N hours (if repaint trigger is interval)",
              minimum: 1,
            },
            intervalMinute: {
              type: "number",
              title: "Minutes past the hour (if repaint trigger is interval)",
              minimum: 0,
              maximum: 59,
              default: 0,
            },
            aesKey: {
              type: "string",
              title: "BLE AES key (vendor-specific; leave blank to use a default key)",
            },
            forceRepaint: {
              type: "boolean",
              title: "Force repaint",
              description: "Repaint even if the data is unchanged - clears itself automatically once that repaint completes",
              default: false,
            },
          },
        },
      },
    },
  };
}

export function configUiSchema(): object {
  return {
    devices: {
      items: {
        repaintTrigger: { "ui:widget": "radio" },
      },
    },
  };
}
