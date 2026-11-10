"use client";

/** Shared static colors for the Configure pane's green scheme. */
export const CONFIGURE_LIST_BACKGROUND_COLOR = "#EFF6FC";
export const CONFIGURE_HEADER_BACKGROUND_COLOR = "#6BA8E0"//"#0078D4";
export const CONFIGURE_HEADER_BORDER_COLOR = "#005A9E";


export type FacetAddCounts = {
  property: Record<string, number>;
  "property-in": Record<string, number>;
};

export type FacetAutofillCandidates = {
  property: string[];
  "property-in": string[];
};

export const FACET_ADD_COUNTS_STORAGE_KEY = "maestro:facet-add-counts:v1";
export const FACET_AUTOFILL_STORAGE_KEY = "maestro:facet-autofill:v1";
export const AUTO_CONFIGURED_FACETS_STORAGE_KEY = "maestro:auto-configured-facets:v1";
/** Auto-configure registry: the live query's exclude boolean for each facet URI. */
export const FACET_EXCLUDE_STORAGE_KEY = "maestro:facet-exclude:v1";

export type FacetExcludeRegistry = {
  property: Record<string, boolean>;
  "property-in": Record<string, boolean>;
};

export function readFacetExcludeRegistry(): FacetExcludeRegistry {
  const empty: FacetExcludeRegistry = { property: {}, "property-in": {} };
  try {
    const raw = window.localStorage.getItem(FACET_EXCLUDE_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetExcludeRegistry>;
    const clean = (value: unknown): Record<string, boolean> =>
      value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, flag]) => typeof flag === "boolean")) as Record<string, boolean>
        : {};
    return { property: clean(parsed.property), "property-in": clean(parsed["property-in"]) };
  } catch {
    return empty;
  }
}

/** Record the exclude boolean read from the live query's node for this facet. */
export function recordFacetExclude(kind: "property" | "property-in", uri: string, excluded: boolean) {
  try {
    const registry = readFacetExcludeRegistry();
    if (registry[kind][uri] === excluded) return;
    registry[kind][uri] = excluded;
    window.localStorage.setItem(FACET_EXCLUDE_STORAGE_KEY, JSON.stringify(registry));
  } catch (error) {
    // Browsing and filtering must continue when localStorage is unavailable.
    console.error("[Maestro Auto-configure] Could not persist facet exclude flag.", error);
  }
}

export function isFacetExcludeRecorded(kind: "property" | "property-in", uri: string): boolean {
  return readFacetExcludeRegistry()[kind][uri] === true;
}

export type AutoConfiguredFacetKey = string;

export function readAutoConfiguredFacetKeys(): AutoConfiguredFacetKey[] {
  try {
    const raw = window.localStorage.getItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function readFacetAddCounts(): FacetAddCounts {
  const empty: FacetAddCounts = { property: {}, "property-in": {} };
  try {
    const raw = window.localStorage.getItem(FACET_ADD_COUNTS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAddCounts>;
    return {
      property: parsed.property && typeof parsed.property === "object" ? parsed.property : {},
      "property-in": parsed["property-in"] && typeof parsed["property-in"] === "object" ? parsed["property-in"] : {},
    };
  } catch {
    return empty;
  }
}

export function recordFacetAddition(kind: "property" | "property-in", uri: string) {
  try {
    const counts = readFacetAddCounts();
    counts[kind][uri] = (counts[kind][uri] ?? 0) + 1;
    window.localStorage.setItem(FACET_ADD_COUNTS_STORAGE_KEY, JSON.stringify(counts));
  } catch (error) {
    // Browsing and filtering must continue when localStorage is unavailable.
    console.error("[Maestro Auto-configure] Could not persist facet addition count.", error);
  }
}

export function readFacetAutofillCandidates(): FacetAutofillCandidates {
  const empty: FacetAutofillCandidates = { property: [], "property-in": [] };
  try {
    const raw = window.localStorage.getItem(FACET_AUTOFILL_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAutofillCandidates>;
    return {
      property: Array.isArray(parsed.property) ? parsed.property.filter((uri): uri is string => typeof uri === "string") : [],
      "property-in": Array.isArray(parsed["property-in"]) ? parsed["property-in"].filter((uri): uri is string => typeof uri === "string") : [],
    };
  } catch {
    return empty;
  }
}

export function replaceFacetAutofillCandidates(kind: "property" | "property-in", uris: string[]) {
  const nextUris = Array.from(new Set(uris));
  try {
    const candidates = readFacetAutofillCandidates();
    // Avoid storage churn when the current-scope candidate list did not change.
    const previousUris = candidates[kind];
    if (previousUris.length !== nextUris.length || previousUris.some((uri, index) => uri !== nextUris[index])) {
      candidates[kind] = nextUris;
      window.localStorage.setItem(FACET_AUTOFILL_STORAGE_KEY, JSON.stringify(candidates));
    }
    return nextUris;
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
    return nextUris;
  }
}


/** Apply pending auto-configure suggestions in the active FCT path. */
export function executeAutoConfigure({
  facetAutofillCandidates,
  selectedProperties,
  selectedRoles,
  getPropertyPath,
  handlePropertyCheckboxChange,
  handleRoleCheckboxChange,
  setAutoConfiguredFacet,
  setNodeAttribute,
}: {
  facetAutofillCandidates: FacetAutofillCandidates;
  selectedProperties: ReadonlySet<string>;
  selectedRoles: ReadonlySet<string>;
  getPropertyPath: () => Array<{ id: string }>;
  handlePropertyCheckboxChange: (uri: string, checked: boolean, trackUsage?: boolean) => void;
  handleRoleCheckboxChange: (uri: string, checked: boolean, trackUsage?: boolean) => void;
  setAutoConfiguredFacet: (kind: "property" | "property-in", uri: string, enabled: boolean) => void;
  setNodeAttribute: (id: string, name: string, value: string) => void;
}): void {
  const activePath = getPropertyPath();
  const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
  for (const uri of facetAutofillCandidates.property) {
    if (uri === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" || selectedProperties.has(uri)) continue;
    const excluded = isFacetExcludeRecorded("property", uri);
    handlePropertyCheckboxChange(uri, true, false);
    setAutoConfiguredFacet("property", uri, true);
    if (excluded) setNodeAttribute(`property-filter-${encodeURIComponent(uri)}`, "exclude", "yes");
  }
  for (const uri of facetAutofillCandidates["property-in"]) {
    if (selectedRoles.has(uri)) continue;
    const excluded = isFacetExcludeRecorded("property-in", uri);
    handleRoleCheckboxChange(uri, true, false);
    setAutoConfiguredFacet("property-in", uri, true);
    if (excluded) setNodeAttribute(`role-filter-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, "exclude", "yes");
  }
}
