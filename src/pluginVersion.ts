import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The installed plugin's own version, read from `package.json` once at module load - exposed to
 * templates as `source=einklabel,path=plugin_version` (see `meta` in repaintScheduler.ts and
 * `cli/liveContext.ts`), e.g. to show a build/version marker on a label for support purposes.
 */
export const PLUGIN_VERSION: string = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
