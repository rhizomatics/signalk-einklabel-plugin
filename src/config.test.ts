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
