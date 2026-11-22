"use client";

import { maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
import type { EndpointOption } from "@/canvas/top/appbar";

/** Browser-owned directory: each group owns its servers. Shared is never
 * replaced by a courtesy seed-list refresh, login, or logout. */
export const GRAPH_SERVER_DIRECTORY_KEY = "maestro-graph-server-directory-v1";
export type GraphServerDirectory = {
  courtesyDigest: string;
  groups: Record<string, EndpointOption[]>;
};

const EMPTY: GraphServerDirectory = { courtesyDigest: "", groups: { Shared: [] } };
export function validGraphServerUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (!(["http:", "https:"].includes(url.protocol)) || !url.hostname || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

function sharedEndpoint(url: string): EndpointOption {
  return { id: `shared:${encodeURIComponent(url)}`, label: url, url, group: "Shared" };
}
export function parseGraphServerDirectory(raw: string | null): GraphServerDirectory {
  if (!raw) return { courtesyDigest: "", groups: { Shared: [] } };
  try {
    const source = JSON.parse(raw) as Partial<GraphServerDirectory>;
    if (!source || typeof source !== "object" || !source.groups || typeof source.groups !== "object") return { ...EMPTY, groups: { Shared: [] } };
    const groups: Record<string, EndpointOption[]> = { Shared: [] };
    for (const [group, items] of Object.entries(source.groups)) {
      if (!group || group === "__proto__" || group === "constructor" || !Array.isArray(items) || group.length > 128) continue;
      const seen = new Set<string>();
      groups[group] = [];
      for (const item of items.slice(0, 500)) {
        if (!item || typeof item !== "object" || typeof item.url !== "string") continue;
        const url = validGraphServerUrl(item.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        if (group === "Shared") groups[group].push(sharedEndpoint(url));
        else groups[group].push({ id: typeof item.id === "string" && item.id ? item.id : `courtesy:${encodeURIComponent(url)}`,
          label: typeof item.label === "string" && item.label ? item.label : url, url, group,
          schemeInferred: item.schemeInferred === true });
      }
    }
    return { courtesyDigest: typeof source.courtesyDigest === "string" ? source.courtesyDigest : "", groups };
  } catch { return { courtesyDigest: "", groups: { Shared: [] } }; }
}
export const readGraphServerDirectory = (): GraphServerDirectory => parseGraphServerDirectory(maestroStorageGet(GRAPH_SERVER_DIRECTORY_KEY));
function save(directory: GraphServerDirectory): GraphServerDirectory {
  maestroStorageSet(GRAPH_SERVER_DIRECTORY_KEY, JSON.stringify(directory));
  return directory;
}
/** Collected address is independent of the logged-in session and courtesy feed. */
export function collectSharedGraphServer(url: string): GraphServerDirectory {
  const normalized = validGraphServerUrl(url);
  const directory = readGraphServerDirectory();
  if (!normalized || directory.groups.Shared.some((entry) => entry.url === normalized)) return directory;
  return save({ ...directory, groups: { ...directory.groups,
    Shared: [...directory.groups.Shared, sharedEndpoint(normalized)] } });
}
/** Replace ONLY the seed-provided groups, retaining every user-collected Shared URL. */
export function replaceCourtesyGraphServers(digest: string, entries: readonly EndpointOption[]): GraphServerDirectory {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid graph-server courtesy-list digest.");
  const previous = readGraphServerDirectory();
  const groups: Record<string, EndpointOption[]> = { Shared: [...previous.groups.Shared] };
  for (const item of entries) {
    const url = validGraphServerUrl(item.url);
    if (!url) continue;
    const group = item.group && item.group !== "Shared" && item.group !== "__proto__" && item.group !== "constructor" ? item.group : "Endpoints";
    (groups[group] ??= []).push({ ...item, url, group });
  }
  return save({ courtesyDigest: digest, groups });
}
export function flattenGraphServerDirectory(directory: GraphServerDirectory): EndpointOption[] {
  const rows: EndpointOption[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const [group, entries] of Object.entries(directory.groups)) for (const entry of entries) {
    const url = validGraphServerUrl(entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const original = group === "Shared" ? sharedEndpoint(url) : { ...entry, group };
    let id = original.id;
    for (let suffix = 2; ids.has(id); suffix++) id = `${original.id}-${suffix}`;
    ids.add(id);
    rows.push({ ...original, id });
  }
  return rows;
}
