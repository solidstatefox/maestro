/** Per-widget upstream query timeouts; 0 inherits the query/server default. */
import { maestroStorageGet, maestroStorageSet } from "./maestro-storage";

export const MAESTRO_TIMEOUT_CATEGORIES = [
  { key: "results", label: "Results" },
  { key: "counts", label: "Results and facet counts" },
  { key: "alphabet", label: "Alphabet" },
  { key: "categories", label: "Categories" },
  { key: "properties", label: "Properties" },
  { key: "roles", label: "Roles" },
  { key: "personal", label: "Personal facets" },
  { key: "graphs", label: "Graphs" },
  { key: "groups", label: "Groups" },
  { key: "record", label: "Record DESCRIBE and enrichment" },
  { key: "policies", label: "Record policy queries" },
  { key: "other", label: "Breadcrumb previews and other queries" },
] as const;
export type MaestroTimeoutCategory = (typeof MAESTRO_TIMEOUT_CATEGORIES)[number]["key"];
export type MaestroWidgetTimeouts = Record<MaestroTimeoutCategory, number>;
const KEY = "maestro-widget-query-timeouts-v1";
const EMPTY: MaestroWidgetTimeouts = {
  results: 0, counts: 0, alphabet: 0, categories: 0, properties: 0,
  roles: 0, personal: 0, graphs: 0, groups: 0, record: 0,
  policies: 0, other: 0,
};
let active: MaestroWidgetTimeouts = { ...EMPTY };
export function readMaestroWidgetTimeouts(): MaestroWidgetTimeouts {
  try {
    const parsed = JSON.parse(maestroStorageGet(KEY) || "{}") as Record<string, unknown>;
    active = { ...EMPTY };
    for (const { key } of MAESTRO_TIMEOUT_CATEGORIES) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 120) active[key] = value;
    }
  } catch { active = { ...EMPTY }; }
  return { ...active };
}
export function writeMaestroWidgetTimeouts(values: MaestroWidgetTimeouts): void {
  active = { ...values };
  maestroStorageSet(KEY, JSON.stringify(active));
}
export function timeoutCategoryForSource(source: string): MaestroTimeoutCategory {
  const s = source.toLowerCase();
  if (s.includes("alphabet")) return "alphabet";
  if (s.includes("count") || s.includes("distinct")) return "counts";
  if (s.includes("record-") || s.includes("recorddescription") || s.includes("results-enrichment")) {
    return /policy|template|shacl|xslt/.test(s) ? "policies" : "record";
  }
  if (/policy|xslt|shacl/.test(s)) return "policies";
  if (/personal/.test(s)) return "personal";
  if (/group/.test(s)) return "groups";
  if (/graph/.test(s)) return "graphs";
  if (/categor|classes|hierarchy/.test(s)) return "categories";
  if (/role|properties-in/.test(s)) return "roles";
  if (/propert/.test(s)) return "properties";
  if (/result|bookmark-history-query/.test(s)) return "results";
  return "other";
}
export function configuredTimeoutMs(source: string): number {
  return (active[timeoutCategoryForSource(source)] ?? 0) * 1000;
}
/** Modify only the transmitted XML, not the live query. */
export function applyFctQueryTimeout(source: string, body: string): string {
  const timeout = configuredTimeoutMs(source);
  if (!timeout || !/<query\b/i.test(body)) return body;
  return body.replace(/<query\b([^>]*?)>/i, (_whole, attrs: string) => {
    const next = /\btimeout\s*=\s*["'][^"']*["']/i.test(attrs)
      ? attrs.replace(/\btimeout\s*=\s*["'][^"']*["']/i, `timeout="${timeout}"`)
      : `${attrs} timeout="${timeout}"`;
    return `<query${next}>`;
  });
}
