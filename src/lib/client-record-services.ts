"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { buildRecordServiceDiscoveryQueries, safeRecordServiceIri } from "@/lib/record-service-discovery-query";

type RecordService = {uri: string; label: string; operations: Array<{uri: string; label: string; requires: string[]}>};

/** SPARQL discovery only. Execution remains in the trusted /service handler,
 * which validates service configuration, XSLT, URL origin and response size. */
export async function discoverRecordServices(types: string[], signal?: AbortSignal): Promise<RecordService[]> {
  const classes = [...new Set(types.filter(safeRecordServiceIri))].slice(0,100);
  if (!classes.length) return [];
  const ctx = await personalContext();
  const graph = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`;
  const queries = buildRecordServiceDiscoveryQueries(graph, classes);
  const byService = new Map<string,RecordService>();
  // The authenticated transport enforces a 10 KB read limit when a server
  // session has not yet been restored. Bound each request independently;
  // merging batches preserves distinct services/operations across classes.
  for (const query of queries) {
    const rows = await selectPersonal(query, ctx, signal,"client-record-services:discoverRecordServices");
    for (const row of rows) {
      const uri = row.service?.value ?? "", operation = row.operation?.value ?? "";
      if (!safeRecordServiceIri(uri) || !safeRecordServiceIri(operation)) continue;
      const service: RecordService = byService.get(uri) ?? {
        uri, label: row.label?.value || uri, operations: [],
      };
      let entry = service.operations.find(item => item.uri === operation);
      if (!entry) {
        entry = { uri: operation, label: row.operationLabel?.value || operation, requires: [] };
        service.operations.push(entry);
      }
      const required = row.requires?.value ?? "";
      if (required && !entry.requires.includes(required)) entry.requires.push(required);
      byService.set(uri, service);
    }
  }
  return [...byService.values()];
}
