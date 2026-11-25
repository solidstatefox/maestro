/** Shared, transport-independent meaning of FCT's graph@endpoint address.
 * The endpoint here is the server executing the query, NOT an RDF SERVICE
 * target appearing somewhere inside its generated SPARQL. */
export type FctExecutionAddress = { graph: string; endpoint: string };

export function parseFctExecutionAddress(addr: string): FctExecutionAddress | null {
  const match = /^(.*?)@(https?:\/\/\S+)$/i.exec(addr.trim());
  if (!match) return null;
  try {
    const url = new URL(match[2]);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return { graph: match[1], endpoint: match[2] };
  } catch { return null; }
}

export function requireFctExecutionAddress(addr: string): FctExecutionAddress {
  const parsed = parseFctExecutionAddress(addr);
  if (!parsed) throw new Error('Expected an FCT execution address in "graph@https://server/sparql" form.');
  return parsed;
}

/** Central update used whenever a derived query changes its execution target.
 * Omitted components are intentionally preserved. */
export function updateFctExecutionAddress(current: string, change: Partial<FctExecutionAddress>): string {
  const previous = requireFctExecutionAddress(current);
  const graph = change.graph ?? previous.graph;
  const endpoint = change.endpoint ?? previous.endpoint;
  requireFctExecutionAddress(`${graph}@${endpoint}`);
  return `${graph}@${endpoint}`;
}

/** SPARQL Code Blocks must use an explicit execution address. Never fall back
 * to the currently active Browse query or infer a server from SERVICE clauses. */
export function sparqlEditorUrl(executionAddr: string | undefined, query: string): string | null {
  if (!executionAddr || !query.trim()) return null;
  const parsed = parseFctExecutionAddress(executionAddr);
  if (!parsed) return null;
  const url = new URL(parsed.endpoint);
  if (!/\/sparql(?:-auth)?\/?$/i.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  url.searchParams.set("qtxt", query);
  // The default dataset graph is part of the same execution address.
  // $ALL$ is Maestro's unbound FCT graph sentinel, not an RDF graph IRI.
  // Never submit it as a default dataset graph to Virtuoso's query editor.
  if (parsed.graph && parsed.graph !== "$ALL$") url.searchParams.set("default-graph-uri", parsed.graph);
  return url.toString();
}
