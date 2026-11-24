"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Read-only provider and policy diagnostic inventory. Personal RDF is the
 * authority. A missing SHACL ValidationReport is inconclusive (amber), never
 * inferred as passing from approval, presence or type alone. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SH = "http://www.w3.org/ns/shacl#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export type ProviderDiagnostic = {
  uri: string; name: string; component: string; category: "Policies" | "mui:Providers";
  validation: "pass" | "fail" | "unknown";
};
export async function readClientProviderDiagnostics(signal?: AbortSignal): Promise<ProviderDiagnostic[]> {
  const ctx = await personalContext();
  const graph = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`, otcGraph = `${resolveGraph(GRAPH.OTC_TRANSCODERS, ctx.base)}`, approvalGraph = `${resolveGraph(GRAPH.POLICY_APPROVALS, ctx.base)}`;
  // Provider definitions are seeded in both the SHACL policy graph and the
  // OTC provider graph; curators are also providers via their ontology class.
  // SHACL ValidationReport is not automatically persisted by a validator.
  // Without an explicit report scoped to this focus, use amber, not green.
  const rows = await selectPersonal(`PREFIX mui: <${MUI}> PREFIX sh: <${SH}>
    PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
    SELECT DISTINCT ?uri ?label ?kind ?component ?conforms WHERE {
      {
        GRAPH <${graph}> {
          { ?uri a mui:Provider . BIND("mui:Providers" AS ?kind) }
          UNION { ?uri a mui:CurationProvider . BIND("mui:Providers" AS ?kind) }
          UNION { ?uri a mui:ClassPolicy . BIND("Policies" AS ?kind) }
          OPTIONAL { ?uri rdfs:label ?label }
        }
      } UNION {
        GRAPH <${otcGraph}> {
          ?uri a mui:Provider .
          BIND("mui:Providers" AS ?kind)
          OPTIONAL { ?uri rdfs:label ?label }
        }
      }
      OPTIONAL { GRAPH <${graph}> {
        ?report a sh:ValidationReport ; sh:conforms ?conforms .
        { ?report sh:focusNode ?uri }
        UNION { ?report sh:result/sh:focusNode ?uri }
      } }
      OPTIONAL { GRAPH <${approvalGraph}> { ?uri mui:lastRequestComponent ?component } }
    } ORDER BY ?kind ?label ?uri LIMIT 500`, ctx, signal,"client-provider-diagnostics:readClientProviderDiagnostics");
  const result = new Map<string, ProviderDiagnostic>();
  for (const row of rows) {
    const uri = row.uri?.value ?? "";
    if (!uri) continue;
    const category = row.kind?.value === "Policies" ? "Policies" : "mui:Providers";
    const key = `${category}|${uri}`;
    const existing = result.get(key);
    const conforms = row.conforms?.value;
    const validation: ProviderDiagnostic["validation"] = conforms === "false" || conforms === "0" ? "fail"
      : conforms === "true" || conforms === "1" ? "pass" : "unknown";
    result.set(key, {
      uri, category,
      name: row.label?.value ?? existing?.name ?? uri.slice(uri.lastIndexOf("/") + 1),
      component: row.component?.value ?? existing?.component ?? "No recorded caller",
      validation: validation === "unknown" ? existing?.validation ?? "unknown" : validation,
    });
  }
  return [...result.values()];
}
