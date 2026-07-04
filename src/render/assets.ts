import { accessSync, constants, existsSync, statSync } from "fs";
import { join } from "path";

/**
 * Turns a resolved binding value into a filename stem, e.g. `"Waning Gibbous"` -> `"waning_gibbous"` -
 * so a `signalk`/`resources` value using SignalK's own display casing (title case, spaces) can match a
 * file named the conventional snake_case way. Returns `undefined` for anything that can't sensibly name
 * a file (non-string, empty, or all-punctuation), which callers treat as "no image".
 */
export function normalizeAssetKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || undefined;
}

/**
 * Picks which `assets/<assetsName>` directory an `assets=` binding should read from - the user's own
 * `templatesDir/assets/<assetsName>` if it exists as a directory at all, otherwise
 * `bundledTemplatesDir/assets/<assetsName>` (see `BUNDLED_TEMPLATES_DIR` in `../config.ts`). This is a
 * whole-directory choice, not a per-file merge: a user who provides their own `assets/lunar_phases`
 * directory (even a partial one, missing some phases) gets exactly that directory and nothing from the
 * bundled set, so it's always clear which files are in play - see the module's "overrides only work at
 * directory level" design note. This choice is independent of which template file (bundled or a user
 * override) ended up being rendered, so a user can override just a template, just its resources, or
 * both, in any combination.
 */
function selectAssetsDir(
  templatesDir: string,
  bundledTemplatesDir: string,
  assetsName: string,
): string {
  const userDir = join(templatesDir, "assets", assetsName);
  try {
    if (statSync(userDir).isDirectory()) return userDir;
  } catch {
    // doesn't exist (or isn't readable) - fall through to the bundled directory
  }
  return join(bundledTemplatesDir, "assets", assetsName);
}

/**
 * Resolves an `assets=` binding to an actual `.svg` file, looked up as `<key>.svg` inside whichever
 * `assets/<assetsName>` directory `selectAssetsDir` picks. `undefined` if that directory has no
 * matching file, which callers treat as "no image" rather than an error, since an unmapped value
 * (e.g. a phase name the asset set doesn't cover) is an expected, not exceptional, case.
 */
export function resolveAssetPath(
  templatesDir: string,
  bundledTemplatesDir: string,
  assetsName: string,
  key: string,
): string | undefined {
  const candidate = join(
    selectAssetsDir(templatesDir, bundledTemplatesDir, assetsName),
    `${key}.svg`,
  );
  return existsSync(candidate) ? candidate : undefined;
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
 * `resolveAssetPath` comes back empty - a wrong/misconfigured `assets=` name (typo, nothing bundled or
 * user-supplied under that name) looks identical to "this value just has no icon" from
 * `resolveAssetPath` alone, and the two need very different fixes. Checks the same directory
 * `resolveAssetPath` would have read from; `undefined` when that directory is fine (exists, is a
 * directory, is readable) - the miss is then just this value's.
 */
export function describeAssetsDirProblem(
  templatesDir: string,
  bundledTemplatesDir: string,
  assetsName: string,
): string | undefined {
  const problem = describeDir(selectAssetsDir(templatesDir, bundledTemplatesDir, assetsName));
  return problem && `assets directory ${problem}`;
}
