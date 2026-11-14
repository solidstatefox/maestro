"use client";
/** The same RDF -> XState adapter is used in the browser for curator actions. */
import { loadPersonalAuthSession, graphForPrefix } from "@/lib/personal-auth";
import { compileStatusMachines,statusMachineRows,statusMachineSelect,type CompiledStatusMachine } from "@/lib/status-machine-runtime";
const cache=new Map<string,{until:number; machines:CompiledStatusMachine[]}>();
export function invalidateClientStatusMachines():void{cache.clear();}
export async function loadClientStatusMachines(signal?:AbortSignal):Promise<CompiledStatusMachine[]> {
  const auth=await loadPersonalAuthSession();
  if(!auth) throw new Error("Log in before using status machines.");
  const graph=`${graphForPrefix(auth.graphPrefix)}/shacl/policies`;
  const key=`${auth.graphStore}\u0000${graph}`;
  const hit=cache.get(key);
  if(hit && hit.until>Date.now())return hit.machines;
  const response=await fetch("/proxy/api/sparql",{method:"POST",cache:"no-store",signal,
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({addr:`${graph}@${auth.graphStore}`,query:statusMachineSelect(graph)})});
  const body=await response.json() as {error?:string;results?:{bindings?:Array<Record<string,{value?:string}>>}};
  if(!response.ok||body.error)throw new Error(body.error||`SHACL FSM lookup failed (HTTP ${response.status})`);
  const machines=compileStatusMachines(statusMachineRows(body.results?.bindings??[]));
  cache.set(key,{until:Date.now()+60000,machines});
  return machines;
}
