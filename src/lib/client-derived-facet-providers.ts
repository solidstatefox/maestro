"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** RDF/SHACL-discovered, effective-approval-gated regex facet derivations. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import type { DerivedRegexField } from "@/lib/fct-derived-facets";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SH = "http://www.w3.org/ns/shacl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const validIri = (value:string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);

export async function discoverApprovedRegexDerivations(property: string,
  signal?: AbortSignal): Promise<DerivedRegexField[]> {
  if (!validIri(property)) throw new Error("Invalid spawning facet IRI.");
  const ctx = await personalContext();
  const graph = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`;
  const rows = await selectPersonal(`PREFIX mui: <${MUI}> PREFIX sh: <${SH}>
    PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
    SELECT DISTINCT ?provider ?pattern ?splitPattern ?sourceValuePredicate ?resultIri ?fieldLabel ?capture WHERE {
      GRAPH <${graph}> {
        ?provider a mui:Provider ; mui:accepts ?shape ; mui:derivedField ?field .
        OPTIONAL { ?provider mui:sourcePattern ?pattern }
        OPTIONAL { ?provider mui:splitPattern ?splitPattern }
        OPTIONAL { ?provider mui:sourceValuePredicate ?sourceValuePredicate }
        ?shape a mui:InputShape .
        { ?shape sh:property/sh:path <${property}> }
        UNION { ?shape sh:or/rdf:rest*/rdf:first/sh:property/sh:path <${property}> }
        ?field mui:resultPredicate ?resultIri ; rdfs:label ?fieldLabel .
        OPTIONAL { ?field mui:capture ?capture }
      }
    } ORDER BY ?provider ?capture LIMIT 100`, ctx, signal,"client-derived-facet-providers:discoverApprovedRegexDerivations");
  const candidates = [...new Set(rows.map(row => row.provider?.value || "").filter(validIri))];
  if (!candidates.length) return [];
  const approved = new Set((await readClientPolicyApprovals(candidates, signal))
    .filter(status => status.status === "Approved").map(status => status.uri));
  const fields: DerivedRegexField[] = [];
  for (const row of rows) {
    if (!approved.has(row.provider?.value || "")) continue;
    const iri=row.resultIri?.value || "", label=row.fieldLabel?.value || "",
      pattern=row.pattern?.value || "", capture=row.capture?.value || "";
    const splitPattern = row.splitPattern?.value || "";
    const sourceValuePredicate = row.sourceValuePredicate?.value || "";
    if (!validIri(iri) || !label.trim() ||
        (sourceValuePredicate && !validIri(sourceValuePredicate))) continue;
    const metadata = {iri, label, ...(sourceValuePredicate ? {sourceValuePredicate} : {})};
    if (splitPattern && splitPattern.length <= 2000 && !pattern) {
      fields.push({...metadata, mode:"split", splitPattern});
    } else if (pattern && pattern.length <= 2000 && /^[1-9]$/.test(capture)) {
      fields.push({...metadata, mode:"regex", pattern, capture});
    }
  }
  return [...new Map(fields.map(field => [field.iri,field] as const)).values()];
}
