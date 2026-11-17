/** Build bounded RDF service discovery SELECTs for the generic SPARQL gateway.
 * No service/operation execution takes place here. The gateway remains the
 * authority for endpoint authorization, query limits and read-only execution.
 */
const SVC = "gttp://ggg.maestro.ecosys/ns/service#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";

export const MAX_RECORD_SERVICE_QUERY_LENGTH = 8_000;

export function safeRecordServiceIri(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 &&
    /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
}

export function buildRecordServiceDiscoveryQueries(graph: string, types: string[]): string[] {
  if (!safeRecordServiceIri(graph)) throw new Error("Invalid personal policy graph address.");
  const classes = [...new Set(types.filter(safeRecordServiceIri))].slice(0, 100);
  if (!classes.length) return [];
  const before = `PREFIX svc: <${SVC}>
PREFIX sh: <${SH}>
PREFIX rdf: <${RDF}>
PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?service ?label ?operation ?operationLabel ?requires WHERE {
  GRAPH <${graph}> {
    VALUES ?class { `;
  const after = ` }
    ?service a svc:Service, sh:NodeShape ; sh:targetClass ?class ; rdfs:label ?label ; svc:operation ?operation .
    ?operation rdfs:label ?operationLabel ; svc:endpoint ?endpoint ; svc:method ?method ;
      svc:inputTransform/rdf:value ?inputXslt ; svc:outputTransform/rdf:value ?outputXslt .
    OPTIONAL { ?operation svc:requires ?requires }
  }
} LIMIT 150`;
  const queries: string[] = [];
  let chunk: string[] = [];
  let length = before.length + after.length;
  for (const uri of classes) {
    const value = `<${uri}>`;
    if (chunk.length && length + value.length + 1 > MAX_RECORD_SERVICE_QUERY_LENGTH) {
      queries.push(before + chunk.join(" ") + after);
      chunk = [];
      length = before.length + after.length;
    }
    if (length + value.length > MAX_RECORD_SERVICE_QUERY_LENGTH) {
      throw new Error("Record service class IRI exceeds the bounded SPARQL request limit.");
    }
    chunk.push(value);
    length += value.length + 1;
  }
  if (chunk.length) queries.push(before + chunk.join(" ") + after);
  return queries;
}
