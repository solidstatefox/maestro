"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Read-only Record statuses and query-hash facet counts now run against the
 * existing authenticated /sparql gateway. The browser evaluates virtual
 * initial states using the same RDF -> XState adapter as the trusted writer.
 * No synthetic mui:status assertions are inserted into the personal store. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { loadClientStatusMachines } from "@/lib/status-machine-client";
import { STATUS_RDFS, effectiveStatus, machineForTarget } from "@/lib/status-machine-runtime";
import { MUI_HIDDEN, MUI_LAST_LOCATED_AT, MUI_NS, MUI_STATUS, RECORD_STATUSES,
  type RecordStatusName, type StatusFacetName } from "@/lib/personal-status-vocabulary";

const validIri = (uri: string): boolean => uri.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);
const iri = (uri: string): string => { if (!validIri(uri)) throw new Error("Invalid Record URI."); return `<${uri}>`; };
const reverse = Object.fromEntries(Object.entries(RECORD_STATUSES).map(([name, uri]) => [uri, name])) as Record<string, RecordStatusName>;

export type RecordPageProjection = { statuses: Record<string, RecordStatusName[]>; hidden: string[] };
export async function readClientRecordPage(uris: readonly string[], signal?: AbortSignal): Promise<RecordPageProjection> {
  const unique = [...new Set(uris)];
  if (unique.length > 150 || unique.some(uri => !validIri(uri))) throw new Error("Invalid Record status page.");
  if (!unique.length) return { statuses: {}, hidden: [] };
  const ctx = await personalContext();
  const g = iri(`${resolveGraph(GRAPH.STATUS, ctx.base)}`);
  const rows = await selectPersonal(`SELECT ?s ?status WHERE {
    VALUES ?s { ${unique.map(iri).join(" ")} }
    OPTIONAL { GRAPH ${g} { ?s ${iri(MUI_STATUS)} ?status } }
  }`, ctx, signal,"client-status-reads:readClientRecordPage");
  const statuses: Record<string, RecordStatusName[]> = {};
  const assertions = new Map<string, string[]>();
  const hidden = new Set<string>();
  const allowed = new Set(unique);
  for (const row of rows) {
    const resource = row.s?.value ?? "";
    if (!allowed.has(resource)) continue;
    const status = row.status?.value ?? "";
    if (!status) continue;
    const found = assertions.get(resource) ?? [];
    if (!found.includes(status)) found.push(status);
    assertions.set(resource, found);
    if (status === MUI_HIDDEN) hidden.add(resource);
    const name = reverse[status];
    if (name) {
      const projected = statuses[resource] ?? (statuses[resource] = []);
      if (!projected.includes(name)) projected.push(name);
    }
  }
  // Machine definitions are optional until login seeding is complete. Do
  // not turn the entire Record viewer into an error if a remote policy graph
  // has not yet been populated. Writes still fail closed in the Status writer.
  const machines = await loadClientStatusMachines(signal);
  const resourceMachines = machines.filter(machine => machine?.targetClasses instanceof Set && machine.targetClasses.has(`${STATUS_RDFS}Resource`));
  if (resourceMachines.length === 1) {
    const machine = machineForTarget(resourceMachines, `${STATUS_RDFS}Resource`);
    for (const resource of unique) {
      const effective = effectiveStatus(machine, assertions.get(resource) ?? []);
      if (effective[`${MUI_NS}ReadStatus`] === RECORD_STATUSES.Unseen && !(statuses[resource] ?? []).includes("Unseen")) {
        (statuses[resource] ??= []).push("Unseen");
      }
    }
  }
  return { statuses, hidden: [...hidden] };
}

export type StatusFacetProjection = { hasStatuses: boolean; counts: Record<StatusFacetName, number>; sparql: string };
export async function readClientStatusFacetCounts(queryHash: string, signal?: AbortSignal): Promise<StatusFacetProjection> {
  if (!/^sha256:[0-9a-f]{64}$/.test(queryHash)) throw new Error("A valid bookmarked-query hash is required.");
  const ctx = await personalContext();
  const status = iri(`${resolveGraph(GRAPH.STATUS, ctx.base)}`);
  const observation = iri(`${resolveGraph(GRAPH.STATUS, ctx.base)}/${queryHash}`);
  const located = `GRAPH ${observation} { ?c1 ${iri(MUI_LAST_LOCATED_AT)} ?located }`;
  const definitions: Record<"New" | "Seen" | "Starred" | "Hidden", string> = {
    New: `${located} GRAPH ${status} { ?c1 ${iri(MUI_STATUS)} ${iri(RECORD_STATUSES.Unseen)} }`,
    Seen: `${located} GRAPH ${status} { ?c1 ${iri(MUI_STATUS)} ${iri(RECORD_STATUSES.Seen)} }`,
    Starred: `${located} GRAPH ${status} { ?c1 ${iri(MUI_STATUS)} ${iri(RECORD_STATUSES.Starred)} }`,
    Hidden: `${located} GRAPH ${status} { ?c1 ${iri(MUI_STATUS)} ${iri(MUI_HIDDEN)} }`,
  };
  const query = (where: string) => `PREFIX mui: <${MUI_NS}>\nSELECT (COUNT(DISTINCT ?c1) AS ?ct) WHERE { ${where} }`;
  const entries = await Promise.all((Object.entries(definitions) as Array<[keyof typeof definitions, string]>).map(async ([name, where]) => {
    const rows = await selectPersonal(query(where), ctx, signal,"client-status-reads:readClientStatusFacetCounts");
    const value = Number(rows[0]?.ct?.value ?? NaN);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid personal ${name} count.`);
    return [name, value] as const;
  }));
  const counts: Record<StatusFacetName, number> = { New: 0, Unseen: 0, Seen: 0, Starred: 0, Hidden: 0 };
  for (const [name, value] of entries) counts[name] = value;
  counts.Unseen = counts.New; // UI label New refers only to explicitly asserted Unseen.
  return { counts, hasStatuses: counts.New + counts.Seen + counts.Starred + counts.Hidden > 0,
    sparql: query(definitions.New) };
}
