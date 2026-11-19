/** Pure interaction projection; never mutates FCT or RDF data. */
export function traceSankeyStreams(links: ReadonlyArray<{source:string;target:string}>, focus:string) {
  const nodes = new Set<string>([focus]);
  const chosen = new Set<number>();
  // The selected node's full upstream/downstream flows, without unrelated
  // branches connected only through a shared ancestor.
  for (const upstream of [true,false]) {
    const visited = new Set<string>();
    const stack = [focus];
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      links.forEach((link,index) => {
        if ((upstream ? link.target : link.source) !== current) return;
        chosen.add(index);
        const other = upstream ? link.source : link.target;
        nodes.add(other);
        if (!visited.has(other)) stack.push(other);
      });
    }
  }
  return {nodes, links:chosen};
}
