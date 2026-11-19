"use client";
/** The same RDF -> XState adapter is used in the browser for curator and
 * Record controls. Use the existing authenticated personal SPARQL transport;
 * reads use /sparql; updates use the authentication mode selected at login. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { compileStatusMachines, statusMachineRows, statusMachineSelect, type CompiledStatusMachine } from "@/lib/status-machine-runtime";

const cache = new Map<string, { until: number; machines: CompiledStatusMachine[] }>();
export function invalidateClientStatusMachines(): void { cache.clear(); }

export async function loadClientStatusMachines(signal?: AbortSignal): Promise<CompiledStatusMachine[]> {
  const ctx = await personalContext();
  const graph = `${ctx.base}/shacl/policies`;
  const key = `${ctx.addr}\u0000${graph}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.machines;
  const rows = await selectPersonal(statusMachineSelect(graph), ctx, signal);
  const machines = compileStatusMachines(statusMachineRows(rows));
  if (cache.size > 16) cache.clear();
  cache.set(key, { until: Date.now() + 60_000, machines });
  return machines;
}
