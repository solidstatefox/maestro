/** Authenticated SPARQL transport and user-scoped in-memory machine registry. */
import { getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { getPersonalStatusGraph } from "@/lib/personal-status-graph";
import { compileStatusMachines, statusMachineRows, statusMachineSelect, type CompiledStatusMachine } from "@/lib/status-machine-runtime";

const cache=new Map<string,{until:number;machines:CompiledStatusMachine[]}>();
/** Re-seeding must invalidate machine definitions and instance permissions. */
export function invalidateServerStatusMachines():void {cache.clear();}
export async function loadServerStatusMachines(request:Request):Promise<CompiledStatusMachine[]> {
  const graph=getShapesGraph(request);
  const user=getPersonalStatusGraph(request);
  const key=`${graph}\u0000${user}`;
  const hit=cache.get(key);
  if (hit && hit.until>Date.now()) return hit.machines;
  const response=await queryPersonalSparql(statusMachineSelect(graph),20000,request);
  const machines=compileStatusMachines(statusMachineRows(response.results?.bindings??[]));
  if (cache.size>16) cache.clear();
  cache.set(key,{until:Date.now()+60000,machines});
  return machines;
}
