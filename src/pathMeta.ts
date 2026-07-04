import { fetchJson } from "./httpJson";
import { DisplayUnits } from "./render/formatters";

export interface PathMetadata {
  units?: string;
  description?: string;
  displayUnits?: DisplayUnits;
}

/** `self` -> `vessels/self`, `vessels.urn:mrn:imo:mmsi:1` -> `vessels/urn:mrn:imo:mmsi:1` - matches the REST path for that context's whole-vessel metadata. */
function metaContextPath(context: string): string {
  return context === "self" ? "vessels/self" : context.replace(/\./g, "/");
}

/**
 * Fetches all of a vessel's per-path metadata in one request - `GET .../vessels/<context>/meta` returns
 * a flat `{ "<dotted.path>": { units, description, displayUnits? }, ... }` map, with `displayUnits`
 * already fully resolved (category/targetUnit/formula/symbol) server-side. That resolution
 * (`enhanceMetadataResponse` in signalk-server's `src/interfaces/rest.js`) has no in-process equivalent
 * reachable via the plugin API (confirmed against the signalk-server source - `app.getMetadata` is
 * bound directly to the unenhanced `@signalk/path-metadata` package), so both the live plugin
 * (repaintScheduler.ts) and the CLI (cli/liveContext.ts) fetch it the same way, over HTTP.
 */
export async function fetchPathMeta(apiUrl: string, context: string): Promise<Record<string, PathMetadata>> {
  const url = `${apiUrl}/signalk/v1/api/${metaContextPath(context)}/meta`;
  return (await fetchJson(url)) as Record<string, PathMetadata>;
}
