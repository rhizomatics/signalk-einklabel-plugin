import { existsSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Turns a resolved binding value into a filename stem, e.g. `"Waning Gibbous"` -> `"waning_gibbous"` -
 * so a `signalk`/`resources` value using SignalK's own display casing (title case, spaces) can match a
 * file named the conventional snake_case way. Returns `undefined` for anything that can't sensibly name
 * a file (non-string, empty, or all-punctuation), which callers treat as "no image".
 */
export function normalizeAssetKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || undefined;
}

/**
 * Resolves an `assets=` binding to an actual `.svg` file, looked up as `<key>.svg` inside `assetsDir`
 * resolved relative to the template's own directory (mirroring how a bundled template's relative asset
 * references keep working whether the template itself is the bundled copy or a user override elsewhere) -
 * `undefined` if no matching file exists, which callers treat as "no image" rather than an error, since an
 * unmapped value (e.g. a phase name the asset set doesn't cover) is an expected, not exceptional, case.
 */
export function resolveAssetPath(templatePath: string, assetsDir: string, key: string): string | undefined {
  const candidate = join(dirname(templatePath), assetsDir, `${key}.svg`);
  return existsSync(candidate) ? candidate : undefined;
}
