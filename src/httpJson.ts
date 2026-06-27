/**
 * Fetches and parses a JSON endpoint, with an error message that's actually actionable: which URL,
 * what HTTP status, and the response/underlying error detail. Plain `fetch()` failures are otherwise
 * unhelpful - a network-level failure (e.g. connection refused) surfaces only a generic "fetch failed"
 * with the real cause buried in `error.cause`, and a non-OK response says nothing about why.
 */
export async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : (err as Error).message;
    throw new Error(`fetch failed: ${url} - ${detail}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`fetch failed: ${url} (${response.status} ${response.statusText})${body ? ` - ${body}` : ''}`);
  }
  return response.json();
}
