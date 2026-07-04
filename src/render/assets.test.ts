import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describeAssetsDirProblem, normalizeAssetKey, resolveAssetPath } from './assets';

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
  const templatesDir = mkdtempSync(join(tmpdir(), 'einklabel-assets-user-'));
  const bundledTemplatesDir = mkdtempSync(join(tmpdir(), 'einklabel-assets-bundled-'));
  const bundledAssetsDir = join(bundledTemplatesDir, 'assets', 'lunar_phases');
  mkdirSync(bundledAssetsDir, { recursive: true });
  writeFileSync(join(bundledAssetsDir, 'full_moon.svg'), '<svg />');

  await t.test('falls back to the bundled assets directory when the user has none of their own', () => {
    assert.equal(resolveAssetPath(templatesDir, bundledTemplatesDir, 'lunar_phases', 'full_moon'), join(bundledAssetsDir, 'full_moon.svg'));
  });

  await t.test('is undefined when no matching file exists in either directory', () => {
    assert.equal(resolveAssetPath(templatesDir, bundledTemplatesDir, 'lunar_phases', 'no_such_phase'), undefined);
  });

  await t.test("prefers the user's own assets directory wholesale, without merging in bundled files", () => {
    const userAssetsDir = join(templatesDir, 'assets', 'lunar_phases');
    mkdirSync(userAssetsDir, { recursive: true });
    writeFileSync(join(userAssetsDir, 'new_moon.svg'), '<svg />');

    // Present in the user's directory - resolves there.
    assert.equal(resolveAssetPath(templatesDir, bundledTemplatesDir, 'lunar_phases', 'new_moon'), join(userAssetsDir, 'new_moon.svg'));
    // Only in the bundled directory - since the user's own "lunar_phases" directory exists at all,
    // it's used exclusively, so this does NOT fall back to the bundled "full_moon.svg".
    assert.equal(resolveAssetPath(templatesDir, bundledTemplatesDir, 'lunar_phases', 'full_moon'), undefined);
  });
});

test('describeAssetsDirProblem', async (t) => {
  const templatesDir = mkdtempSync(join(tmpdir(), 'einklabel-assets-user-'));
  const bundledTemplatesDir = mkdtempSync(join(tmpdir(), 'einklabel-assets-bundled-'));

  await t.test('undefined when the selected (bundled) directory is fine', () => {
    mkdirSync(join(bundledTemplatesDir, 'assets', 'lunar_phases'), { recursive: true });
    assert.equal(describeAssetsDirProblem(templatesDir, bundledTemplatesDir, 'lunar_phases'), undefined);
  });

  await t.test("reports when neither the user's nor the bundled directory exists", () => {
    const problem = describeAssetsDirProblem(templatesDir, bundledTemplatesDir, 'no_such_assets');
    assert.match(problem ?? '', /does not exist/);
  });
});
