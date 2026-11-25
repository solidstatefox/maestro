"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Personal graph-server registry: browser-owned RDF/SPARQL, separate from the
 * statically reseeded /graph and from the public courtesy endpoints. */
import { personalContext, selectPersonal, updatePersonal } from "@/lib/client-personal-sparql";
import { readSessionHydration, updateSessionSnapshot } from "@/lib/client-digest-session";
import { personalReadEndpoint } from "@/lib/personal-auth";
import { validGraphServerUrl } from "@/lib/graph-server-directory";
import type { EndpointOption } from "@/canvas/top/appbar";

export const PERSONAL_SERVERS_CHANGED = "maestro:personal-graph-servers-changed";
export const PERSONAL_SERVER_TYPE = "gttp://ggg.maestro.ecosys/ns/ui#PersonalGraphServer";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SCHEMA_ENTRYPOINT = "https://schema.org/EntryPoint";
const SCHEMA_URL = "https://schema.org/url";
const SCHEMA_DESCRIPTION = "https://schema.org/description";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const DCT_PART = "http://purl.org/dc/terms/isPartOf";
const SKOS_COLLECTION = "http://www.w3.org/2004/02/skos/core#Collection";
const iri = (s: string) => `<${s}>`;
const literal = (s: string) => JSON.stringify(s);
export type PersonalGraphServer = { uri: string; label: string; url: string; description: string; isPersonal: boolean; group?: string };
function graphNames(base: string) {
  return { graph: `${resolveGraph(GRAPH.GRAPH_SERVERS, base)}`, group: `${resolveGraph(GRAPH.GRAPH_SERVERS, base)}#personal`, entries: `${resolveGraph(GRAPH.GRAPH_SERVERS, base)}#entries` };
}
export function normalizeGraphServerGroup(raw: string): string {
  const name=raw.trim();
  if (!name || name.length>128 || /[\u0000-\u001f\u007f]/.test(name) || ["__proto__","constructor","prototype"].includes(name))
    throw new Error("Enter a valid graph-server group name (1–128 characters).");
  return name;
}
function groupSubject(base: string, name: string): string {
  const names=graphNames(base);
  return name === "Personal Servers" ? names.group : name === "Graph Servers" ? names.entries : `${names.graph}#group-${encodeURIComponent(name)}`;
}
export async function listPersonalGraphServerGroups(signal?: AbortSignal): Promise<string[]> {
  const ctx=await personalContext();const names=graphNames(ctx.base);
  const rows=await selectPersonal(`SELECT DISTINCT ?group ?label WHERE { GRAPH ${iri(names.graph)} {
    ?group ${iri(RDF_TYPE)} ${iri(SKOS_COLLECTION)} ; ${iri(RDFS_LABEL)} ?label .
  } } ORDER BY ?label`,ctx,signal,"client-personal-graph-servers:groups");
  const groups=new Set(["Graph Servers","Personal Servers"]);
  for(const row of rows){try{groups.add(normalizeGraphServerGroup(row.label?.value??""));}catch{/* invalid label */}}
  return [...groups];
}
function checkUrl(raw: string): string {
  const url = validGraphServerUrl(raw);
  if (!url || url.length > 1024) throw new Error("Enter a valid HTTP(S) SPARQL endpoint URL without credentials or fragment.");
  return url;
}
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(PERSONAL_SERVERS_CHANGED)); };

/** Stable RDF subject based on the URL, no collisions between registries. */
function nodeFor(base: string, url: string): string {
  return `${resolveGraph(GRAPH.GRAPH_SERVERS, base)}#endpoint-${encodeURIComponent(url)}`;
}
async function insertServer(url: string, label: string, description: string, isPersonal: boolean, groupName = isPersonal ? "Personal Servers" : "Graph Servers", expectedSession?: Awaited<ReturnType<typeof personalContext>>["session"]): Promise<string> {
  const ctx = await personalContext();
  if(expectedSession && ctx.session!==expectedSession)throw new Error("Personal user session changed.");
  const names = graphNames(ctx.base), subject = nodeFor(ctx.base, checkUrl(url));
  const group = normalizeGraphServerGroup(groupName);
  const candidates=await selectPersonal(`SELECT DISTINCT ?group WHERE { GRAPH ${iri(names.graph)} { ?group ${iri(RDF_TYPE)} ${iri(SKOS_COLLECTION)} ; ${iri(RDFS_LABEL)} ?name . FILTER(STR(?name)=${literal(group)}) FILTER(isIRI(?group)) } } ORDER BY ?group`,ctx,undefined,"client-personal-graph-servers:resolveGroup");
  const existingGroups=[...new Set(candidates.map(row=>row.group?.value).filter((value):value is string=>typeof value==="string" && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value)))];
  if(existingGroups.length>1)throw new Error("More than one RDF group has this name. Choose a unique group name.");
  const groupUri=existingGroups[0]??groupSubject(ctx.base,group);
  if (!label.trim() || label.length > 160 || description.length > 1024) throw new Error("Server label/description exceeds the allowed length.");
  // INSERT DATA is idempotent; existing RDF terms are a set. Endpoint URL is
  // an IRI and label is a literal (not an executable service URL).
  await updatePersonal(`INSERT DATA { GRAPH ${iri(names.graph)} {
    ${existingGroups.length ? "" : `${iri(groupUri)} ${iri(RDF_TYPE)} ${iri(SKOS_COLLECTION)} ; ${iri(RDFS_LABEL)} ${literal(group)} .`}
    ${iri(subject)} ${iri(RDF_TYPE)} ${iri(SCHEMA_ENTRYPOINT)} ;
      ${isPersonal ? `${iri(RDF_TYPE)} ${iri(PERSONAL_SERVER_TYPE)} ;` : ""}
      ${iri(SCHEMA_URL)} ${iri(url)} ; ${iri(RDFS_LABEL)} ${literal(label.trim())} ;
      ${iri(SCHEMA_DESCRIPTION)} ${literal(description.trim())} ;
      ${iri(DCT_PART)} ${iri(groupUri)} .
  } }`,undefined,undefined,"client-personal-graph-servers:insertServer",ctx.session);
  await refreshPersonalGraphServers(ctx.session);
  notify(); return subject;
}
export async function addPersonalGraphServer(input: { url: string; label: string; description?: string; personal?: boolean; group: string }): Promise<string> {
  const ctx=await personalContext();
  const group=normalizeGraphServerGroup(input.group);
  const url = checkUrl(input.url);
  if ((await listPersonalGraphServers()).some(entry => entry.url === url))
    throw new Error("This graph server is already registered. Remove the existing registration before replacing it.");
  return insertServer(url, input.label, input.description ?? "", input.personal ?? false, group, ctx.session);
}
/** Re-run after every seeded login, including session rehydration. Never store
 * auth credentials in the RDF metadata or in the public server directory. */
export async function ensureLoggedInPersonalServer(): Promise<string> {
  const ctx = await personalContext();
  const url = checkUrl(personalReadEndpoint(ctx.session));
  // Do not overwrite the user's chosen name for an already registered server.
  // A repeated login must not accumulate additional rdfs:label statements.
  const existing = (await listPersonalGraphServers()).find(entry => entry.url === url);
  if (existing) {
    if (!existing.isPersonal) {
      const names = graphNames(ctx.base);
      await updatePersonal(`INSERT DATA { GRAPH ${iri(names.graph)} {
        ${iri(existing.uri)} ${iri(RDF_TYPE)} ${iri(PERSONAL_SERVER_TYPE)} .
      } }`,undefined,undefined,"client-personal-graph-servers:ensureLoggedInPersonalServer");
      await refreshPersonalGraphServers(ctx.session);
      notify();
    }
    return existing.uri;
  }
  return insertServer(url, "Personal SPARQL", "Authenticated personal graph server", true);
}
export async function listPersonalGraphServers(signal?: AbortSignal): Promise<PersonalGraphServer[]> {
  const ctx=await personalContext();
  const saved=await readSessionHydration(ctx.session);
  signal?.throwIfAborted();
  return saved.snapshot ? saved.snapshot.servers : fetchPersonalGraphServers(ctx,signal);
}
async function refreshPersonalGraphServers(session:Awaited<ReturnType<typeof personalContext>>["session"]):Promise<void>{
  const ctx=await personalContext();
  if(ctx.session!==session)throw new Error("Personal user session changed.");
  const servers=await fetchPersonalGraphServers(ctx);
  await updateSessionSnapshot(session,{servers});
}
async function fetchPersonalGraphServers(ctx:Awaited<ReturnType<typeof personalContext>>,signal?:AbortSignal):Promise<PersonalGraphServer[]> {
  const names = graphNames(ctx.base);
  const rows = await selectPersonal(`SELECT DISTINCT ?server ?url ?label ?description ?type ?group ?groupLabel WHERE { GRAPH ${iri(names.graph)} {
    ?server ${iri(RDF_TYPE)} ${iri(SCHEMA_ENTRYPOINT)} ; ${iri(SCHEMA_URL)} ?url .
    OPTIONAL { ?server ${iri(RDFS_LABEL)} ?label }
    OPTIONAL { ?server ${iri(SCHEMA_DESCRIPTION)} ?description }
    OPTIONAL { ?server ${iri(RDF_TYPE)} ?type . FILTER(?type = ${iri(PERSONAL_SERVER_TYPE)}) }
    OPTIONAL { ?server ${iri(DCT_PART)} ?group . ?group ${iri(RDFS_LABEL)} ?groupLabel }
  } } ORDER BY ?label ?server ?group LIMIT 500`, ctx, signal, "urn:maestro:component:graph-servers");
  const deduplicated = new Map<string, PersonalGraphServer>();
  for (const row of rows) {
    const uri = row.server?.value ?? "", url = validGraphServerUrl(row.url?.value ?? "");
    if (!uri.startsWith(`${resolveGraph(GRAPH.GRAPH_SERVERS, ctx.base)}#endpoint-`) || !url) continue;
    const previous = deduplicated.get(uri);
    let group=previous?.group;
    try { if(!group && row.groupLabel?.value)group=normalizeGraphServerGroup(row.groupLabel.value); } catch {/* ignore malformed RDF */}
    deduplicated.set(uri, { uri, url, group, label: previous?.label || row.label?.value || url,
      description: previous?.description || row.description?.value || "",
      isPersonal: Boolean(previous?.isPersonal || row.type?.value === PERSONAL_SERVER_TYPE) });
  }
  return [...deduplicated.values()];
}
/** Delete only explicitly managed subjects in this user's dedicated graph.
 * Never DELETE WHERE across the seed graph, arbitrary Graphs, or other users. */
export async function deletePersonalGraphServer(subject: string): Promise<void> {
  const ctx = await personalContext(); const names = graphNames(ctx.base);
  if (!subject.startsWith(`${resolveGraph(GRAPH.GRAPH_SERVERS, ctx.base)}#endpoint-`) || subject.length > 4096 || /[<>\s]/.test(subject))
    throw new Error("Only graph servers added to the active personal store can be deleted.");
  await updatePersonal(`DELETE WHERE { GRAPH ${iri(names.graph)} { ${iri(subject)} ?predicate ?object } }`,undefined,undefined,"client-personal-graph-servers:deletePersonalGraphServer");
  await refreshPersonalGraphServers(ctx.session);
  notify();
}
export function asEndpointOption(entry: PersonalGraphServer): EndpointOption {
  return { id: `personal:${encodeURIComponent(entry.url)}`, label: entry.label, url: entry.url, isPersonal: entry.isPersonal,
    group: entry.group || (entry.isPersonal ? "Personal Servers" : "Graph Servers") };
}
