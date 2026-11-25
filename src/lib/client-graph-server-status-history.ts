"use client";

/** Personal, append-only status observations. The browser records verified
 * graph-server health independently of the read-only View and FCT pipelines.
 * Nothing is stored in the public seed graph and no proxy domain API is added.
 * The endpoint URI, state, UTC time, and optional HTTP status are the ONLY
 * observation fields; never persist diagnostics, headers, cookies or tokens. */
import { personalContext, selectPersonal, updatePersonal, type PersonalContext } from "@/lib/client-personal-sparql";
import { validGraphServerUrl } from "@/lib/graph-server-directory";
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet } from "@/lib/maestro-storage";
import { graphServerStatusGraph } from "@/lib/graph-context";
import type { EndpointStatus } from "@/canvas/top/appbar";

export const GRAPH_SERVER_STATUS_VOCAB = "gttp://ggg.maestro.ecosys/ns/ui#" as const;
export const GRAPH_SERVER_STATUS_OBSERVATION = `${GRAPH_SERVER_STATUS_VOCAB}GraphServerHealthObservation`;
export const GRAPH_SERVER_STATUS_ENDPOINT = `${GRAPH_SERVER_STATUS_VOCAB}observedEndpoint`;
export const GRAPH_SERVER_STATUS_NO_HTTP = `${GRAPH_SERVER_STATUS_VOCAB}noHttpResponse`;
export const GRAPH_SERVER_STATUS_STATE = `${GRAPH_SERVER_STATUS_VOCAB}healthState`;
export const GRAPH_SERVER_STATUS_SAVED = "maestro:graph-server-status-saved";
export const GRAPH_SERVER_STATUS_CODE = `${GRAPH_SERVER_STATUS_VOCAB}httpStatus`;
const DCT_CREATED = "http://purl.org/dc/terms/created";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_CLASS = "http://www.w3.org/2000/01/rdf-schema#Class";
const RDF_PROPERTY = "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property";
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
const iri = (value: string) => `<${value}>`;
const typed = (value: string, type: string) => `${JSON.stringify(value)}^^${iri(type)}`;
const STATUS = ["ok", "degraded", "server-error", "http-error", "timeout", "unreachable", "probe-error"] as const;
export type GraphServerStatusValue = 0 | 1 | 2 | 3;
export type GraphServerStatusObservation = { endpoint: string; created: string; state: EndpointStatus["state"]; status: number | null };
export type GraphServerStatusRange = { from?: string; to?: string };

type PendingObservation = GraphServerStatusObservation & {id:string};
const latestSaved = new Map<string, { fingerprint: string; at: number }>();
let writeQueue: Promise<void> = Promise.resolve();
const outboxKey = (ctx:PersonalContext) => `maestro-health-outbox:${JSON.stringify([ctx.base,ctx.addr,ctx.session.username??ctx.session.userName??""])}`;
const pending = (key:string):PendingObservation[] => {
  try { const rows = JSON.parse(maestroStorageGet(key) ?? "[]"); return Array.isArray(rows) ? rows.filter(row=>row && validGraphServerUrl(row.endpoint)===row.endpoint && STATUS.includes(row.state) && /^[a-f0-9-]{36}$/i.test(row.id) && Number.isFinite(Date.parse(row.created)) && (row.status===null || Number.isInteger(row.status) && row.status>=100 && row.status<=599)) : []; } catch {return [];}
};
async function flush(ctx:PersonalContext,key:string) {
  const queued=pending(key);
  if(!queued.length)return;
  if ((await personalContext()).session !== ctx.session) throw new Error("Personal session changed before health observation write.");
  const graph=graphServerStatusGraph(ctx.base);
  const batch=queued.slice(0,100);
  await updatePersonal(`INSERT DATA { GRAPH ${iri(graph)} {
    ${iri(GRAPH_SERVER_STATUS_OBSERVATION)} ${iri(RDF_TYPE)} ${iri(RDFS_CLASS)} .
    ${iri(GRAPH_SERVER_STATUS_ENDPOINT)} ${iri(RDF_TYPE)} ${iri(RDF_PROPERTY)} .
    ${iri(GRAPH_SERVER_STATUS_STATE)} ${iri(RDF_TYPE)} ${iri(RDF_PROPERTY)} .
    ${iri(GRAPH_SERVER_STATUS_CODE)} ${iri(RDF_TYPE)} ${iri(RDF_PROPERTY)} .
    ${iri(GRAPH_SERVER_STATUS_NO_HTTP)} ${iri(RDF_TYPE)} ${iri(RDF_PROPERTY)} .
    ${batch.map(row=>`${iri(`${graph}#observation-${row.id}`)} ${iri(RDF_TYPE)} ${iri(GRAPH_SERVER_STATUS_OBSERVATION)} ;
      ${iri(GRAPH_SERVER_STATUS_ENDPOINT)} ${iri(row.endpoint)} ;
      ${iri(GRAPH_SERVER_STATUS_STATE)} ${JSON.stringify(row.state)} ;
      ${iri(DCT_CREATED)} ${typed(row.created,XSD_DATE_TIME)} ;
      ${row.status===null?`${iri(GRAPH_SERVER_STATUS_NO_HTTP)} true`:`${iri(GRAPH_SERVER_STATUS_CODE)} ${typed(String(row.status),XSD_INTEGER)}`} .`).join("\n")}
  } }`,undefined,undefined,"client-graph-server-status-history:operation",ctx.session);
  const written=new Set(batch.map(row=>row.id));
  maestroStorageSet(key,JSON.stringify(pending(key).filter(row=>!written.has(row.id))));
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(GRAPH_SERVER_STATUS_SAVED,{detail:{account:key}}));
}
function enqueue(work:()=>Promise<void>){const result=writeQueue.then(work);writeQueue=result.catch(()=>{});return result;}
/** A confirmed transition is captured immediately. Failed writes retain the
 * original event timestamp and subject for a later authenticated retry. */
export async function recordGraphServerStatusObservation(endpoint:string,status:EndpointStatus,observedAt=Date.now()):Promise<void>{
  const url=validGraphServerUrl(endpoint);
  if(!url || !STATUS.includes(status.state))return;
  const ctx=await personalContext();
  await initializeMaestroStorage();
  const key=outboxKey(ctx), fingerprint=`${status.state}|${status.status??"?"}`, dedup=JSON.stringify([key,url]);
  const previous=latestSaved.get(dedup);
  if(previous?.fingerprint===fingerprint && observedAt-previous.at<3600000)return;
  latestSaved.set(dedup,{fingerprint,at:observedAt});
  const row:PendingObservation={id:crypto.randomUUID(),endpoint:url,created:new Date(observedAt).toISOString(),state:status.state,status:status.status};
  // Queue locally before attempting the personal graph write; no credential or query text is stored.
  maestroStorageSet(key,JSON.stringify([...pending(key),row]));
  return enqueue(()=>flush(ctx,key));
}
let recoveryPending=false;
export async function retryGraphServerStatusObservations():Promise<void>{
  if(recoveryPending)return;
  recoveryPending=true;
  try {const ctx=await personalContext();await initializeMaestroStorage();const key=outboxKey(ctx);await enqueue(()=>flush(ctx,key));}
  finally{recoveryPending=false;}
}

/** Inclusive FCT date bounds; no fabricated date filter for Everywhere. */
export function graphStatusRangeFromFct(queryXml: string): GraphServerStatusRange {
  if (!queryXml || typeof DOMParser === "undefined") return {};
  const doc = new DOMParser().parseFromString(queryXml, "application/xml");
  if (doc.querySelector("parsererror")) return {};
  const range: GraphServerStatusRange = {};
  for (const value of Array.from(doc.getElementsByTagName("*"))) {
    if (value.localName !== "value") continue;
    const iriValue = value.parentElement?.getAttribute("iri") ?? "";
    if (!/(?:created|observedAt|date|timestamp|time)$/i.test(iriValue)) continue;
    const start = value.getAttribute("rangeStart") ?? "";
    const end = value.getAttribute("rangeEnd") ?? "";
    const constant = value.textContent?.trim() ?? "";
    if (/^\d{4}-\d\d-\d\d/.test(start)) range.from = start.slice(0, 10);
    if (/^\d{4}-\d\d-\d\d/.test(end)) range.to = end.slice(0, 10);
    if (!start && !end && /^\d{4}-\d\d-\d\d/.test(constant)) range.from = range.to = constant.slice(0, 10);
  }
  return range;
}

export async function readGraphServerStatusHistories(range: GraphServerStatusRange = {}, signal?: AbortSignal): Promise<GraphServerStatusObservation[]> {
  const ctx = await personalContext();
  const graph = graphServerStatusGraph(ctx.base);
  const valid = (value?: string) => value && /^\d{4}-\d\d-\d\d$/.test(value) ? value : "";
  const from = valid(range.from), to = valid(range.to);
  if (from && to && from > to) return [];
  const dateFilter = [from ? `?at >= ${typed(`${from}T00:00:00Z`, XSD_DATE_TIME)}` : "",
    to ? `?at < ${typed(new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString(), XSD_DATE_TIME)}` : ""].filter(Boolean).join(" && ");
  const rows: GraphServerStatusObservation[] = [];
  // Pagination is mandatory for all-time status retrieval. Fail closed rather
  // than calling a truncated 20k-event stream a complete history.
  const pageSize = 500;
  for (let offset = 0; offset <= 20000; offset += pageSize) {
    if (signal?.aborted) throw signal.reason;
    const batch = await selectPersonal(`SELECT ?endpoint ?at ?state ?code WHERE { GRAPH ${iri(graph)} {
      ?observation ${iri(RDF_TYPE)} ${iri(GRAPH_SERVER_STATUS_OBSERVATION)} ;
        ${iri(GRAPH_SERVER_STATUS_ENDPOINT)} ?endpoint ;
        ${iri(GRAPH_SERVER_STATUS_STATE)} ?state ;
        ${iri(DCT_CREATED)} ?at .
      OPTIONAL { ?observation ${iri(GRAPH_SERVER_STATUS_CODE)} ?code }
      ${dateFilter ? `FILTER(${dateFilter})` : ""}
    } } ORDER BY ?at ?observation LIMIT ${pageSize} OFFSET ${offset}`, ctx, signal,
    "urn:maestro:component:graph-server-status-history");
    for (const row of batch) {
      const url = validGraphServerUrl(row.endpoint?.value ?? "");
      if (!url) continue;
      const state = row.state?.value ?? "";
      const at = row.at?.value ?? "";
      if (!STATUS.includes(state as typeof STATUS[number]) || !/^\d{4}-\d\d-\d\dT/.test(at)) continue;
      const code = row.code?.value && /^\d{3}$/.test(row.code.value) ? Number(row.code.value) : null;
      rows.push({ endpoint: url, created: at, state: state as EndpointStatus["state"], status: code });
    }
    if (batch.length < pageSize) return rows;
  }
  throw new Error("Graph-server status history exceeds the 20,000-event safety limit. Narrow the live query's date range.");
}

export async function readGraphServerStatusHistory(endpoint: string, range: GraphServerStatusRange = {}, signal?: AbortSignal) {
  const url = validGraphServerUrl(endpoint);
  if (!url) throw new Error("Graph server history requires a valid SPARQL endpoint URL.");
  return (await readGraphServerStatusHistories(range, signal)).filter(row => row.endpoint === url);
}

/** Worst observed status wins a day. An unsampled day is No data, not Healthy. */
export function graphStatusDaily(rows: readonly GraphServerStatusObservation[]) {
  const days = new Map<string, GraphServerStatusValue>();
  for (const row of rows) {
    const value: GraphServerStatusValue = row.state === "ok" && row.status === 200 ? 3
      : row.state === "degraded" || row.state === "probe-error" || row.status === null || (row.status >= 400 && row.status < 500) ? 2 : row.status >= 500 ? 1 : 0;
    const date = row.created.slice(0, 10);
    const prior = days.get(date);
    if (prior === undefined || (value !== 0 && (prior === 0 || value < prior))) days.set(date, value);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}
