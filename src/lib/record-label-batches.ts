/** Query-size control for optional Record URI labels. Every URI/graph pair is
 * retained, but no single SPARQL request scans the entire cross-product.
 */
export function* recordLabelBatches(
  uris: readonly string[], graphs: readonly string[],
): Generator<{ uris: string[]; graphs: string[] }> {
  for (let uriStart = 0; uriStart < uris.length; uriStart += 24) {
    const uriBatch = uris.slice(uriStart, uriStart + 24);
    if (!graphs.length) {
      yield { uris: [...uriBatch], graphs: [] }; // GRAPH ?g on All graphs
      continue;
    }
    for (let graphStart = 0; graphStart < graphs.length; graphStart += 12) {
      yield { uris: [...uriBatch], graphs: graphs.slice(graphStart, graphStart + 12) };
    }
  }
}
