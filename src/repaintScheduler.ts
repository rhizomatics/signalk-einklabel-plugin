import { createHash } from "crypto";
import { join } from "path";
import { readFileSync, statSync, writeFileSync } from "fs";
import { ServerAPI, Path, SignalKResourceType } from "@signalk/server-api";
import {
  ALL_DEVICES,
  BUNDLED_TEMPLATES_DIR,
  DeviceConfig,
  PluginConfig,
  parseDevice,
  readCurrentConfig,
  resolveTemplatePath,
  resolveTemplatesDir,
} from "./config";
import { withRetries } from "./devices/bleDiscovery";
import { loadDiscoveredDevices, touchDiscoveredDevice } from "./devices/discoveredDevicesStore";
import { ensureScan } from "./devices/discoveryCoordinator";
import { getDriver } from "./devices/registry";
import { DeviceMetadata, VendorDriver } from "./devices/types";
import { SvgRenderer } from "./render/svgRenderer";
import { Binding, findBindings, resourceContextKey } from "./render/binding";
import { resolveLocalZoneAbbreviation } from "./render/formatters";
import { TemplateContext } from "./render/types";
import { unwrapSignalkTree } from "./render/unwrapSignalkTree";
import { fetchCategoryDisplayUnits } from "./unitCategories";
import { fetchPathMeta } from "./pathMeta";
import { createApiUrlResolver } from "./resolveApiUrl";
import { PLUGIN_VERSION } from "./pluginVersion";
import { fetchJson } from "./httpJson";

const INTERVAL_POLL_MS = 60_000;
const SUBSCRIPTION_DEBOUNCE_MS = 2_000;
const RESOURCES_API_PATH = "/signalk/v2/api/resources";

export interface RepaintScheduler {
  stop(): void;
}

/**
 * `templateHash`/`dataHash` tracked separately (rather than one combined hash) so a repaint can
 * report *which* of the two actually changed - e.g. distinguishing "template edited, data
 * unchanged" from "data changed" in the debug log, instead of an opaque single hash flip.
 * `repaintedAt` - epoch ms of the last successful `driver.paint()`, used by the startup catch-up check
 * (see `mostRecentScheduledSlot`) to tell an interval device that's already been painted for its
 * current slot from one that's overdue.
 */
type RepaintState = Record<string, { templateHash: string; dataHash: string; repaintedAt?: number }>;

/**
 * The most recent wall-clock instant at or before `now` that an `interval`-triggered device's own
 * periodic check (below, in `startRepaintScheduler`) would fire at - every `intervalHours` hours,
 * at `intervalMinute` minutes past the hour (e.g. hours=8,minute=0 -> 00:00, 08:00, 16:00 each day).
 * Used only by the deferred startup catch-up check to tell an interval device that's already been
 * painted for its current slot (skip - the regular periodic check will catch the *next* slot in due
 * course) from one that's overdue (e.g. the plugin was down across a scheduled slot - paint now
 * rather than waiting up to `intervalHours` for the next one).
 */
export function mostRecentScheduledSlot(now: Date, intervalHours: number, intervalMinute: number): Date {
  const slot = new Date(now);
  slot.setHours(Math.floor(now.getHours() / intervalHours) * intervalHours, intervalMinute, 0, 0);
  if (slot.getTime() > now.getTime()) {
    slot.setHours(slot.getHours() - intervalHours);
  }
  return slot;
}

function statePath(app: ServerAPI): string {
  return join(app.getDataDirPath(), "repaint-state.json");
}

function loadState(app: ServerAPI): RepaintState {
  try {
    return JSON.parse(readFileSync(statePath(app), "utf-8"));
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
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hashes the template's mtime, so editing a template (even with no data change) triggers a repaint. */
function hashTemplate(templateMtimeMs: number): string {
  return createHash("sha1").update(String(templateMtimeMs)).digest("hex");
}

/** Hashes the live data context, so a data change triggers a repaint even with the template untouched. */
function hashData(context: TemplateContext): string {
  return createHash("sha1").update(stableStringify(context)).digest("hex");
}

/** Merges `value` into `target` at the nested location described by a dotted SignalK path. */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    node[segment] = typeof next === "object" && next !== null ? next : {};
    node = node[segment] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

/**
 * Reads live data for exactly what a template's own bindings ask for - no separate config declaring it.
 * `signalk`-sourced bindings are read directly (`self` via `getSelfPath`, anything else via `getPath`
 * against that literal SignalK context) - in-process, no URL needed. Despite their names, neither
 * already returns a bare value for a regular published path - both return the full data-model node
 * (`{ path, value, context, source, $source, timestamp }`); only a handful of vessel-identity fields
 * like `uuid` come back bare. `unwrapSignalkTree` strips that wrapper the same way it does for the
 * CLI's HTTP-fetched equivalent (`assembleLiveContext` in `cli/liveContext.ts`), so a `path=` binding
 * resolves to the same value either way - without it, `resolveBinding` would hand back the whole
 * wrapper object instead of e.g. a plain string, breaking any binding that expects one (a `<image>`'s
 * `assets=`, a `format=` formatter, etc). `resources`-sourced bindings with no `provider=` pin go
 * through `app.resourcesApi` in-process too, with no such wrapper - but a `provider=`-pinned binding
 * goes over HTTP instead (see the resources loop below), since the in-process API doesn't actually
 * honor `providerId` on signalk-server 2.30.0. Per-path unit-conversion metadata (`pathMeta`, for
 * automatic conversion - see `renderBinding`) and an explicit `category=` binding's resolved
 * conversion both have no in-process equivalent (confirmed against the signalk-server source - that
 * resolution only happens in its REST layer), so both need `apiUrl` - fetching `pathMeta` is
 * best-effort (a missing/unreachable server just means no automatic conversion), but a `category=`
 * binding (and now a `provider=`-pinned resource binding) is a declared dependency, so a missing
 * `apiUrl` is a hard error there.
 */
async function assembleRawContext(app: ServerAPI, apiUrl: string | undefined, bindings: Binding[]): Promise<TemplateContext> {
  const signalk: Record<string, unknown> = {};
  const seenSignalk = new Set<string>();
  for (const binding of bindings) {
    if (binding.source !== "signalk") continue;
    const key = `${binding.context} ${binding.path}`;
    if (seenSignalk.has(key)) continue;
    seenSignalk.add(key);
    const rawValue = binding.context === "self" ? app.getSelfPath(binding.path) : app.getPath(`${binding.context}.${binding.path}`);
    const value = unwrapSignalkTree(rawValue);
    const namespace = (signalk[binding.context] ??= {}) as Record<string, unknown>;
    setAtPath(namespace, binding.path, value);
  }
  signalk.self ??= {};

  const pathMeta: Record<string, unknown> = {};
  const signalkContexts = new Set(bindings.filter((binding) => binding.source === "signalk").map((binding) => binding.context));
  if (apiUrl) {
    for (const ctx of signalkContexts) {
      try {
        pathMeta[ctx] = await fetchPathMeta(apiUrl, ctx);
      } catch (err) {
        app.debug(
          `could not fetch path metadata for context "${ctx}" (${(err as Error).message}) - automatic unit conversion will show raw values`,
        );
      }
    }
  }

  const resources: Record<string, unknown> = {};
  const resourceBindings = new Map<string, Binding>();
  for (const binding of bindings) {
    if (binding.source !== "resources") continue;
    resourceBindings.set(resourceContextKey(binding), binding);
  }
  for (const [key, binding] of resourceBindings) {
    if (binding.provider) {
      // `app.resourcesApi.listResources(resType, params, providerId)` validates providerId against the
      // registered providers but then - confirmed against signalk-server 2.30.0's own source - ignores
      // it and merges every registered provider's results together (its internal `listFromAll`), so a
      // second provider for the same resource type can silently clobber the one a binding pinned. The
      // REST API's own `?provider=` query param doesn't have this bug (it queries only that provider),
      // so a pinned binding goes over HTTP instead of the in-process API to actually get what it asked for.
      if (!apiUrl) {
        throw new Error(
          `binding pins resource "${binding.resource}" to provider "${binding.provider}" but no SignalK API base URL is configured`,
        );
      }
      resources[key] = await fetchJson(
        `${apiUrl}${RESOURCES_API_PATH}/${binding.resource}?provider=${encodeURIComponent(binding.provider)}`,
      );
    } else {
      // `listResources`'s type only allows the standard SignalKResourceType union, but the underlying
      // Resources API (and a custom provider like signalk-tides, registered under the non-standard
      // "tides" type) accepts any registered resource type string - this cast matches `getResource`'s
      // wider, accurate signature. No `provider=` pin here, so the in-process call's default-provider
      // behavior (whichever the server picks) is fine - and cheaper than a redundant HTTP round trip.
      resources[key] = await app.resourcesApi.listResources(binding.resource as SignalKResourceType, {}, undefined);
    }
  }

  const categoryNames = new Set(bindings.filter((binding) => binding.category).map((binding) => binding.category as string));
  if (categoryNames.size > 0 && !apiUrl) {
    throw new Error(
      `binding references categor${categoryNames.size > 1 ? "ies" : "y"} "${[...categoryNames].join(", ")}" but no SignalK API base URL is configured`,
    );
  }
  const categories = apiUrl ? await fetchCategoryDisplayUnits(apiUrl, categoryNames) : {};

  return { signalk, resources, pathMeta, categories };
}

function clearForceRepaint(app: ServerAPI, friendlyName: string): void {
  const current = readCurrentConfig(app);
  const devices = (current.devices ?? []).map((device) =>
    device.friendlyName === friendlyName ? { ...device, forceRepaint: false } : device,
  );
  app.savePluginOptions({ ...current, devices }, (err) => {
    if (err) app.debug(`failed to clear forceRepaint for "${friendlyName}": ${err.message}`);
  });
}

/** One physical device to paint - either the one `device.device` names, or (for `ALL_DEVICES`) one of possibly several. */
interface RepaintTarget {
  address: string;
  vendor: string;
  pid: number;
  hwVersion?: string;
  metadata: DeviceMetadata;
  driver: VendorDriver;
}

/** `RepaintState` key for one physical device under a given `DeviceConfig` entry - see `RepaintState`'s doc comment on why address is part of the key. */
function stateKeyFor(friendlyName: string, address: string): string {
  return `${friendlyName}:${address}`;
}

function resolveTarget(vendor: string, pid: number | undefined, hwVersion: string | undefined, address: string): RepaintTarget | undefined {
  const driver = getDriver(vendor);
  const metadata = pid !== undefined ? driver?.metadataForPid(pid, hwVersion) : undefined;
  return driver && pid !== undefined && metadata ? { address, vendor, pid, hwVersion, metadata, driver } : undefined;
}

/**
 * Resolves a `DeviceConfig` entry to the physical device(s) it should paint. A specific
 * `"<vendor>:<pid>[:<hwVersion>]@<address>"` resolves to exactly that one device (or none, if its
 * driver/model can't be found). `ALL_DEVICES` resolves to every currently-known discovered device
 * (see `discoveredDevicesStore.ts`) - if none are known yet, it triggers an on-demand scan first
 * (bounded by `config.scanDurationSeconds`, same as the startup scan), so a first-time "ALL" setup
 * doesn't require `scanOnStart` or a manual `esl-cli scan`.
 */
async function resolveTargets(app: ServerAPI, config: PluginConfig, device: DeviceConfig): Promise<RepaintTarget[]> {
  if (device.device === ALL_DEVICES) {
    let records = loadDiscoveredDevices(app);
    if (Object.keys(records).length === 0) {
      app.debug(
        `"${device.friendlyName}": device is "${ALL_DEVICES}" and nothing discovered yet - scanning for ${config.scanDurationSeconds}s`,
      );
      records = (await ensureScan(app, config.scanDurationSeconds)).merged;
    }
    const targets: RepaintTarget[] = [];
    for (const record of Object.values(records)) {
      const target = resolveTarget(record.vendor, record.pid, record.hwVersion, record.address);
      if (target) targets.push(target);
    }
    return targets;
  }

  const model = parseDevice(device.device);
  const target = model && resolveTarget(model.vendor, model.pid, model.hwVersion, model.address);
  if (!target) {
    app.debug(`"${device.friendlyName}": no driver/metadata for device "${device.device}", skipping`);
    return [];
  }
  return [target];
}

async function considerRepaint(
  app: ServerAPI,
  config: PluginConfig,
  device: DeviceConfig,
  target: RepaintTarget,
  state: RepaintState,
  getApiUrl: () => Promise<string>,
): Promise<void> {
  const { address, metadata, driver } = target;
  const label = `"${device.friendlyName}" [${address}]`;
  const templatesDir = resolveTemplatesDir(config.templatesDir);
  const templatePath = resolveTemplatePath(templatesDir, device.templateName, {
    width: metadata.width,
    height: metadata.height,
    colours: metadata.colours,
  });
  const templateMtimeMs = statSync(templatePath).mtimeMs;
  const bindings = findBindings(readFileSync(templatePath, "utf-8"));

  const apiUrl = await getApiUrl().catch((err) => {
    app.debug(`${label}: ${err.message}`);
    return undefined;
  });
  const rawContext = await assembleRawContext(app, apiUrl, bindings);
  const templateHash = hashTemplate(templateMtimeMs);
  const dataHash = hashData(rawContext);
  const stateKey = stateKeyFor(device.friendlyName, address);
  const previous = state[stateKey];
  const templateChanged = previous?.templateHash !== templateHash;
  const dataChanged = previous?.dataHash !== dataHash;
  // `interval`-triggered devices are already throttled by their own schedule (see
  // `startRepaintScheduler`) - that's the entire reason to pick `interval` over `subscription`,
  // often for slow-changing bound data (e.g. this template's tide `extremes`, which can be
  // identical across two checks on the same day) where hash dedup would otherwise silently skip
  // every scheduled repaint. Content-hash dedup below only makes sense for `subscription`, where
  // it exists to avoid repainting on every irrelevant delta of a frequently-updating path.
  if (device.repaintTrigger !== "interval" && !templateChanged && !dataChanged && !device.forceRepaint) {
    app.debug(`${label}: data unchanged, skipping repaint`);
    return;
  }

  const renderContext: TemplateContext = {
    ...rawContext,
    meta: {
      repainted: new Date().toISOString(),
      local_zone: resolveLocalZoneAbbreviation(rawContext),
      plugin_version: PLUGIN_VERSION,
    },
  };
  const renderer = new SvgRenderer();
  const bitmap = await renderer.render(
    templatePath,
    renderContext,
    metadata.width,
    metadata.height - metadata.voffset,
    templatesDir,
    BUNDLED_TEMPLATES_DIR,
  );
  const connectTimeoutMs = config.paintConnectTimeoutSeconds * 1000;
  let paintDurationMs = 0;
  await withRetries(config.paintRetries, async (attempt) => {
    if (attempt > 1) {
      app.debug(`${label}: attempting paint ${attempt}/${config.paintRetries}`);
    }
    const startedAt = Date.now();
    await driver.paint(bitmap, { address, aesKey: device.aesKey, connectTimeoutMs });
    paintDurationMs = Date.now() - startedAt;
  });

  touchDiscoveredDevice(app, { address, vendor: target.vendor, pid: target.pid, hwVersion: target.hwVersion, metadata });
  state[stateKey] = { templateHash, dataHash, repaintedAt: Date.now() };
  saveState(app, state);
  const reason = device.forceRepaint
    ? "forced"
    : templateChanged && dataChanged
      ? "template and data changed"
      : templateChanged
        ? "template changed"
        : dataChanged
          ? "data changed"
          : "scheduled interval";
  app.debug(`${label}: repainted (${reason}, paint took ${paintDurationMs}ms)`);
}

export function startRepaintScheduler(app: ServerAPI, config: PluginConfig): RepaintScheduler {
  const state = loadState(app);
  const unsubscribes: Array<() => void> = [];
  const getApiUrl = createApiUrlResolver(config.signalkApiUrl);

  // The first minute or two of a SignalK server's life is a chaos of plugin dependency sequencing -
  // a repaint attempted before other plugins (e.g. derived-data) have published the data a template
  // needs renders with missing/wrong values, and hash dedup (see `considerRepaint`) then means it
  // silently stays that way until the underlying data happens to change again. So every trigger
  // (startup check, interval, subscription alike) funnels through this one gate.
  const startedAt = Date.now();
  const settleMs = (config.settleSeconds ?? 120) * 1000;

  const repaint = async (device: DeviceConfig) => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < settleMs) {
      app.debug(
        `"${device.friendlyName}": still settling (${Math.round(elapsedMs / 1000)}s/${Math.round(settleMs / 1000)}s) - skipping repaint`,
      );
      return;
    }
    const targets = await resolveTargets(app, config, device);
    if (targets.length === 0) {
      return;
    }
    const results = await Promise.allSettled(targets.map((target) => considerRepaint(app, config, device, target, state, getApiUrl)));
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        app.debug(`"${device.friendlyName}" [${targets[i].address}]: repaint failed: ${(result.reason as Error).message}`);
      }
    });
    // A single `forceRepaint` flag covers every target under `ALL_DEVICES` too - only clear it once
    // every target has actually succeeded, so a target that failed still gets forced again next time
    // instead of quietly reverting to ordinary hash-based dedup.
    if (device.forceRepaint && results.every((result) => result.status === "fulfilled")) {
      clearForceRepaint(app, device.friendlyName);
    }
  };

  const intervalDevices = config.devices.filter((device) => device.repaintTrigger === "interval");
  if (intervalDevices.length > 0) {
    const timer = setInterval(() => {
      const now = new Date();
      for (const device of intervalDevices) {
        const hours = device.intervalHours ?? 1;
        const minute = device.intervalMinute ?? 0;
        if (now.getHours() % hours === 0 && now.getMinutes() === minute) {
          void repaint(device);
        }
      }
    }, INTERVAL_POLL_MS);
    unsubscribes.push(() => clearInterval(timer));
  }

  for (const device of config.devices) {
    if (device.repaintTrigger === "subscription" && device.triggerPath) {
      const stream = app.streambundle.getSelfStream(device.triggerPath as Path).debounce(SUBSCRIPTION_DEBOUNCE_MS);
      // A path can report a transient `null`/missing value (e.g. a sensor briefly drops out) then go
      // right back to what it was before - e.g. 1111, then missing, then 1111 again. Ignoring the
      // missing emission entirely (rather than repainting for it) means it's never actually painted,
      // so when the value comes back the same as before, `considerRepaint`'s hash dedup sees nothing
      // changed since the last real paint and skips too - net effect: no repaint at all for this
      // blip, instead of one flickering the display blank/wrong and a second restoring it.
      const unsub = stream.onValue((value) => {
        if (value !== null && value !== undefined) void repaint(device);
      });
      unsubscribes.push(unsub);
    }
  }

  // Check every device once, after the settle window. Deferred (rather than run immediately) so a
  // subscription-triggered device whose path is slow-changing (e.g. tide/moon data that might not
  // change again for hours) still gets its first real paint promptly once settled, instead of
  // waiting on that path's next unrelated update - it's then left alone until the path changes
  // again, same as always. An interval-triggered device, though, only gets this catch-up paint if
  // it's actually overdue - already painted for the current scheduled slot (e.g. plugin restarted
  // mid-way through its interval) just waits for the regular periodic check above to hit the *next*
  // slot, rather than jumping the gun with an extra unscheduled paint every time the plugin restarts.
  // `ALL_DEVICES` can't be cheaply pre-checked this way without resolving targets first (which may
  // itself trigger a scan) - it always falls through to `repaint()`, whose own per-target hash dedup
  // still avoids a redundant paint once targets are resolved.
  const startupCheckTimer = setTimeout(() => {
    for (const device of config.devices) {
      if (device.repaintTrigger === "interval" && !device.forceRepaint && device.device !== ALL_DEVICES) {
        const hours = device.intervalHours ?? 1;
        const minute = device.intervalMinute ?? 0;
        const dueSlot = mostRecentScheduledSlot(new Date(), hours, minute);
        const address = parseDevice(device.device)?.address;
        const repaintedAt = address !== undefined ? state[stateKeyFor(device.friendlyName, address)]?.repaintedAt : undefined;
        if (repaintedAt !== undefined && repaintedAt >= dueSlot.getTime()) {
          app.debug(`"${device.friendlyName}": already painted for the current ${hours}h schedule slot - skipping startup catch-up`);
          continue;
        }
      }
      void repaint(device);
    }
  }, settleMs);
  unsubscribes.push(() => clearTimeout(startupCheckTimer));

  return {
    stop() {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
