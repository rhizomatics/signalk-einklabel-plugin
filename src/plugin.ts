import { Plugin, ServerAPI } from '@signalk/server-api';
import { configSchema, DEFAULT_CONFIG, PluginConfig } from './config';
import { registerDriver } from './devices/registry';
import { ZhsunycoDriver } from './devices/zhsunyco';

export function createPlugin(app: ServerAPI): Plugin {
  registerDriver(new ZhsunycoDriver());

  const plugin: Plugin = {
    id: 'signalk-esl-plugin',
    name: 'eInk Shelf Label Display',
    description: 'Renders selected SignalK data to BLE eInk Electronic Shelf Labels',
    schema: configSchema,
    start(config: object) {
      const pluginConfig: PluginConfig = { ...DEFAULT_CONFIG, ...(config as Partial<PluginConfig>) };
      app.debug(`starting with ${pluginConfig.devices.length} configured device(s)`);
    },
    stop() {
      app.debug('stopped');
    },
  };

  return plugin;
}
