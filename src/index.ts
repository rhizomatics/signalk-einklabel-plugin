import { PluginConstructor } from '@signalk/server-api';
import { createPlugin } from './plugin';

const plugin: PluginConstructor = createPlugin;
module.exports = plugin;
