/** Add personal-state constraints to an ordinary compiled FCT query.
 *
 * The remote graph patterns are a SERVICE group, not a nested SELECT. This
 * preserves the FCT projection, grouping, ordering and LIMIT/OFFSET, while
 * evaluating personal-state constraints before result pagination.
 */
export type ScopedStateBinding = { variable: string; uri: string };

const MUI = 'gttp://ggg.maestro.ecosys/ns/ui#';
function sparqlIri(value: string): string {
  if (!/^[A-Za-z][A-Za-z\d+.-]*:[^\s<>"{}|^`\\]*$/.test(value)) throw new Error('Invalid state federation IRI.');
  return `<${value}>`;
}
function canonicalEndpoint(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** Find the closing brace of the outer WHERE group, respecting nested groups. */
function whereGroup(query: string): { start: number; end: number } {
  const match = /\bWHERE\s*\{/i.exec(query);
  if (!match) throw new Error('A compiled FCT query must have a WHERE group.');
  const start = match.index + match[0].length;
  let depth = 1, quote = '', escaped = false, iri = false;
  for (let i = start; i < query.length; i++) {
    const c = query[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (iri) { if (c === '>') iri = false; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '<' && /[A-Za-z]/.test(query[i + 1] ?? '')) { iri = true; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return { start, end: i };
  }
  throw new Error('Unterminated FCT WHERE group.');
}

export function compileScopedStateFederation(
  compiled: string,
  constraints: readonly ScopedStateBinding[],
  liveEndpoint: string,
  personalEndpoint: string,
  stateGraph: string,
  hideGraph: string,
): string {
  if (!constraints.length) return compiled;
  const group = whereGroup(compiled);
  const source = compiled.slice(group.start, group.end).trim();
  const remote = canonicalEndpoint(liveEndpoint) === canonicalEndpoint(personalEndpoint)
    ? source
    : `SERVICE ${sparqlIri(liveEndpoint)} {\n${source}\n}`;
  const personal = constraints.map(({ variable, uri }, i) => {
    if (!/^\?[A-Za-z][A-Za-z\d_]*$/.test(variable)) throw new Error('Invalid state variable.');
    const name = uri.slice(MUI.length);
    if (!uri.startsWith(MUI) || !['New', 'Seen', 'Starred', 'Hidden'].includes(name)) throw new Error('Unknown state.');
    if (name === 'New') return `GRAPH ${sparqlIri(stateGraph)} { ${variable} ${sparqlIri(MUI + 'lastLocatedAt')} ?locatedState${i} . }\nFILTER NOT EXISTS { GRAPH ${sparqlIri(stateGraph)} { ${variable} ${sparqlIri(MUI + 'state')} ${sparqlIri(MUI + 'Seen')} . } }`;
    const graph = name === 'Hidden' ? hideGraph : stateGraph;
    return `GRAPH ${sparqlIri(graph)} { ${variable} ${sparqlIri(MUI + 'state')} ${sparqlIri(MUI + name)} . }`;
  }).join('\n');
  return compiled.slice(0, group.start) + '\n' + remote + '\n' + personal + '\n' + compiled.slice(group.end);
}
