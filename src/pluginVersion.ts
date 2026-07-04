import { readFileSync } from "fs";
import { join } from "path";

const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

/**
 * The installed plugin's own version, read from `package.json` once at module load - exposed to
 * templates as `source=einklabel,path=plugin_version` (see `meta` in repaintScheduler.ts and
 * `cli/liveContext.ts`), e.g. to show a build/version marker on a label for support purposes.
 */
export const PLUGIN_VERSION: string = packageJson.version;

/**
 * The installed plugin's own package name, with any npm scope (`@rhizomatics/`) stripped - prefixed
 * onto `console.error` lines from code shared with the CLI (rendering/device-driver modules with no
 * `ServerAPI` to call `app.debug` on). SignalK server's own `app.debug` calls are auto-namespaced
 * with the plugin id (unscoped, e.g. `signalk-einklabel-plugin`) by the `debug` module underneath
 * it, so without this prefix those `console.error` lines would show up in the server log
 * unidentified next to ones that are - matching the unscoped form keeps the two consistent.
 */
export const PLUGIN_NAME: string = (packageJson.name as string).replace(/^@[^/]+\//, "");
