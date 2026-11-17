"use client";
/** Record-status mutations are browser-owned RDF/XState operations. The host
 * sees only ordinary SPARQL UPDATE bytes and never interprets a Status event. */
import { personalContext, selectPersonal, updatePersonal } from "@/lib/client-personal-sparql";
import { loadClientStatusMachines } from "@/lib/status-machine-client";
import { STATUS_MUI, STATUS_RDFS, machineForTarget, transitionStatusTo } from "@/lib/status-machine-runtime";
import { statusTransitionUpdate } from "@/lib/status-machine-sparql";
import { MUI_LAST_LOCATED_AT, MUI_NS, MUI_STATUS, type RecordStatusName } from "@/lib/personal-status-vocabulary";

const validIri = (value: string): boolean => value.length <= 4096 && /^[a-z][a-z\d+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
function iri(value: string): string {
  if (!validIri(value)) throw new Error("Invalid status IRI.");
  return `<${value}>`;
}
function observationGraph(base: string, hash: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid query hash.");
  return `${base}/status/${hash}`;
}

/** The client reads the graph-defined FSM and applies exactly its permitted edge. */
async function executeTarget(resource: string, intended: string, signal?: AbortSignal, queryXml?: string): Promise<void> {
  const ctx = await personalContext();
  const graph = `${ctx.base}/status`;
  const machines = await loadClientStatusMachines(signal);
  const machine = machineForTarget(machines, `${STATUS_RDFS}Resource`);
  const rows = await selectPersonal(`SELECT DISTINCT ?status WHERE { GRAPH ${iri(graph)} { ${iri(resource)} ${iri(MUI_STATUS)} ?status } }`, ctx, signal);
  const assertions = rows.map(row => row.status?.value ?? "").filter(Boolean);
  const transition = transitionStatusTo(machine, assertions, intended);
  if (!transition) return;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await updatePersonal(statusTransitionUpdate({ machine, transition, assertions, graph, resource, predicate: MUI_STATUS }), signal, queryXml);
}

export async function setClientRecordStatus(hash: string, uri: string, status: RecordStatusName, enabled: boolean, signal?: AbortSignal, queryXml?: string): Promise<void> {
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid query hash.");
  const target = status === "Starred" ? (enabled ? "Starred" : "Unstarred")
    : status === "Seen" ? (enabled ? "Seen" : "Unseen") : "Unseen";
  await executeTarget(uri, `${STATUS_MUI}${target}`, signal, queryXml);
}
export async function setClientHidden(uri: string, enabled: boolean, signal?: AbortSignal, queryXml?: string): Promise<void> {
  await executeTarget(uri, `${STATUS_MUI}${enabled ? "Hidden" : "Visible"}`, signal, queryXml);
}

/** A query-hash graph is a persistent RDF bus. Never synthesize an Unseen
 * assertion just because the resource appeared in Results. */
export async function recordClientLocatedPage(hash: string, uris: readonly string[], executionTime: string, signal?: AbortSignal): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(executionTime) || !Number.isFinite(Date.parse(executionTime)))
    throw new Error("Invalid execution timestamp.");
  const unique = [...new Set(uris)];
  if (unique.length > 150) throw new Error("Located page exceeds 150 resources.");
  if (!unique.length) return;
  const ctx = await personalContext();
  const g = iri(observationGraph(ctx.base, hash));
  const typeDate = iri("http://www.w3.org/2001/XMLSchema#dateTime");
  const locatedPredicate = iri(MUI_LAST_LOCATED_AT);
  const description = "Maestro's per-query resource observation and status bus. Each Results page adds distinct located resources and refreshes lastLocatedAt; Seen, Unseen, and Starred belong to those resource IRIs. Page size and offset do not change this graph's identity.";
  await updatePersonal(`INSERT DATA { GRAPH ${g} { ${g} a ${iri(`${MUI_NS}UtilityGraph`)} ; <http://www.w3.org/2000/01/rdf-schema#label> "query hash graph" ; <http://purl.org/dc/terms/description> ${JSON.stringify(description)} . } }`, signal);
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await updatePersonal(`DELETE { GRAPH ${g} { ?s ${locatedPredicate} ?old } }
    INSERT { GRAPH ${g} { ?s ${locatedPredicate} "${executionTime}"^^${typeDate} } }
    WHERE { VALUES ?s { ${unique.map(iri).join(" ")} } OPTIONAL { GRAPH ${g} { ?s ${locatedPredicate} ?old } } }`, signal);
}
