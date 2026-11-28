"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/**
 * Shapes-driven Kinds discovery at login deliberately uses ordinary SPARQL.
 * There is no FCT <query>/<view> (and hence no browsed virtual data graph or
 * focus node) to apply Kinds to at this stage. The W3C SHACL UI discussion of
 * shapes-only/query-UI initialization remains open:
 * https://github.com/w3c/data-shapes/issues/609
 *
 * Consequently, do NOT run SHACL validation/rendering here. Discover all
 * mui:KindProvider declarations from the personal policies graph, deserialize
 * their mui:pattern literals once into Maestro's native TypeScript Kind model,
 * and apply the patterns to the active FCT query only later.
 */
import { personalContext, selectPersonal, type PersonalTransportAuthority } from "@/lib/client-personal-sparql";
import { hydrateMaestroKinds, clearMaestroKinds } from "@/lib/maestro-kinds";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const iri = (value: string) => `<${value.replace(/[<>"{}|^`\\\s]/g, "")}>`;

let loadedSessionKey = "";
let loadedEntries: {id:string;pattern:string}[] = [];
export function currentSessionKinds(){return loadedEntries;}
export function restoreSessionKinds(addr:string,base:string,entries:{id:string;pattern:string}[]):void{
  hydrateMaestroKinds(entries);loadedEntries=entries;loadedSessionKey=`${addr}\u0000${base}`;
}
let generation = 0;
const inFlight = new Map<string, Promise<void>>();

export async function loadMaestroKinds(signal?: AbortSignal, authority: PersonalTransportAuthority = "view"): Promise<void> {
  if (authority === "personal-initialization" && !signal) throw new Error("Kinds initialization requires its XState signal.");
  const ctx = await personalContext();
  const key = `${ctx.addr}\u0000${ctx.base}`;
  if (loadedSessionKey === key) return;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const currentGeneration = generation;
  const task = (async () => {
    // Deliberately NOT limited to a hardcoded Kinds provider IRI: new
    // registered mui:KindProvider resources participate without a build step.
    // OPTIONAL retains provider-declared text/blank Kinds without regexes.
    const query = `SELECT DISTINCT ?provider ?kind ?pattern WHERE {
      GRAPH ${iri(`${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`)} {
        ?provider ${iri(RDF_TYPE)} ${iri(`${MUI}KindProvider`)} ;
                  ${iri(`${MUI}widget`)} ?kind .
        ?kind ${iri(RDF_TYPE)} ${iri(`${MUI}Kind`)} .
        OPTIONAL { ?kind ${iri(`${MUI}pattern`)} ?pattern . }
      }
    } ORDER BY ?provider ?kind ?pattern`;
    const rows = await selectPersonal(query, ctx, signal,"client-kinds:loadMaestroKinds",authority,{tab:"personal",ribbon:"session"});
    if (signal?.aborted || currentGeneration !== generation) return;
    const entries = rows.flatMap((row) => {
      if (row.provider?.type !== "uri" || row.kind?.type !== "uri") return [];
      const kindUri = row.kind.value;
      const pattern = row.pattern?.value;
      if (!kindUri || typeof pattern !== "string" || row.pattern?.type !== "literal") return [];
      const kindId = kindUri.slice(Math.max(kindUri.lastIndexOf("/"), kindUri.lastIndexOf("#")) + 1);
      return [{ id: kindId, pattern }];
    });
    restoreSessionKinds(ctx.addr,ctx.base,entries);
  })();
  inFlight.set(key, task);
  try { await task; }
  finally { if (inFlight.get(key) === task) inFlight.delete(key); }
}

export function resetMaestroKinds(): void {
  generation++;
  loadedSessionKey = "";
  loadedEntries=[];
  inFlight.clear();
  clearMaestroKinds();
}
