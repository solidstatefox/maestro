"use client";

/** Checks write permission without a private endpoint; runs two SPARQL updates.
 * The generic SPARQL transport restricts writes to the logged-in personal graph.
 */
export async function probeGraphWriteAccess(graph: string): Promise<{access: boolean; error?: string}> {
  if (!/^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(graph)) return { access: false, error: "Invalid graph IRI" };
  const id = crypto.randomUUID();
  const triple = `<urn:uuid:${id}> <urn:uuid:${crypto.randomUUID()}> <urn:uuid:${crypto.randomUUID()}>`;
  const execute = async (update: string) => {
    const response = await fetch("/proxy/api/sparql", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update }) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as {error?: string};
      throw new Error(body.error || `SPARQL update returned HTTP ${response.status}`);
    }
  };
  try { await execute(`INSERT DATA { GRAPH <${graph}> { ${triple} } }`); }
  catch (error) { return { access: false, error: error instanceof Error ? error.message : "Insert denied" }; }
  try { await execute(`DELETE DATA { GRAPH <${graph}> { ${triple} } }`); }
  catch (error) { return { access: false, error: `Test triple inserted but could not be removed: ${error instanceof Error ? error.message : error}` }; }
  return { access: true };
}
