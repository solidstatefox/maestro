/** Per-widget upstream query timeouts; 0 inherits the query/server default. */
import { maestroStorageGet, maestroStorageSet } from "./maestro-storage";
import { XMLParser } from "fast-xml-parser";
import { parseFctViewTimeout } from "./fct-view-types";

export const MAESTRO_TIMEOUT_CATEGORIES = [
  { key: "results", label: "Results" },
  { key: "counts", label: "Results and facet counts" },
  { key: "alphabet", label: "Alphabet" },
  { key: "status", label: "Status" },
  { key: "categories", label: "Categories" },
  { key: "properties", label: "Properties" },
  { key: "roles", label: "Roles" },
  { key: "kinds", label: "Configure Kinds" },
  { key: "personal", label: "Personal facets" },
  { key: "graphs", label: "Graphs" },
  { key: "groups", label: "Groups" },
  { key: "record", label: "Record DESCRIBE and enrichment" },
  { key: "policies", label: "Record policy queries" },
  { key: "providerPolicies", label: "View > Providers > Policies" },
  { key: "providerFormats", label: "View > Providers > Formats" },
  { key: "providerFacets", label: "View > Providers > Facets" },
  { key: "providerTranscoders", label: "View > Providers > Transcoders" },
  { key: "providerCurators", label: "View > Providers > Curators" },
  { key: "other", label: "Breadcrumb previews and other queries" },
] as const;
export type MaestroTimeoutCategory = (typeof MAESTRO_TIMEOUT_CATEGORIES)[number]["key"];
export type MaestroWidgetTimeouts = Record<MaestroTimeoutCategory, number>;
const KEY = "maestro-widget-query-timeouts-v2";
const EMPTY: MaestroWidgetTimeouts = {
  results: 0, counts: 0, alphabet: 0, status: 60, categories: 0, properties: 0,
  roles: 0, kinds: 0, personal: 0, graphs: 0, groups: 0, record: 0,
  policies: 0, providerPolicies: 0, providerFormats: 0, providerFacets: 0, providerTranscoders: 0, providerCurators: 0, other: 0,
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
  if (s.includes("provider-policies")) return "providerPolicies";
  if (s.includes("provider-formats")) return "providerFormats";
  if (s.includes("provider-facet-widgets")) return "providerFacets";
  if (s.includes("provider-transcoders")) return "providerTranscoders";
  if (s.includes("provider-curators")) return "providerCurators";
  if (s.includes("alphabet")) return "alphabet";
  if (s.includes("status-facet") || s.includes("statuses-facet")) return "status";
  if (s.includes("configure:kinds") || s.includes("kindavailability")) return "kinds";
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
// Use the same namespace and attribute handling as the FCT compiler. A
// textual search could mistake a comment or an escaped literal for a view.
const timeoutParser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false,
  attributeNamePrefix: "@_", textNodeName: "#text", parseTagValue: false, trimValues: false });
function findView(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [name, children] of Object.entries(value)) {
    if (name.startsWith("@_") || name === "#text") continue;
    for (const child of Array.isArray(children) ? children : [children]) {
      if (name === "view") return child && typeof child === "object" ? child as Record<string, unknown> : {};
      const found = findView(child);
      if (found) return found;
    }
  }
  return undefined;
}

/** Resolve once, before dispatch and cache-key calculation. Only wire XML
 * is rewritten. Explicit view timeouts outrank the Sheet, even Set all. */
export function resolveFctRequestTimeout(source: string, body: string): { body: string; timeoutMs?: number } {
  try {
    const json = body.trimStart().startsWith("{") ? JSON.parse(body) as Record<string, unknown> : undefined;
    const xml = json ? json.queryXml : body;
    if (typeof xml !== "string") return { body };
    const document = timeoutParser.parse(xml) as Record<string, unknown>;
    if (!document.query || typeof document.query !== "object") return { body };
    const raw = findView(document.query)?.["@_timeout"];
    const explicit = parseFctViewTimeout(raw === undefined ? undefined : String(raw));
    if (explicit !== undefined) return { body, timeoutMs: explicit };
    const timeoutMs = configuredTimeoutMs(source);
    if (!timeoutMs) return { body };
    const nextXml = xml.replace(/<query\b([^>]*?)>/i, (_whole, attrs: string) => {
      const next = /\btimeout\s*=\s*["'][^"']*["']/i.test(attrs)
        ? attrs.replace(/\btimeout\s*=\s*["'][^"']*["']/i, `timeout="${timeoutMs}"`)
        : `${attrs} timeout="${timeoutMs}"`;
      return `<query${next}>`;
    });
    return { body: json ? JSON.stringify({ ...json, queryXml: nextXml }) : nextXml, timeoutMs };
  } catch {
    // Leave malformed XML/JSON and invalid explicit timeouts intact so the
    // FCT route can report the actual validation error, not mask it with Sheet.
    return { body };
  }
}
