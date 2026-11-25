"use client";
import { readClientShaclShapeTriples, validateClientShaclRows, type ShaclDataTriple } from "@/lib/client-record-shacl";
import { readSessionHydration } from "@/lib/client-digest-session";
import { personalContext } from "@/lib/client-personal-sparql";
import type { ShaclValidationReport } from "@/lib/shacl-validation-report";
export type ProviderPolicyRows = Awaited<ReturnType<typeof readClientShaclShapeTriples>>;
export type ProviderValidationData = { focus: {iri:string;label:string}[]; triples: ShaclDataTriple[] };
const cache = new Map<string,{session:Awaited<ReturnType<typeof personalContext>>["session"]; rows:ProviderPolicyRows; expires:number}>();
let epoch=0;
const invalidate=()=>{cache.clear();epoch++;};
if(typeof window!=="undefined"){
  window.addEventListener("maestro:personal-session-cleared",invalidate);
  window.addEventListener("maestro:auth-bootstrap-updated",invalidate);
}
export async function loadProviderPolicy(shape:string,revision:number,signal:AbortSignal):Promise<ProviderPolicyRows>{
  const ctx=await personalContext();
  const {snapshot}=await readSessionHydration(ctx.session);
  signal.throwIfAborted();
  const key=snapshot?.seedRevision?JSON.stringify([ctx.addr,snapshot.seedRevision,revision,shape]):"";
  const hit=cache.get(key);
  if(key&&hit?.session===ctx.session&&Date.now()<hit.expires)return hit.rows;
  const started=epoch;
  const rows=await readClientShaclShapeTriples(shape,signal);
  signal.throwIfAborted();
  if((await personalContext()).session!==ctx.session)throw new Error("Personal user session changed.");
  if(key&&started===epoch){if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,{session:ctx.session,rows,expires:Date.now()+300000});}
  return rows;
}
export async function validateProviderPage(shape:string,policy:ProviderPolicyRows,data:ProviderValidationData,signal:AbortSignal):Promise<ShaclValidationReport>{
  signal.throwIfAborted();
  if(!data.focus.length)throw new Error("Provider supplied no SHACL focus nodes.");
  const labels=new Map(data.focus.map(f=>[f.iri,f.label]));
  const report=await validateClientShaclRows(shape,data.focus[0].iri,policy,data.triples,data.focus.map(f=>f.iri));
  signal.throwIfAborted();
  return {...report,violations:report.violations.map(v=>({...v,message:`${labels.get(v.focusNode)||v.focusNode}: ${v.message}`}))};
}
