/** Inspect SPARQL Update graph targets without confusing embedded SPARQL source
 * code (e.g. the FCT query saved as an rdf:value literal) with an update clause.
 * No client-supplied graph can bypass the namespace checks in /proxy/api/sparql.
 */
export function inspectPersonalUpdateGraphs(update: string): {
  graphs: string[];
  hasImplicitGraph: boolean;
  clean: string;
} {
  // Preserve character offsets so GRAPH keywords found outside IRI/literal
  // tokens can be matched against their corresponding explicit graph IRIs.
  const withoutStrings = update.split("");
  const outsideTokens = update.split("");
  const blank = (from: number, to: number, iri = false) => {
    for (let p = from; p < to; p++) {
      outsideTokens[p] = " ";
      if (!iri) withoutStrings[p] = " ";
    }
  };
  for (let i = 0; i < update.length;) {
    const c = update[i];
    if (c === "<") {
      // A valid SPARQL IRIREF cannot contain whitespace or an unescaped '>'.
      const end = update.indexOf(">", i + 1);
      if (end > i && !/[\s<>"{}|^`\\]/.test(update.slice(i + 1, end))) {
        blank(i, end + 1, true);
        i = end + 1;
        continue;
      }
    }
    if (c === "#") {
      let end = update.indexOf("\n", i);
      if (end < 0) end = update.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      const triple = update.slice(i, i + 3) === c.repeat(3);
      const delimiterLength = triple ? 3 : 1;
      let p = i + delimiterLength;
      let closed = false;
      while (p < update.length) {
        if (update[p] === "\\") { p += 2; continue; }
        if (update.slice(p, p + delimiterLength) === c.repeat(delimiterLength)) {
          p += delimiterLength;
          closed = true;
          break;
        }
        p++;
      }
      // An unterminated string is invalid syntax. Leave no possible update
      // clauses exposed after the initial quote.
      blank(i, closed ? p : update.length);
      i = closed ? p : update.length;
      continue;
    }
    i++;
  }
  const outside = outsideTokens.join("");
  const visible = withoutStrings.join("");
  const graphs: string[] = [];
  let hasImplicitGraph = false;
  for (const match of outside.matchAll(/\bGRAPH\b/gi)) {
    const offset = match.index ?? 0;
    const explicit = /^GRAPH\s*<([^<>]+)>/i.exec(visible.slice(offset));
    if (!explicit) {
      hasImplicitGraph = true;
    } else {
      graphs.push(explicit[1]);
    }
  }
  return { graphs, hasImplicitGraph, clean: outside };
}
