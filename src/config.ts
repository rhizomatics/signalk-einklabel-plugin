import { readdirSync } from 'fs';
import { ServerAPI } from '@signalk/server-api';
import { allDrivers } from './devices/registry';

/** Binds an HTTP(S) JSON endpoint (a built-in SignalK API or a plugin-provided one, e.g. signalk-tides) into the render context. */
export interface ProviderBinding {
  url: string;
  /** Namespace to merge the response under; omit to merge at the context root (matches how the bundled tide template expects its data). */
  contextKey?: string;
}

export interface DeviceConfig {
  friendlyName: string;
  /** `"<vendor>:<pid>"`, picked from a combined enum so width/height/colour count are known from config alone - no live BLE read needed to size a render. */
  deviceModel: string;
  /** Plain BLE MAC address - find it via a scan (see plugin status / `esl-cli scan`) and paste it in. */
  address: string;
  /** Per-device override; if omitted, the vendor driver may fall back to a stock/manufacturer-default key. */
  aesKey?: string;
  templateName: string;
  /** Dotted SignalK paths read via `getSelfPath` and merged into the render context preserving their natural nesting. */
  signalkPaths: string[];
  providers: ProviderBinding[];
  repaintTrigger: 'subscription' | 'interval';
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
  /** Directory the plugin scans for template files, instead of an upload UI. */
  templatesDir: string;
  /** Run a short BLE scan on plugin start and report discoveries via plugin status, like signalk-bluetti-plugin does. */
  scanOnStart: boolean;
  devices: DeviceConfig[];
}

export const DEFAULT_CONFIG: PluginConfig = {
  templatesDir: './templates',
  scanOnStart: true,
  devices: [],
};

/**
 * "<vendor>:<pid>[:<hwVersion>]" tokens for every device model every registered driver
 * currently has confirmed metadata for. The hwVersion suffix only appears for models
 * that need it to disambiguate a PID reused across panel sizes (see `DeviceMetadata.hwVersion`).
 */
function deviceModelOptions(): { values: string[]; labels: string[] } {
  const values: string[] = [];
  const labels: string[] = [];
  for (const driver of allDrivers()) {
    for (const device of driver.supportedDevices()) {
      values.push([driver.vendor, device.pid, device.hwVersion].filter((part) => part !== undefined).join(':'));
      labels.push(`${driver.vendor} ${device.label} ${device.width}x${device.height} ${device.colours.length}-colour`);
    }
  }
  return { values, labels };
}

export function parseDeviceModel(deviceModel: string): { vendor: string; pid: number; hwVersion?: string } | undefined {
  const [vendor, pidStr, hwVersion] = deviceModel.split(':');
  const pid = Number(pidStr);
  return vendor && Number.isInteger(pid) ? { vendor, pid, hwVersion } : undefined;
}

function templateNameOptions(templatesDir: string): string[] {
  try {
    return readdirSync(templatesDir).filter((name) => name.endsWith('.svg'));
  } catch {
    return [];
  }
}

export function configSchema(app: ServerAPI): object {
  const current = { ...DEFAULT_CONFIG, ...(app.readPluginOptions() as Partial<PluginConfig>) };
  const { values: deviceModelValues, labels: deviceModelLabels } = deviceModelOptions();

  return {
    type: 'object',
    properties: {
      templatesDir: {
        type: 'string',
        title: 'Templates directory',
        description: 'Directory to search for SVG/Handlebars template files',
        default: DEFAULT_CONFIG.templatesDir,
      },
      scanOnStart: {
        type: 'boolean',
        title: 'Scan for devices on plugin start',
        description: 'Runs a short BLE scan and reports discovered devices via the plugin status line - copy the address into a device below.',
        default: DEFAULT_CONFIG.scanOnStart,
      },
      devices: {
        type: 'array',
        title: 'Devices',
        items: {
          type: 'object',
          required: ['friendlyName', 'deviceModel', 'address', 'templateName', 'repaintTrigger'],
          properties: {
            friendlyName: { type: 'string', title: 'Friendly name' },
            deviceModel: { type: 'string', title: 'Device model', enum: deviceModelValues, enumNames: deviceModelLabels },
            address: { type: 'string', title: 'BLE address', description: 'e.g. aa:bb:cc:dd:ee:ff - run a scan to find this' },
            aesKey: { type: 'string', title: 'BLE AES key (vendor-specific; leave blank to use the vendor\'s stock default key)' },
            templateName: { type: 'string', title: 'Template file name', enum: templateNameOptions(current.templatesDir) },
            signalkPaths: {
              type: 'array',
              title: 'SignalK paths',
              description: 'Dotted paths to read and merge into the template context, e.g. environment.time.timezoneRegion',
              items: { type: 'string' },
            },
            providers: {
              type: 'array',
              title: 'API providers',
              description: 'HTTP(S) JSON endpoints to merge into the template context - a built-in SignalK API or a plugin-provided one (e.g. signalk-tides)',
              items: {
                type: 'object',
                required: ['url'],
                properties: {
                  url: { type: 'string', title: 'URL' },
                  contextKey: { type: 'string', title: 'Context key (optional - merges at the root if left blank)' },
                },
              },
            },
            repaintTrigger: { type: 'string', title: 'Repaint trigger', enum: ['subscription', 'interval'] },
            triggerPath: { type: 'string', title: 'Trigger SignalK path (if repaint trigger is subscription)' },
            intervalHours: { type: 'number', title: 'Repaint every N hours (if repaint trigger is interval)', minimum: 1 },
            intervalMinute: { type: 'number', title: 'Minute past the hour (if repaint trigger is interval)', minimum: 0, maximum: 59, default: 0 },
            forceRepaint: {
              type: 'boolean',
              title: 'Force repaint',
              description: 'Repaint even if the data is unchanged - clears itself automatically once that repaint completes',
              default: false,
            },
          },
        },
      },
    },
  };
}
