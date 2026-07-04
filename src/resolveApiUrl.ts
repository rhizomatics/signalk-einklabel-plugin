import { fetchJson } from "./httpJson";

/**
 * This whole module is a workaround for a gap in the plugin API, not a permanent design choice -
 * `resourcesApi`/`weatherApi`/`courseApi` etc. on `ServerAPI` exist because of an ongoing upstream
 * effort to broaden what plugins can reach in-process; unit-preferences resolution (and enhanced
 * per-path metadata) just hasn't been added yet. If/when it is, this probing - and `unitCategories.ts`'s
 * client-side recomposition of the same resolution - can likely be replaced with a direct in-process
 * call, dropping the need for `signalkApiUrl` entirely.
 */

/**
 * The only realistic values for this server's own base URL, in likelihood order - the plugin always
 * runs on the same host as the server, so it's always the loopback address, and the port is determined
 * entirely by install method: a bare `npm install` defaults to 3000; container/systemd installs
 * commonly default to 80, or 443 if TLS-terminated locally.
 */
export const SIGNALK_API_URL_OPTIONS = ["http://localhost:3000", "http://localhost", "https://localhost"];

/** Cheap, always-required (for `category=` resolution) and read-only, so safe to use as a connectivity+access probe. */
const PROBE_PATH = "/signalk/v1/unitpreferences/categories";

async function probe(url: string): Promise<boolean> {
  try {
    await fetchJson(`${url}${PROBE_PATH}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves this server's own base URL. If `configuredUrl` is set, trusts it but still confirms it
 * actually works, so a bad config value surfaces a clear error instead of failing silently on every
 * `category=` binding or per-path metadata fetch. If unset, probes `SIGNALK_API_URL_OPTIONS` in order
 * and uses the first that responds.
 */
export async function resolveSignalkApiUrl(configuredUrl: string | undefined): Promise<string> {
  const candidates = configuredUrl ? [configuredUrl] : SIGNALK_API_URL_OPTIONS;
  for (const url of candidates) {
    if (await probe(url)) return url;
  }
  throw new Error(
    configuredUrl
      ? `configured SignalK API base URL "${configuredUrl}" did not respond to ${PROBE_PATH} - check the port, and that anonymous read access is enabled`
      : `could not reach this server's API on any of ${SIGNALK_API_URL_OPTIONS.join(", ")} - it may be on a different port, or anonymous read access may not be enabled`,
  );
}

/**
 * Memoizes a successful resolution only - a failure (server not ready yet, anonymous access
 * temporarily misconfigured, ...) is retried on the next call rather than cached forever, since the
 * port itself won't change once the server's actually up.
 */
export function createApiUrlResolver(configuredUrl: string | undefined): () => Promise<string> {
  let resolved: string | undefined;
  return async () => {
    if (!resolved) {
      resolved = await resolveSignalkApiUrl(configuredUrl);
    }
    return resolved;
  };
}
