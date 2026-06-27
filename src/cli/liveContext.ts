import { Binding } from '../render/binding';
import { TemplateContext } from '../render/types';
import { fetchJson } from '../httpJson';
import { logDebug } from './log';

const RESOURCES_API_PATH = '/signalk/v2/api/resources';
const UNIT_PREFERENCES_PATH = '/signalk/v1/unitpreferences/active';

/** `context=self` -> `vessels/self`, `context=vessels.urn:mrn:imo:mmsi:1` -> `vessels/urn:mrn:imo:mmsi:1` - matches the REST path for that context's full-data-model subtree. */
function contextPath(context: string): string {
  return context === 'self' ? 'vessels/self' : context.replace(/\./g, '/');
}

/**
 * CLI counterpart to `assembleRawContext` in repaintScheduler.ts - same `{ signalk, resources }` shape,
 * but fetched entirely over plain HTTP (the CLI has no live `ServerAPI` to call `getSelfPath`/`getPath`
 * on) against a real or test SignalK server's REST API. Fetches each referenced context's/resource's
 * *whole* subtree once and lets the existing binding resolver navigate `path` within it - exactly what
 * already happens for `resources` in the live plugin, just applied to `signalk` contexts too.
 *
 * Unlike the live plugin, a missing unit-preferences endpoint only warns (not throws) - useful for
 * pointing this at a minimal test server that doesn't implement it, when no binding being checked needs
 * unit conversion anyway.
 */
export async function assembleLiveContext(signalkUrl: string, bindings: Binding[]): Promise<TemplateContext> {
  const signalk: Record<string, unknown> = {};
  const contexts = new Set(bindings.filter((binding) => binding.source === 'signalk').map((binding) => binding.context));
  for (const context of contexts) {
    const url = `${signalkUrl}/signalk/v1/api/${contextPath(context)}`;
    logDebug(`GET ${url}`);
    signalk[context] = await fetchJson(url);
  }

  const resources: Record<string, unknown> = {};
  const resourceNames = new Set(bindings.filter((binding) => binding.source === 'resources').map((binding) => binding.resource as string));
  for (const name of resourceNames) {
    const url = `${signalkUrl}${RESOURCES_API_PATH}/${name}`;
    logDebug(`GET ${url}`);
    resources[name] = await fetchJson(url);
  }
  const unitPreferencesUrl = `${signalkUrl}${UNIT_PREFERENCES_PATH}`;
  try {
    logDebug(`GET ${unitPreferencesUrl}`);
    resources.unitPreferences = await fetchJson(unitPreferencesUrl);
  } catch (err) {
    console.error(`warning: could not fetch unit preferences (${(err as Error).message}) - unit-converting formats will show raw values`);
  }

  return { signalk, resources };
}
