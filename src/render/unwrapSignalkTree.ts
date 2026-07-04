/**
 * SignalK's full data-model shape wraps every leaf as `{ value, $source, timestamp, ... }` rather
 * than the bare value - true both over HTTP (`GET .../vessels/self`) and in-process
 * (`app.getSelfPath`/`getPath` in the live plugin, see `repaintScheduler.ts` - despite that module's
 * name, these do NOT already return bare values for a regular published path; only a handful of
 * vessel-identity fields like `uuid` do). Recursively unwraps every such leaf so a `path=` binding
 * resolves the same way regardless of which of the two ways the render context was assembled. Only
 * applied to `signalk` fetches - `resources` responses have no such wrapper.
 *
 * Keys off `value` alone, not also requiring `timestamp`/`$source` - not every server includes both
 * on every leaf, and a `value` key is otherwise meaningless on a SignalK data-model node (it isn't a
 * regular vessel property name), so there's no real risk of unwrapping something that isn't this
 * wrapper.
 */
export function unwrapSignalkTree(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(unwrapSignalkTree);
  const obj = node as Record<string, unknown>;
  if ("value" in obj) {
    return obj.value;
  }
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, unwrapSignalkTree(value)]));
}
