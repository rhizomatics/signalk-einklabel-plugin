import { DateTime } from 'luxon';
import { evaluate } from 'mathjs';
import { TemplateContext } from './types';

/**
 * Matches the shape of a category entry from SignalK's `/signalk/v1/unitpreferences/active`
 * (or `/presets/<name>`) endpoint - see https://demo.signalk.org/documentation/Guides/Unit_Preferences.html.
 * `formula`/`symbol` are only present inline when the target unit isn't the base unit; when
 * absent here, the caller assembling the template context is expected to have already resolved
 * them from `/signalk/v1/unitpreferences/definitions` (or left them out because no conversion
 * is needed, i.e. targetUnit === baseUnit).
 */
interface UnitPreference {
  targetUnit?: string;
  symbol?: string;
  formula?: string;
  displayFormat?: string;
}

function unitPreference(context: TemplateContext, category: string): UnitPreference {
  const resources = context.resources as Record<string, unknown> | undefined;
  const unitPreferences = resources?.unitPreferences as Record<string, UnitPreference> | undefined;
  return unitPreferences?.[category] ?? {};
}

/** Converts a base-SI value (always what SignalK paths/APIs deliver) to the preferred display unit and formats it with the unit's symbol, e.g. 3.42 -> "11.2ft". */
function formatUnitValue(value: unknown, pref: UnitPreference, round: number | undefined): string {
  if (typeof value !== 'number') return '';
  const converted = pref.formula ? Number(evaluate(pref.formula, { value })) : value;
  const decimals = round ?? (pref.displayFormat?.includes('.') ? pref.displayFormat.split('.')[1].length : 0);
  const symbol = pref.symbol ?? pref.targetUnit ?? '';
  return `${converted.toFixed(decimals)}${symbol}`;
}

/**
 * Shows the explicit IANA zone name rather than an abbreviation (e.g. "BST") - UK tide tables are
 * officially published in GMT, so the basis for the displayed time must be unambiguous rather than
 * just locally styled. Always reads the local vessel's timezone (`signalk.self`), regardless of which
 * vessel's value is being formatted - the display's own clock/locale is what matters.
 */
function formatLocalTime(value: unknown, context: TemplateContext): string {
  if (typeof value !== 'string') return '';
  const signalk = context.signalk as Record<string, unknown> | undefined;
  const self = signalk?.self as Record<string, unknown> | undefined;
  const environment = self?.environment as { time?: { timezoneRegion?: string } } | undefined;
  const zone = environment?.time?.timezoneRegion || 'utc';
  const dt = DateTime.fromISO(value, { zone: 'utc' }).setZone(zone);
  return dt.isValid ? dt.toFormat('HH:mm') : '';
}

/**
 * IANA region names are ambiguous about DST (e.g. "Europe/London" is UTC+00:00 in winter, UTC+01:00
 * in summer); show the numeric offset actually in effect.
 */
function formatUtcOffset(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const dt = DateTime.now().setZone(value);
  return dt.isValid ? `UTC${dt.toFormat('ZZ')}` : '';
}

function formatPosition(value: unknown, round: number | undefined): string {
  const position = value as { latitude?: number; longitude?: number } | undefined;
  if (typeof position?.latitude !== 'number' || typeof position?.longitude !== 'number') return '';
  const decimals = round ?? 4;
  const lat = Math.abs(position.latitude).toFixed(decimals);
  const lon = Math.abs(position.longitude).toFixed(decimals);
  const latHemisphere = position.latitude >= 0 ? 'N' : 'S';
  const lonHemisphere = position.longitude >= 0 ? 'E' : 'W';
  return `${lat}°${latHemisphere} ${lon}°${lonHemisphere}`;
}

/** Applies a named `format=` formatter to a resolved binding value. */
export function applyFormat(name: string, value: unknown, context: TemplateContext, round: number | undefined): string {
  switch (name) {
    case 'speed':
      return formatUnitValue(value, unitPreference(context, 'speed'), round);
    case 'depth':
      return formatUnitValue(value, unitPreference(context, 'length'), round);
    case 'temperature':
      return formatUnitValue(value, unitPreference(context, 'temperature'), round);
    case 'local_time':
      return formatLocalTime(value, context);
    case 'utc_offset':
      return formatUtcOffset(value);
    case 'position':
      return formatPosition(value, round);
    default:
      throw new Error(`unknown format "${name}"`);
  }
}
