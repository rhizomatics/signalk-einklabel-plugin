import { TemplateContext } from './types';

const SOURCES = ['signalk', 'resources'] as const;
type Source = (typeof SOURCES)[number];

/**
 * Parsed form of a `<desc>`'s `key=value,key=value` content - see `parseBinding` for the grammar.
 */
const CONTEXT_PATTERN = /^(self|mmsi:\d+)$/;

export interface Binding {
  source: Source;
  /** `'self'` or `'mmsi:<digits>'` - must match a `ContextConfig.vessels[].context` when not `'self'`. */
  context: string;
  /** Required when `source === 'resources'` - names a configured provider (`ContextConfig.providers[].name`). */
  resource?: string;
  path: string;
  format?: string;
  round?: number;
}

const KNOWN_KEYS = new Set(['source', 'context', 'resource', 'path', 'format', 'round']);

/**
 * Parses a `<desc>` element's text content into a `Binding`, e.g.
 * `source=resources,resource=tides,path=extremes.[0].level,format=depth,round=2` or, using the
 * defaults (`source=signalk,context=self`), plain `path=navigation.speedOverGround,format=speed`.
 * A bare path with no `key=value` pairs at all, e.g. `environment.forecast.description`, is shorthand
 * for `path=environment.forecast.description` (source/context still default to signalk/self) - SignalK
 * paths never contain `=`, so its absence unambiguously signals this shorthand.
 */
export function parseBinding(desc: string): Binding {
  const trimmedDesc = desc.trim();
  if (trimmedDesc && !trimmedDesc.includes('=')) {
    return { source: 'signalk', context: 'self', path: trimmedDesc };
  }

  const fields: Record<string, string> = {};
  for (const pair of desc.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      throw new Error(`invalid binding "${desc}" - expected "key=value" pairs, got "${trimmed}"`);
    }
    const key = trimmed.slice(0, eq).trim();
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`invalid binding "${desc}" - unknown key "${key}"`);
    }
    fields[key] = trimmed.slice(eq + 1).trim();
  }

  const source = (fields.source ?? 'signalk') as Source;
  if (!SOURCES.includes(source)) {
    throw new Error(`invalid binding "${desc}" - unknown source "${source}"`);
  }
  const context = fields.context ?? 'self';
  if (!CONTEXT_PATTERN.test(context)) {
    throw new Error(`invalid binding "${desc}" - context "${context}" is not supported (expected "self" or "mmsi:<digits>")`);
  }
  if (source === 'resources' && !fields.resource) {
    throw new Error(`invalid binding "${desc}" - source=resources requires a "resource" key`);
  }
  if (!fields.path) {
    throw new Error(`invalid binding "${desc}" - missing required "path" key`);
  }

  return {
    source,
    context,
    resource: fields.resource,
    path: fields.path,
    format: fields.format,
    round: fields.round !== undefined ? Number(fields.round) : undefined,
  };
}

/** Supports both `a.[0].b` and `a[0].b` array index notation, matching `setAtPath` in repaintScheduler.ts. */
function getAtPath(obj: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);
  let node: unknown = obj;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Resolves a parsed `Binding` against the render context assembled by `assembleRawContext`. */
export function resolveBinding(binding: Binding, context: TemplateContext): unknown {
  if (binding.source === 'signalk') {
    const signalk = context.signalk as Record<string, unknown> | undefined;
    const vessel = signalk?.[binding.context];
    if (vessel === undefined) {
      throw new Error(`binding references context "${binding.context}" which is not present in the render context`);
    }
    return getAtPath(vessel, binding.path);
  }

  const resources = context.resources as Record<string, unknown> | undefined;
  const resource = resources?.[binding.resource as string];
  if (resource === undefined) {
    throw new Error(`binding references resource "${binding.resource}" which is not present in the render context`);
  }
  return getAtPath(resource, binding.path);
}
