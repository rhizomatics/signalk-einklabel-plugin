import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { normalizeAssetKey, resolveAssetPath } from './assets';

test('normalizeAssetKey', async (t) => {
  await t.test('lower-cases and underscores a display-cased value', () => {
    assert.equal(normalizeAssetKey('Waning Gibbous'), 'waning_gibbous');
  });

  await t.test('collapses punctuation and trims leading/trailing separators', () => {
    assert.equal(normalizeAssetKey('  --New Moon!! '), 'new_moon');
  });

  await t.test('is undefined for a non-string value', () => {
    assert.equal(normalizeAssetKey(undefined), undefined);
    assert.equal(normalizeAssetKey(42), undefined);
  });

  await t.test('is undefined for an all-punctuation/empty value', () => {
    assert.equal(normalizeAssetKey('   '), undefined);
    assert.equal(normalizeAssetKey('!!!'), undefined);
  });
});

test('resolveAssetPath', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'einklabel-assets-'));
  const templatePath = join(dir, 'template.svg');
  writeFileSync(join(dir, 'template.svg'), '<svg />');
  writeFileSync(join(dir, 'full_moon.svg'), '<svg />');

  await t.test('resolves relative to the template file, not the cwd', () => {
    assert.equal(resolveAssetPath(templatePath, '.', 'full_moon'), join(dir, 'full_moon.svg'));
  });

  await t.test('is undefined when no matching file exists', () => {
    assert.equal(resolveAssetPath(templatePath, '.', 'no_such_phase'), undefined);
  });
});
