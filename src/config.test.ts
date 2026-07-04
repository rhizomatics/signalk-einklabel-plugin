import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { ServerAPI } from '@signalk/server-api';
import { DiscoveredDevice } from './devices/types';
import { configSchema, configUiSchema, defaultConfig, parseDevice, PluginConfig, resolveTemplatePath, resolveTemplatesDir } from './config';

function fakeApp(options: Partial<PluginConfig> = {}): ServerAPI {
  return { readPluginOptions: () => options } as unknown as ServerAPI;
}

test('resolveTemplatesDir', async (t) => {
  await t.test('defaults to ~/.signalk/esl/templates when empty/undefined', () => {
    const expected = join(homedir(), '.signalk', 'einklabel', 'templates');
    assert.equal(resolveTemplatesDir(undefined), expected);
    assert.equal(resolveTemplatesDir(''), expected);
    assert.equal(resolveTemplatesDir('   '), expected);
  });

  await t.test('resolves a relative path against ~/.signalk', () => {
    assert.equal(resolveTemplatesDir('my-templates'), join(homedir(), '.signalk', 'my-templates'));
  });

  await t.test('uses an absolute path as-is', () => {
    assert.equal(resolveTemplatesDir('/srv/esl/templates'), '/srv/esl/templates');
  });
});

test('parseDevice', async (t) => {
  await t.test('parses vendor:pid@address', () => {
    assert.deepEqual(parseDevice('zhsunyco:14@66:66:17:50:0C:74'), {
      vendor: 'zhsunyco',
      pid: 14,
      hwVersion: undefined,
      address: '66:66:17:50:0C:74',
    });
  });

  await t.test('parses an optional hwVersion', () => {
    assert.deepEqual(parseDevice('zhsunyco:14:v2@AA:BB:CC:DD:EE:FF'), {
      vendor: 'zhsunyco',
      pid: 14,
      hwVersion: 'v2',
      address: 'AA:BB:CC:DD:EE:FF',
    });
  });

  await t.test('returns undefined for a malformed token', () => {
    assert.equal(parseDevice('not-a-valid-device-token'), undefined);
    assert.equal(parseDevice('zhsunyco:notanumber@AA:BB:CC:DD:EE:FF'), undefined);
  });
});

test('defaultConfig has sane defaults', () => {
  const defaults = defaultConfig();
  assert.equal(defaults.templatesDir, '');
  assert.equal(defaults.scanOnStart, true);
  assert.equal(defaults.scanDurationSeconds, 20);
  assert.equal(defaults.paintConnectTimeoutSeconds, 30);
  assert.equal(defaults.paintRetries, 3);
  assert.deepEqual(defaults.devices, []);
});

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'einklabel-templates-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveTemplatePath', async (t) => {
  await t.test('falls back to the bundled templates dir when there is no local override', () => {
    withTempDir((dir) => {
      assert.match(resolveTemplatePath(dir, 'tide.svg'), /[\\/]templates[\\/]tide\.svg$/);
    });
  });

  await t.test('prefers a local template over the bundled one of the same name', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'tide.svg'), '<svg/>');
      assert.equal(resolveTemplatePath(dir, 'tide.svg'), join(dir, 'tide.svg'));
    });
  });
});

test('configSchema', async (t) => {
  await t.test('lists local and bundled template names, with a local one shadowing a same-named bundled one', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'custom.svg'), '<svg/>');
      writeFileSync(join(dir, 'tide.svg'), '<svg/>');
      const schema = configSchema(fakeApp({ templatesDir: dir }), []) as any;
      assert.deepEqual(schema.properties.devices.items.properties.templateName.enum, ['custom.svg', 'tide.svg']);
    });
  });

  await t.test('builds the device enum/enumNames from discovered devices, skipping ones with no confirmed pid', () => {
    const discovered: DiscoveredDevice[] = [
      {
        address: 'AA:AA:AA:AA:AA:AA',
        vendor: 'zhsunyco',
        pid: 14,
        metadata: { pid: 14, label: '2.9in BWR', width: 296, height: 128, voffset: 0, colours: ['black', 'white', 'red'] },
      },
      { address: 'BB:BB:BB:BB:BB:BB', vendor: 'zhsunyco', pid: 0x99, hwVersion: 'v2' },
      { address: 'CC:CC:CC:CC:CC:CC', vendor: 'zhsunyco' },
    ];
    const schema = configSchema(fakeApp(), discovered) as any;
    const deviceSchema = schema.properties.devices.items.properties.device;
    assert.deepEqual(deviceSchema.enum, ['zhsunyco:14@AA:AA:AA:AA:AA:AA', 'zhsunyco:153:v2@BB:BB:BB:BB:BB:BB']);
    assert.deepEqual(deviceSchema.enumNames, [
      'zhsunyco 2.9in BWR (AA:AA:AA:AA:AA:AA)',
      'zhsunyco unrecognised PID 0x0099 (BB:BB:BB:BB:BB:BB)',
    ]);
  });

  await t.test('keeps a saved device from the current config even if not seen in the last scan', () => {
    const app = fakeApp({
      devices: [
        { friendlyName: 'Galley label', device: 'zhsunyco:14@AA:AA:AA:AA:AA:AA', templateName: 'tide.svg', repaintTrigger: 'interval' },
      ],
    });
    const deviceSchema = (configSchema(app, []) as any).properties.devices.items.properties.device;
    assert.deepEqual(deviceSchema.enum, ['zhsunyco:14@AA:AA:AA:AA:AA:AA']);
    assert.deepEqual(deviceSchema.enumNames, ['zhsunyco:14@AA:AA:AA:AA:AA:AA (not seen in last scan)']);
  });

  await t.test('omits enum/enumNames entirely when there are no device options, since JSON Schema forbids an empty enum', () => {
    const deviceSchema = (configSchema(fakeApp(), []) as any).properties.devices.items.properties.device;
    assert.equal('enum' in deviceSchema, false);
    assert.equal('enumNames' in deviceSchema, false);
  });

  await t.test('carries defaultConfig() values through as JSON Schema defaults', () => {
    const schema = configSchema(fakeApp(), []) as any;
    assert.equal(schema.properties.scanOnStart.default, true);
    assert.equal(schema.properties.paintRetries.default, 3);
  });
});

test('configUiSchema renders repaintTrigger as a radio group', () => {
  assert.deepEqual(configUiSchema(), { devices: { items: { repaintTrigger: { 'ui:widget': 'radio' } } } });
});
