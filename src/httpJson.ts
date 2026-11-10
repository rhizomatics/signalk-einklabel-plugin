import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

/** How many redirects the self-signed path follows before giving up - `fetch()`'s own default is 20. */
const MAX_REDIRECTS = 5;
/** Per-request deadline on the self-signed path, which has none of `fetch()`'s built-in timeouts. */
const REQUEST_TIMEOUT_MS = 30_000;

let allowSelfSigned = false;

/**
 * Whether `fetchJson` accepts a self-signed (or otherwise unverifiable) TLS certificate. Off by default,
 * so certificates are verified exactly as plain `fetch()` does. Set from the plugin's
 * `allowSelfSignedCertificates` config on each start - a SignalK server with SSL enabled redirects its http
 * port to https, usually with a self-signed certificate, which `fetch()` otherwise always rejects. Process-wide
 * rather than per call, since every `fetchJson` call in the plugin goes to that one server's own API.
 */
export function setAllowSelfSignedCertificates(allowed: boolean): void {
  allowSelfSigned = allowed;
}

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
  if (allowSelfSigned) return fetchJsonAllowingSelfSigned(url);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const detail = cause !== undefined ? describeCause(cause) : (err as Error).message;
    throw new Error(`fetch failed: ${url} - ${detail}${certificateHint(detail)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`fetch failed: ${url} (${response.status} ${response.statusText})${body ? ` - ${body}` : ""}`);
  }
  return response.json();
}

/** Points a certificate failure at the setting that fixes it, since the raw TLS error doesn't. */
function certificateHint(detail: string): string {
  return /certificate|CERT_/i.test(detail)
    ? ' - if this server uses a self-signed certificate, enable "Allow self-signed certificates" in the plugin config'
    : "";
}

/**
 * `fetchJson` over `node:http`/`node:https` with certificate verification off - built-in `fetch()` has no
 * per-request way to skip it without the separate `undici` package. Follows redirects itself (the http to
 * https redirect being the usual reason to need this at all), with the same error messages as `fetchJson`.
 */
async function fetchJsonAllowingSelfSigned(url: string): Promise<unknown> {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    let response: IncomingMessage;
    try {
      response = await sendGet(current);
    } catch (err) {
      throw new Error(`fetch failed: ${url} - ${describeCause(err)}`);
    }
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) throw new Error(`fetch failed: ${url} - more than ${MAX_REDIRECTS} redirects`);
      current = new URL(location, current).toString();
      continue;
    }
    const body = await readBody(response).catch(() => "");
    if (status < 200 || status >= 300) {
      throw new Error(`fetch failed: ${url} (${status} ${response.statusMessage ?? ""})${body ? ` - ${body}` : ""}`);
    }
    return JSON.parse(body);
  }
}

function sendGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers = { accept: "application/json" };
    const request =
      target.protocol === "https:"
        ? httpsRequest(target, { headers, rejectUnauthorized: false }, resolve)
        : httpRequest(target, { headers }, resolve);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error(`no response after ${REQUEST_TIMEOUT_MS / 1000}s`)));
    request.on("error", reject);
    request.end();
  });
}

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    response.on("error", reject);
  });
}
