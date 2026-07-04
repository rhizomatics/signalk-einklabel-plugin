import { accessSync, constants, existsSync, statSync } from 'fs';
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
 * resolved relative to the template's own directory first - so a fully custom template can ship its
 * own asset set right alongside itself. If that misses and `fallbackTemplateDir` is given (the
 * package's own bundled `templates/` directory - see `BUNDLED_TEMPLATES_DIR` in `../config.ts`), also
 * tries `assetsDir` relative to *that* - so overriding a bundled template (e.g. to retouch its layout)
 * doesn't also require duplicating the bundled resources (e.g. `resources/svg/lunar_phases`) alongside
 * the override just to keep a binding it never touched working. `undefined` if neither has a matching
 * file, which callers treat as "no image" rather than an error, since an unmapped value (e.g. a phase
 * name the asset set doesn't cover) is an expected, not exceptional, case.
 */
export function resolveAssetPath(templatePath: string, assetsDir: string, key: string, fallbackTemplateDir?: string): string | undefined {
  const primary = join(dirname(templatePath), assetsDir, `${key}.svg`);
  if (existsSync(primary)) return primary;
  if (fallbackTemplateDir) {
    const fallback = join(fallbackTemplateDir, assetsDir, `${key}.svg`);
    if (existsSync(fallback)) return fallback;
  }
  return undefined;
}

/** `undefined` when `dir` is a readable directory - otherwise a human-readable reason it isn't. */
function describeDir(dir: string): string | undefined {
  if (!existsSync(dir)) return `"${dir}" does not exist`;
  let stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    return `"${dir}" could not be read: ${(err as Error).message}`;
  }
  if (!stats.isDirectory()) return `"${dir}" is not a directory`;
  try {
    accessSync(dir, constants.R_OK);
  } catch (err) {
    return `"${dir}" is not readable: ${(err as Error).message}`;
  }
  return undefined;
}

/**
 * Diagnoses why an `assets=` directory itself might be at fault, for a caller to log when
 * `resolveAssetPath` comes back empty - a wrong/misconfigured `assets=` directory (typo, moved
 * template, unreadable permissions) looks identical to "this value just has no icon" from
 * `resolveAssetPath` alone, and the two need very different fixes. Checks the same primary/fallback
 * pair `resolveAssetPath` tried; returns `undefined` only when at least one of them is a fine
 * (existing, readable) directory - the miss is then just this value's, not the directory's.
 */
export function describeAssetsDirProblem(templatePath: string, assetsDir: string, fallbackTemplateDir?: string): string | undefined {
  const primaryProblem = describeDir(join(dirname(templatePath), assetsDir));
  if (!fallbackTemplateDir) return primaryProblem && `assets directory ${primaryProblem}`;

  const fallbackProblem = describeDir(join(fallbackTemplateDir, assetsDir));
  if (!primaryProblem || !fallbackProblem) return undefined;
  return `assets directory ${primaryProblem}, and bundled fallback ${fallbackProblem}`;
}
