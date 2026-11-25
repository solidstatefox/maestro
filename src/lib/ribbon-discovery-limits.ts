import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
export const RIBBON_DISCOVERY_DEFAULTS = { perspectives: 1000, analysis: 50 } as const;
export type RibbonDiscoveryLimits = { perspectives: number; analysis: number };
export const RIBBON_DISCOVERY_OPTIONS = [25, 50, 100, 250, 500, 1000, 2000, 5000] as const;
const KEY="maestro-ribbon-discovery-limits";
export function ribbonDiscoveryLimit(key:keyof RibbonDiscoveryLimits,value:number):number {
  return RIBBON_DISCOVERY_OPTIONS.some(option=>option===value) ? value : RIBBON_DISCOVERY_DEFAULTS[key];
}
export function readRibbonDiscoveryLimits():RibbonDiscoveryLimits {
  try { const parsed=JSON.parse(maestroStorageGet(KEY)||"{}") as Partial<RibbonDiscoveryLimits>;
    return {perspectives:ribbonDiscoveryLimit("perspectives",Number(parsed.perspectives)),analysis:ribbonDiscoveryLimit("analysis",Number(parsed.analysis))};
  } catch { return {...RIBBON_DISCOVERY_DEFAULTS}; }
}
export function writeRibbonDiscoveryLimits(value:RibbonDiscoveryLimits):void {maestroStorageSet(KEY,JSON.stringify(value));}
