import { createHash } from 'crypto';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { ServerAPI, Path } from '@signalk/server-api';
import { DeviceConfig, PluginConfig, ProviderBinding, parseDeviceModel } from './config';
import { getDriver } from './devices/registry';
import { SvgRenderer } from './render/svgRenderer';
import { TemplateContext } from './render/types';

const INTERVAL_POLL_MS = 60_000;
const SUBSCRIPTION_DEBOUNCE_MS = 2_000;

export interface RepaintScheduler {
  stop(): void;
}

type RepaintState = Record<string, { hash: string }>;

function statePath(app: ServerAPI): string {
  return join(app.getDataDirPath(), 'repaint-state.json');
}

function loadState(app: ServerAPI): RepaintState {
  try {
    return JSON.parse(readFileSync(statePath(app), 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(app: ServerAPI, state: RepaintState): void {
  writeFileSync(statePath(app), JSON.stringify(state));
}

/** Deterministic JSON serialisation (sorted keys) so re-ordered object keys don't change the hash. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashContext(context: TemplateContext): string {
  return createHash('sha1').update(stableStringify(context)).digest('hex');
}

/** Merges `value` into `target` at the nested location described by a dotted SignalK path. */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    node[segment] = typeof next === 'object' && next !== null ? next : {};
    node = node[segment] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

async function fetchProvider(binding: ProviderBinding): Promise<unknown> {
  const response = await fetch(binding.url);
  if (!response.ok) {
    throw new Error(`provider fetch failed: ${binding.url} (${response.status})`);
  }
  return response.json();
}

async function assembleRawContext(app: ServerAPI, device: DeviceConfig): Promise<TemplateContext> {
  const context: Record<string, unknown> = {};
  for (const path of device.signalkPaths) {
    setAtPath(context, path, app.getSelfPath(path));
  }
  for (const provider of device.providers) {
    const data = await fetchProvider(provider);
    if (provider.contextKey) {
      context[provider.contextKey] = data;
    } else if (data !== null && typeof data === 'object') {
      Object.assign(context, data);
    }
  }
  return context;
}

function clearForceRepaint(app: ServerAPI, friendlyName: string): void {
  const current = { ...(app.readPluginOptions() as Partial<PluginConfig>) };
  const devices = (current.devices ?? []).map((device) =>
    device.friendlyName === friendlyName ? { ...device, forceRepaint: false } : device,
  );
  app.savePluginOptions({ ...current, devices }, (err) => {
    if (err) app.debug(`failed to clear forceRepaint for "${friendlyName}": ${err.message}`);
  });
}

async function considerRepaint(app: ServerAPI, config: PluginConfig, device: DeviceConfig, state: RepaintState): Promise<void> {
  const model = parseDeviceModel(device.deviceModel);
  const driver = model && getDriver(model.vendor);
  const metadata = model && driver?.metadataForPid(model.pid, model.hwVersion);
  if (!driver || !metadata) {
    app.debug(`"${device.friendlyName}": no driver/metadata for device model "${device.deviceModel}", skipping`);
    return;
  }

  const rawContext = await assembleRawContext(app, device);
  const hash = hashContext(rawContext);
  if (state[device.friendlyName]?.hash === hash && !device.forceRepaint) {
    app.debug(`"${device.friendlyName}": data unchanged, skipping repaint`);
    return;
  }

  const renderContext: TemplateContext = { ...rawContext, meta: { repaintedAt: new Date().toISOString() } };
  const renderer = new SvgRenderer();
  const templatePath = join(config.templatesDir, device.templateName);
  const bitmap = await renderer.render(templatePath, renderContext, metadata.width, metadata.height - metadata.voffset);
  await driver.paint(bitmap, { address: device.address, aesKey: device.aesKey });

  state[device.friendlyName] = { hash };
  saveState(app, state);
  if (device.forceRepaint) {
    clearForceRepaint(app, device.friendlyName);
  }
  app.debug(`"${device.friendlyName}": repainted`);
}

export function startRepaintScheduler(app: ServerAPI, config: PluginConfig): RepaintScheduler {
  const state = loadState(app);
  const unsubscribes: Array<() => void> = [];

  const repaint = (device: DeviceConfig) =>
    considerRepaint(app, config, device, state).catch((err) => app.debug(`"${device.friendlyName}": repaint failed: ${err.message}`));

  const intervalDevices = config.devices.filter((device) => device.repaintTrigger === 'interval');
  if (intervalDevices.length > 0) {
    const timer = setInterval(() => {
      const now = new Date();
      for (const device of intervalDevices) {
        const hours = device.intervalHours ?? 1;
        const minute = device.intervalMinute ?? 0;
        if (now.getHours() % hours === 0 && now.getMinutes() === minute) {
          repaint(device);
        }
      }
    }, INTERVAL_POLL_MS);
    unsubscribes.push(() => clearInterval(timer));
  }

  for (const device of config.devices) {
    if (device.repaintTrigger === 'subscription' && device.triggerPath) {
      const stream = app.streambundle.getSelfStream(device.triggerPath as Path).debounce(SUBSCRIPTION_DEBOUNCE_MS);
      const unsub = stream.onValue(() => repaint(device));
      unsubscribes.push(unsub);
    }
  }

  // Check every device once at startup - harmless given hash dedup, and covers newly-added
  // devices or a forceRepaint left set from before a restart.
  for (const device of config.devices) {
    repaint(device);
  }

  return {
    stop() {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
