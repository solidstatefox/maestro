import { isRootUriOrPrefix } from "@/lib/root-uri-policy";
import { readUriAutocompleteSettings } from "@/lib/uri-autocomplete-settings";
import { buildVirtuosoFullTextExpression } from "@/lib/virtuoso-full-text";
/** Search the same indexed literal space used by FCT <text> (bif:contains).
 * The match yields URI identity plus a display label; rank is enforced by the
 * Virtuoso server, never approximated or replaced with alphabetical sorting.
 * The generic /sparql transport accepts only a bounded autocomplete priority
 * hint; all query semantics stay in this browser-owned builder. */
const MAX_PREFIX = 160;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const validIri = (raw: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(raw);

/** A single ranked, indexed signal-high query and optional class enrichment.
 * The inner SELECT fixes the TOP N distinct *resource URIs* BEFORE the class
 * join: many rdf:types can never consume suggestions or alter ranking.
 * Labels use FCT signal-high's exact predicate + case-insensitive lexical
 * equality, with bif:contains as the indexed candidate generator. No prefix
 * wildcard or independent substring/fuzzy relevance tier is introduced.
 * The UI's selected signal-high label predicates are passed explicitly.
 * Language-neutral/typed values are never discarded merely for lacking a
 * language tag; the existing FCT text-query matching semantics are retained.
 */
export function createRootUriAutocompleteQuery(
  input: string,
  addr: string,
  options = readUriAutocompleteSettings(),
  propertyUris: readonly string[] = [RDFS_LABEL],
): string | null {
  const text = input.trim();
  if (!addr.includes("@") || text.length < 1 || text.length > MAX_PREFIX ||
      isRootUriOrPrefix(text) || /[\x00-\x1f<>"{}|^`\\]/.test(text)) return null;
  const endpoint = addr.slice(addr.indexOf("@") + 1);
  try { if (!["http:", "https:"].includes(new URL(endpoint).protocol)) return null; }
  catch { return null; }
  const properties = [...new Set(propertyUris)].filter(validIri);
  if (!properties.length || properties.length !== new Set(propertyUris).size) return null;
  const operand = buildVirtuosoFullTextExpression(text);
  if (!operand) return null;
  const limit = Math.max(1, Math.min(10, Math.trunc(options.limit)));
  const graph = addr.slice(0, addr.indexOf("@"));
  const scope = validIri(graph) && graph !== "$ALL$" ? graph : null;
  const triple = `?uri ?matchedPredicate ?matchedLabel .
      ?matchedLabel bif:contains ${JSON.stringify(operand)} .`;
  const candidate = scope ? `GRAPH <${scope}> { ${triple} }` : triple;
  const typeTriple = `?uri <${RDF_TYPE}> ?type .`;
  const types = scope ? `GRAPH <${scope}> { ${typeTriple} }` : typeTriple;
  const subClassTriples = `?uri <${RDF_TYPE}> ?moreSpecificType .
        ?moreSpecificType <${RDFS_SUBCLASS}>+ ?type .`;
  const subClasses = scope ? `GRAPH <${scope}> { ${subClassTriples} }` : subClassTriples;
  const allowed = properties.map(uri => `<${uri}>`).join(", ");
  return `SELECT ?uri ?label ?type WHERE {
    {
      SELECT ?uri (SAMPLE(?matchedLabel) AS ?label) WHERE {
        ${candidate}
        FILTER(?matchedPredicate IN (${allowed}))
        FILTER(isIRI(?uri) && isLiteral(?matchedLabel))
        FILTER(LCASE(STR(?matchedLabel)) = ${JSON.stringify(text.toLowerCase())})
      }
      GROUP BY ?uri
      ORDER BY DESC (<LONG::IRI_RANK> (?uri)) ASC(STR(?uri))
      LIMIT ${limit}
    }
    OPTIONAL {
      ${types}
      FILTER(isIRI(?type))
      FILTER NOT EXISTS {
        ${subClasses}
        FILTER(?moreSpecificType != ?type)
      }
    }
  }
  ORDER BY DESC (<LONG::IRI_RANK> (?uri)) ASC(STR(?uri)) ASC(STR(?type))`;
}
