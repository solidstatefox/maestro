/** Reserved graph component of <query addr="graph@graph-server">. */
export const ALL_GRAPHS = "$ALL$" as const;

/** A reserved graph token is an instruction to omit GRAPH scoping, not an IRI. */
export function unscopedGraph(graph: string | null | undefined): string {
  return graph === ALL_GRAPHS ? "" : (graph ?? "");
}
