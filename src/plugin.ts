import { Plugin, ServerAPI } from '@signalk/server-api';
import { configSchema, DEFAULT_CONFIG, PluginConfig } from './config';
import { registerDriver, allDrivers } from './devices/registry';
import { ZhsunycoDriver } from './devices/zhsunyco';
import { startRepaintScheduler, RepaintScheduler } from './repaintScheduler';

const STARTUP_SCAN_DURATION_MS = 15_000;

/** Mirrors signalk-bluetti-plugin's convention: scan briefly, report finds via plugin status for the user to copy-paste. */
async function runStartupScan(app: ServerAPI): Promise<void> {
  app.setPluginStatus(`Scanning for ESL devices for ${STARTUP_SCAN_DURATION_MS / 1000}s...`);
  let found = 0;
  for (const driver of allDrivers()) {
    const devices = await driver.scan(STARTUP_SCAN_DURATION_MS).catch((err) => {
      app.debug(`${driver.vendor} scan failed: ${err.message}`);
      return [];
    });
    for (const device of devices) {
      found++;
      const pid = device.pid !== undefined ? `0x${device.pid.toString(16).padStart(4, '0')}` : 'unknown';
      app.debug(`discovered ${driver.vendor} device "${device.name ?? ''}" [${device.address}] pid=${pid}`);
      app.setPluginStatus(`Discovered: ${device.name ?? driver.vendor} [${device.address}] - copy the address into a device below`);
    }
  }
  if (found === 0) {
    app.setPluginStatus('Scan complete - no ESL devices found nearby.');
  }
}

export function createPlugin(app: ServerAPI): Plugin {
  registerDriver(new ZhsunycoDriver());

  let scheduler: RepaintScheduler | undefined;

  const plugin: Plugin = {
    id: 'signalk-esl-plugin',
    name: 'eInk Shelf Label Display',
    description: 'Renders selected SignalK data to BLE eInk Electronic Shelf Labels',
    schema: () => configSchema(app),
    start(config: object) {
      const pluginConfig: PluginConfig = { ...DEFAULT_CONFIG, ...(config as Partial<PluginConfig>) };
      app.debug(`starting with ${pluginConfig.devices.length} configured device(s)`);

      if (pluginConfig.scanOnStart) {
        runStartupScan(app).catch((err) => app.debug(`startup scan failed: ${err.message}`));
      }

      scheduler = startRepaintScheduler(app, pluginConfig);
    },
    stop() {
      scheduler?.stop();
      scheduler = undefined;
      app.debug('stopped');
    },
  };

  return plugin;
}
