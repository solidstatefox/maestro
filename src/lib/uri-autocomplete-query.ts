import { isRootUriOrPrefix } from "@/lib/root-uri-policy";
import { readUriAutocompleteSettings } from "@/lib/uri-autocomplete-settings";
import { buildVirtuosoFullTextExpression } from "@/lib/virtuoso-full-text";
/** Search the same indexed literal space used by FCT <text> (bif:contains).
 * The match yields URI identity plus a display label; rank is enforced by the
 * Virtuoso server, never approximated or replaced with alphabetical sorting.
 * The generic /sparql transport accepts only a bounded autocomplete priority
 * hint; all query semantics stay in this browser-owned builder. */
const MAX_PREFIX = 160;
const LABEL_PROPERTIES = [
  "http://www.w3.org/2000/01/rdf-schema#label",
  "http://www.w3.org/2004/02/skos/core#prefLabel",
  "http://xmlns.com/foaf/0.1/name",
  "https://schema.org/name",
  "http://schema.org/name",
  "http://purl.org/dc/terms/title",
  "http://purl.org/dc/elements/1.1/title",
  "http://www.w3.org/2006/vcard/ns#fn",
];
export function createRootUriAutocompleteQuery(prefix: string, addr: string, options = readUriAutocompleteSettings()): string | null {
  const text = prefix.trim();
  if (!addr.includes("@") || text.length < 1 || text.length > MAX_PREFIX || isRootUriOrPrefix(text) || /[\x00-\x1f<>"{}|^`\\]/.test(text)) return null;
  const endpoint = addr.slice(addr.indexOf("@") + 1);
  try { if (!["http:", "https:"].includes(new URL(endpoint).protocol)) return null; }
  catch { return null; }
  // Prefix-complete the last word so “Tim” also suggests “Timothy”.
  // This is the same indexed Virtuoso candidate generation as FCT <text>.
  const operand = buildVirtuosoFullTextExpression(`${text}*`);
  if (!operand) return null;
  const graph = addr.slice(0, addr.indexOf("@"));
  const properties = LABEL_PROPERTIES.map(uri => `<${uri}>`).join(", ");
  const triples = `?uri ?matchedPredicate ?label .
    ?label bif:contains ${JSON.stringify(operand)} .`;
  const graphClause = graph && graph !== "$ALL$" && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(graph)
    ? `GRAPH <${graph}> { ${triples} }` : triples;
  const limit = Math.max(1, Math.min(10, Math.trunc(options.limit)));
  // Keep the existing proxy autocomplete priority contract: maximum ten rows,
  // a bounded substring check on the already indexed candidates, and rank.
  // No rankless fallback: an unsupported IRI_RANK is a visible error.
  const order = "ORDER BY DESC (<LONG::IRI_RANK> (?uri))";
  return `SELECT DISTINCT ?uri ?label WHERE {
    ${graphClause}
    FILTER(?matchedPredicate IN (${properties}))
    FILTER(isIRI(?uri) && isLiteral(?label))
    FILTER(CONTAINS(LCASE(STR(?label)), ${JSON.stringify(text.toLowerCase())}))
  } ${order} LIMIT ${limit}`;
}
