import { DateTime } from "luxon";
import { evaluate } from "mathjs";
import { TemplateContext } from "./types";

/**
 * Matches `displayUnits` on a path's own metadata (`app.getMetadata(path).displayUnits` in the live
 * plugin, the `.../meta` tree over HTTP in the CLI) - SignalK's per-path unit-preference info, fully
 * resolved (formula/symbol ready to use), unlike the global `/signalk/v1/unitpreferences/active`
 * endpoint which only gives a bare `targetUnit` name with no conversion math at all.
 */
export interface DisplayUnits {
  category: string;
  targetUnit: string;
  formula?: string;
  symbol?: string;
  displayFormat?: string;
}

/** Converts a base-SI value (always what SignalK paths deliver) to its metadata's preferred display unit and formats it with the unit's symbol, e.g. 3.42 -> "11.2ft". */
export function formatDisplayUnits(
  value: number,
  displayUnits: DisplayUnits,
  round: number | undefined,
): string {
  const converted = displayUnits.formula
    ? Number(evaluate(displayUnits.formula, { value }))
    : value;
  const decimals =
    round ??
    (displayUnits.displayFormat?.includes(".")
      ? displayUnits.displayFormat.split(".")[1].length
      : 0);
  const symbol = displayUnits.symbol ?? displayUnits.targetUnit;
  return `${converted.toFixed(decimals)}${symbol}`;
}

/**
 * The local vessel's timezone (`signalk.self.environment.time.timezoneRegion`), regardless of which
 * vessel's value is being formatted - the display's own clock/locale is what matters, not the data
 * source's. Most installs never publish that path (it needs a GPS/position-derived timezone plugin),
 * so this falls back to the host machine's own configured zone - the same thing the SignalK Data
 * Browser ends up showing, since it's just the browser's local `Intl` zone rather than anything the
 * server itself publishes. For the live plugin that's the device's own OS timezone (set once via
 * `raspi-config`/`timedatectl` et al, not GPS-derived); for the CLI it's the developer machine's.
 */
function selfTimezone(context: TemplateContext): string {
  const signalk = context.signalk as Record<string, unknown> | undefined;
  const self = signalk?.self as Record<string, unknown> | undefined;
  const environment = self?.environment as { time?: { timezoneRegion?: string } } | undefined;
  return environment?.time?.timezoneRegion || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Short zone name (e.g. "BST", or "GMT+1" where the host's own `Intl` locale has no real abbreviation
 * for the zone) for the same zone `selfTimezone` resolves - an alternative for
 * `environment.time.timezoneRegion,format=utc_offset` on installs that never publish that path (see
 * `selfTimezone`'s own comment). Uses the host's default locale rather than pinning one, so it shows
 * whatever `Intl` would show the host's own user - "GMT+1" is an acceptable fallback where that locale
 * doesn't have a 3-letter abbreviation to offer. Resolved as a `source=einklabel,path=local_zone`
 * binding (see `considerRepaint`).
 */
export function resolveLocalZoneAbbreviation(context: TemplateContext): string {
  const part = new Intl.DateTimeFormat(undefined, {
    timeZone: selfTimezone(context),
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/**
 * A `resources`-sourced timestamp can arrive as either an ISO string (always true over HTTP, since
 * `JSON.stringify` converts a `Date` to its ISO string automatically) or a live `Date` instance (an
 * in-process `app.resourcesApi` call skips that serialisation step entirely, so a provider that hasn't
 * itself called `.toISOString()` yet hands back the raw object) - accept both so the live plugin and
 * the CLI render identically regardless of which path a binding's data took.
 */
function parseTimestamp(value: unknown): DateTime | undefined {
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: "utc" });
  if (typeof value === "string") return DateTime.fromISO(value, { zone: "utc" });
  return undefined;
}

/**
 * Shows the explicit IANA zone name rather than an abbreviation (e.g. "BST") - UK tide tables are
 * officially published in GMT, so the basis for the displayed time must be unambiguous rather than
 * just locally styled.
 */
function formatLocalTime(value: unknown, context: TemplateContext): string {
  const dt = parseTimestamp(value)?.setZone(selfTimezone(context));
  return dt?.isValid ? dt.toFormat("HH:mm") : "";
}

/** e.g. "27 Jun" - day of month (no leading zero) and abbreviated month name, in the local vessel's timezone. */
function formatDayMonth(value: unknown, context: TemplateContext): string {
  const dt = parseTimestamp(value)?.setZone(selfTimezone(context));
  return dt?.isValid ? dt.toFormat("d MMM") : "";
}

/** e.g. "21 Jun 26 18:05" - day of month (no leading zero), abbreviated month, 2-digit year, and 24h time, in the local vessel's timezone. */
function formatLocalDatetimeShort(value: unknown, context: TemplateContext): string {
  const dt = parseTimestamp(value)?.setZone(selfTimezone(context));
  return dt?.isValid ? dt.toFormat("d MMM yy HH:mm") : "";
}

/**
 * IANA region names are ambiguous about DST (e.g. "Europe/London" is UTC+00:00 in winter, UTC+01:00
 * in summer); show the numeric offset actually in effect.
 */
function formatUtcOffset(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const dt = DateTime.now().setZone(value);
  return dt.isValid ? `UTC${dt.toFormat("ZZ")}` : "";
}

function formatPosition(value: unknown, round: number | undefined): string {
  const position = value as { latitude?: number; longitude?: number } | undefined;
  if (typeof position?.latitude !== "number" || typeof position?.longitude !== "number") return "";
  const decimals = round ?? 4;
  const lat = Math.abs(position.latitude).toFixed(decimals);
  const lon = Math.abs(position.longitude).toFixed(decimals);
  const latHemisphere = position.latitude >= 0 ? "N" : "S";
  const lonHemisphere = position.longitude >= 0 ? "E" : "W";
  return `${lat}°${latHemisphere} ${lon}°${lonHemisphere}`;
}

/** Applies a named `format=` formatter to a resolved binding value. */
export function applyFormat(
  name: string,
  value: unknown,
  context: TemplateContext,
  round: number | undefined,
): string {
  switch (name) {
    case "local_time":
      return formatLocalTime(value, context);
    case "day_mon":
      return formatDayMonth(value, context);
    case "local_datetime_short":
      return formatLocalDatetimeShort(value, context);
    case "utc_offset":
      return formatUtcOffset(value);
    case "position":
      return formatPosition(value, round);
    default:
      throw new Error(`unknown format "${name}"`);
  }
}
