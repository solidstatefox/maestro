/** Graph server metadata via the one SPARQL endpoint; no server-specific API route. */
type Binding = { value?: string };
type SparqlResults = { results?: { bindings?: Record<string, Binding>[] } };
const select = async (endpoint: string, query: string, signal?: AbortSignal): Promise<SparqlResults> => {
  const response = await fetch("/proxy/api/sparql", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addr: `@${endpoint}`, query }), signal,
  });
  if (!response.ok) throw new Error(`SPARQL HTTP ${response.status}`);
  return await response.json() as SparqlResults;
};

export async function graphServerSoftware(endpoint: string, signal?: AbortSignal): Promise<{product: string; version: string}> {
  const query = `PREFIX bif: <bif:>\nSELECT (bif:sys_stat('st_dbms_name') AS ?product) (bif:sys_stat('st_dbms_ver') AS ?version) WHERE {} LIMIT 1`;
  const row = (await select(endpoint, query, signal)).results?.bindings?.[0];
  return { product: row?.product?.value ?? "Unknown", version: row?.version?.value ?? "" };
}
export async function graphServerDescription(endpoint: string, signal?: AbortSignal): Promise<string> {
  const iri = `<${endpoint.replace(/[<>]/g, "")}>`;
  const query = `SELECT DISTINCT ?description WHERE {
    { ?dataset <http://rdfs.org/ns/void#sparqlEndpoint> ${iri} . ?dataset ?p ?description . }
    UNION { ?service <http://www.w3.org/ns/sparql-service-description#endpoint> ${iri} . ?service ?p ?description . }
    UNION { ${iri} ?p ?description . }
    VALUES ?p { <http://purl.org/dc/terms/description> <https://schema.org/description> <http://www.w3.org/2000/01/rdf-schema#comment> }
    FILTER(isLiteral(?description) && (LANG(?description) = "" || LANGMATCHES(LANG(?description), "en")))
  } LIMIT 5`;
  const rows = (await select(endpoint, query, signal)).results?.bindings ?? [];
  const values = rows.map(row => row.description?.value?.trim() ?? "").filter(Boolean);
  return (values.find(value => value.length >= 24) ?? values[0] ?? "").slice(0, 320);
}
