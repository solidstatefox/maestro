/** Optional, bounded rdf:type enrichment for already-ranked URI suggestions.
 * A class that is an ancestor of another asserted class is excluded when the
 * endpoint exposes rdfs:subClassOf hierarchy edges. The ranking SELECT remains
 * the sole authority on suggestion order. No inference about class depth is
 * made when the endpoint does not publish a subclass hierarchy. */
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const valid = (uri: string) => uri.length > 0 && uri.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(uri);

export function createAutocompleteTypeQuery(uris: string[], addr: string): string | null {
  const subjects = [...new Set(uris.filter(valid))].slice(0, 10);
  if (!subjects.length || subjects.some(uri=>!valid(uri))) return null;
  const graph = addr.slice(0, addr.indexOf('@'));
  const triple = `?uri <${RDF_TYPE}> ?type .`;
  const scope = valid(graph) && graph !== '$ALL$' ? `GRAPH <${graph}> { ${triple} }` : triple;
  const candidates = subjects.map(uri=>`<${uri}>`).join(' ');
  // The outer bound only enriches the already-ranked top ten resources.
  // The NOT EXISTS branch removes an asserted superclass if a strictly more
  // specific asserted type has an observable subClassOf+ chain to it.
  return `SELECT DISTINCT ?uri ?type WHERE {
    VALUES ?uri { ${candidates} }
    ${scope}
    FILTER(isIRI(?type))
    FILTER NOT EXISTS {
      ?uri <${RDF_TYPE}> ?moreSpecificType .
      ?moreSpecificType <${RDFS_SUBCLASS}>+ ?type .
      FILTER(?moreSpecificType != ?type)
    }
  } ORDER BY ?uri ?type LIMIT 150`;
}

export type AutocompleteTypeRow = {uri?: {type?: string;value?: string};type?:{type?: string;value?: string}};
export function selectAutocompleteTypes(rows: AutocompleteTypeRow[], orderedUris: string[]): Map<string,string> {
  const allowed = new Set(orderedUris);
  const chosen = new Map<string,string>();
  for (const row of rows) {
    const uri=row.uri?.value??'',type=row.type?.value??'';
    if (!allowed.has(uri) || row.type?.type !== 'uri' || !valid(type)) continue;
    const previous=chosen.get(uri);
    if (!previous || type.localeCompare(previous) < 0) chosen.set(uri,type);
  }
  return chosen;
}
