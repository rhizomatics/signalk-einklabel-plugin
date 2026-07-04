import { fetchJson } from "./httpJson";
import { DisplayUnits } from "./render/formatters";

const CATEGORIES_PATH = "/signalk/v1/unitpreferences/categories";
const ACTIVE_PRESET_PATH = "/signalk/v1/unitpreferences/active";
const DEFINITIONS_PATH = "/signalk/v1/unitpreferences/definitions";

interface CategoryMap {
  categoryToBaseUnit?: Record<string, string>;
}

interface ActivePresetCategory {
  targetUnit?: string;
  displayFormat?: string;
}

interface ActivePreset {
  categories?: Record<string, ActivePresetCategory>;
}

interface UnitConversion {
  formula?: string;
  symbol?: string;
}

interface UnitDefinition {
  conversions?: Record<string, UnitConversion>;
}

/**
 * Resolves `category=` bindings (e.g. `category=depth` on a `source=resources` value with no per-path
 * metadata of its own to auto-convert from) against this server's unit-preferences setup.
 *
 * Mirrors signalk-server's own `resolveDisplayUnits` (`src/unitpreferences/resolver.ts`), composed
 * client-side from the three REST endpoints that expose the same underlying data - that resolver isn't
 * exposed via `ServerAPI`, it's an internal signalk-server module, so both the live plugin
 * (repaintScheduler.ts) and the CLI (cli/liveContext.ts) fetch it the same way, over HTTP.
 */
export async function fetchCategoryDisplayUnits(apiUrl: string, categoryNames: Set<string>): Promise<Record<string, DisplayUnits>> {
  if (categoryNames.size === 0) return {};

  const [categoryMap, activePreset, definitions] = await Promise.all([
    fetchJson(`${apiUrl}${CATEGORIES_PATH}`) as Promise<CategoryMap>,
    fetchJson(`${apiUrl}${ACTIVE_PRESET_PATH}`) as Promise<ActivePreset>,
    fetchJson(`${apiUrl}${DEFINITIONS_PATH}`) as Promise<Record<string, UnitDefinition>>,
  ]);

  const result: Record<string, DisplayUnits> = {};
  for (const category of categoryNames) {
    const siUnit = categoryMap.categoryToBaseUnit?.[category];
    if (!siUnit) {
      throw new Error(`unknown unit category "${category}" - not in this server's categoryToBaseUnit map`);
    }
    const presetCategory = activePreset.categories?.[category];
    const targetUnit = presetCategory?.targetUnit ?? siUnit;
    // A conversion entry only exists for a non-identity target unit - e.g. siUnit "m"/targetUnit "m"
    // (the common case for depth on the default metric preset) has no "m"->"m" entry in definitions.
    // Fall back to the target unit's own name as the symbol in that case, rather than showing nothing.
    const conversion = targetUnit !== siUnit ? definitions[siUnit]?.conversions?.[targetUnit] : undefined;
    result[category] = {
      category,
      targetUnit,
      formula: conversion?.formula,
      symbol: conversion?.symbol ?? targetUnit,
      displayFormat: presetCategory?.displayFormat,
    };
  }
  return result;
}
