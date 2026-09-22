import { Plugin, ServerAPI } from "@signalk/server-api";
import { configSchema, configUiSchema, defaultConfig, healNestedConfig, PluginConfig } from "./config";
import { registerDriver } from "./devices/registry";
import { ZhsunycoDriver } from "./devices/zhsunyco";
import { GiciskyDriver } from "./devices/gicisky";
import { ensureScan, scanInProgressSince, startBleApiDiscoveryListener } from "./devices/discoveryCoordinator";
import { waitForAdapter } from "./devices/bleDiscovery";
import { loadDiscoveredDevices } from "./devices/discoveredDevicesStore";
import { startRepaintScheduler, RepaintScheduler } from "./repaintScheduler";
import { PLUGIN_NAME } from "./pluginVersion";

/** Mirrors signalk-bluetti-plugin's convention: scan briefly, report finds via plugin status for the user to copy-paste. */
async function runStartupScan(app: ServerAPI, durationSeconds: number, useBleApi: boolean): Promise<void> {
  const alreadyRunning = scanInProgressSince();
  if (alreadyRunning !== undefined) {
    const elapsedSeconds = ((Date.now() - alreadyRunning) / 1000).toFixed(0);
    app.debug(
      `a scan from before this restart is still running (${elapsedSeconds}s) - joining it instead of starting a second BLE session`,
    );
    app.setPluginStatus(
      `Waiting for a scan already running from before this restart (${elapsedSeconds}s so far) to finish updating the "Device" picker below...`,
    );
  } else {
    app.setPluginStatus(`Scanning for ESL devices for ${durationSeconds}s...`);
  }
  const startedAt = Date.now();
  const { foundThisScan } = await ensureScan(app, durationSeconds, useBleApi).catch((err) => {
    app.debug(`startup scan failed: ${err.message}`);
    return { foundThisScan: [] };
  });
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (foundThisScan.length === 0) {
    app.setPluginStatus(`Scan complete - no ESL devices found nearby after ${elapsedSeconds} seconds.`);
    return;
  }
  const summary = foundThisScan.map((device) => `${device.name ?? device.vendor} [${device.address}]`).join(", ");
  app.setPluginStatus(
    `Scan complete - found ${foundThisScan.length} device(s) in ${elapsedSeconds}s: ${summary} - pick one from a device's "Device" field below`,
  );
}

export function createPlugin(app: ServerAPI): Plugin {
  registerDriver(new ZhsunycoDriver());
  registerDriver(new GiciskyDriver());

  // Present on SignalK server >= 2.32.0 (the BLE Provider/Consumer API - "BLE Manager" in the admin
  // UI); `ServerAPI`'s own type says this is always defined, but that's only true on servers new
  // enough to have added it - checked at runtime rather than trusted from the type.
  const bleApiAvailable = !!app.bleApi;

  let scheduler: RepaintScheduler | undefined;
  let stopDiscoveryListener: (() => void) | undefined;
  let stopped = false;

  const plugin: Plugin = {
    id: "signalk-einklabel-plugin",
    name: "eInk ESL (Electronic Shelf Label)",
    description: "Renders selected SignalK data to BLE eInk Electronic Shelf Labels",
    // Read fresh from disk on every call (rather than cached in memory) so it reflects whichever scan
    // last completed - the startup scan below, an on-demand scan for a `device: "ALL"` repaint (see
    // `resolveTargets` in `repaintScheduler.ts`), or `esl-cli scan` - regardless of which one wrote it.
    schema: () => configSchema(app, Object.values(loadDiscoveredDevices(app))),
    uiSchema: () => configUiSchema(),
    start(config: object) {
      const pluginConfig: PluginConfig = {
        ...defaultConfig(),
        ...(config as Partial<PluginConfig>),
      };
      app.debug(`starting with ${pluginConfig.devices.length} configured device(s)`);
      healNestedConfig(app);
      stopped = false;

      const useBleApi = pluginConfig.useBleApi && bleApiAvailable;
      if (pluginConfig.useBleApi && !bleApiAvailable) {
        app.debug(
          "useBleApi is enabled but this SignalK server has no BLE Manager API (requires >= 2.32.0) - falling back to direct BlueZ access",
        );
      }
      app.debug(useBleApi ? "using the SignalK BLE Manager API for Bluetooth access" : "using direct BlueZ access for Bluetooth");

      const start = () => {
        if (stopped) return;
        if (pluginConfig.scanOnStart) {
          void runStartupScan(app, pluginConfig.scanDurationSeconds, useBleApi);
        }
        scheduler = startRepaintScheduler(app, pluginConfig);
      };

      if (useBleApi) {
        // BLE Manager already runs its own continuous scan server-side (that's what populates its own
        // admin UI device list) - unlike direct BlueZ access below, discovery here doesn't need a
        // bounded scan window at all, so this listens for as long as the plugin runs rather than only
        // during `scanOnStart`/an on-demand `ALL_DEVICES` scan. See its own doc comment.
        stopDiscoveryListener = startBleApiDiscoveryListener(app, PLUGIN_NAME);
        // The server/provider governs its own local-adapter readiness once BLE Manager mode owns
        // `hci0` (or has none at all, behind a remote gateway) - waiting on a *local* BlueZ adapter
        // here would be waiting on something this mode may never even need.
        start();
      } else {
        // Waits (with backoff, indefinitely on Linux) for a BLE adapter before the startup scan or
        // the repaint scheduler touch BLE at all - see `waitForAdapter`'s doc comment on the
        // boot-time race this covers. `stopped` is checked again inside `start()`, not just passed
        // as `cancelled`, since the wait can also resolve `true` on its own right as `stop()` runs.
        void waitForAdapter(
          (message) => app.debug(message),
          () => stopped,
        ).then(start);
      }
    },
    stop() {
      stopped = true;
      scheduler?.stop();
      scheduler = undefined;
      stopDiscoveryListener?.();
      stopDiscoveryListener = undefined;
      app.debug("stopped");
    },
  };

  return plugin;
}
