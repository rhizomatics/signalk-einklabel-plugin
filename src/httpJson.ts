/**
 * Describes a network-level fetch failure's `error.cause` - Node's `fetch()` only ever throws a
 * generic `TypeError: fetch failed`, with the actually useful detail (e.g. ECONNREFUSED) nested in
 * `.cause`, and a multi-address connection attempt (e.g. trying both IPv6 and IPv4 for "localhost")
 * surfaces as an `AggregateError` whose own `.message` is empty - the real detail is in `.errors`.
 */
function describeCause(cause: unknown): string {
  const errors = (cause as { errors?: unknown[] }).errors;
  if (Array.isArray(errors)) {
    return errors.map(describeCause).join("; ");
  }
  if (cause instanceof Error) {
    return cause.message || (cause as NodeJS.ErrnoException).code || cause.toString();
  }
  return String(cause);
}

/**
 * Fetches and parses a JSON endpoint, with an error message that's actually actionable: which URL,
 * what HTTP status, and the response/underlying error detail - see `describeCause` for why plain
 * `fetch()` failures need unwrapping to be useful at all.
 */
export async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const detail = cause !== undefined ? describeCause(cause) : (err as Error).message;
    throw new Error(`fetch failed: ${url} - ${detail}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`fetch failed: ${url} (${response.status} ${response.statusText})${body ? ` - ${body}` : ""}`);
  }
  return response.json();
}
