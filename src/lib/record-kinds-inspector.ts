import { ALL_GRAPHS } from "./graph-address-mode";
import { MAESTRO_KIND_IDS, maestroKindSparql, normalizeMaestroKind } from "./maestro-kinds";

/**
 * Record Kind choices are classified over already-fetched RDF terms in the
 * browser; unlike Configure Kinds there is no Record Kinds network request.
 * This is a runnable diagnostic projection using the very same Kind predicates,
 * NOT a purported transcript of an executed request.
 */
export function buildRecordKindsInspectorSparql(
  recordUri: string,
  termType: string,
  addr: string,
  selectedGraph: string,
  selectedKind: string,
): string {
  const preamble = "# Diagnostic preview only: Record Kinds are classified locally over fetched RDF values.\n# This SPARQL is not executed by the Record Kind dropdown.\n";
  const iri = (raw: string) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) && !/[<>"{}|^`\\\u0000-\u0020]/.test(raw)
    ? `<${raw}>` : null;
  const resource = termType === "uri" ? iri(recordUri) : null;
  if (!resource) return `${preamble}# A blank-node or non-IRI Record cannot be addressed by a standalone URI query.`;
  const graphName = selectedGraph || addr.slice(0, addr.indexOf("@") >= 0 ? addr.indexOf("@") : 0);
  const graph = graphName && graphName !== ALL_GRAPHS ? iri(graphName) : null;
  if (graphName && graphName !== ALL_GRAPHS && !graph) return `${preamble}# Invalid selected graph IRI.`;
  const value = "?maestroKindValue";
  const cases = MAESTRO_KIND_IDS.map(kind => `(?maestroKind = "${kind}" && (${maestroKindSparql(kind, value) ?? "false"}))`);
  const relation = `{ ${resource} ?recordPredicate ${value} . } UNION { ${value} ?recordPredicate ${resource} . }`;
  const scoped = graph ? `GRAPH ${graph} { ${relation} }` : relation;
  const kind = normalizeMaestroKind(selectedKind);
  return `${preamble}SELECT DISTINCT ?maestroKind ${value} WHERE {\n` +
    `  VALUES ?maestroKind { ${MAESTRO_KIND_IDS.map(id => `"${id}"`).join(" ")} }\n` +
    `  ${scoped}\n` +
    `  FILTER (${cases.join(" ||\n    ")})\n` +
    (kind ? `  FILTER (?maestroKind = "${kind}")\n` : "") +
    `}\nLIMIT 200`;
}
