import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query-api";

export const NATIVE_MAP_URI = "urn:maestro:perspective:map";
const GEO = "http://www.w3.org/2003/01/geo/wgs84_pos#";
const SCHEMA = ["http://schema.org/", "https://schema.org/"];
const GEORSS = "http://www.georss.org/georss/";
const GSP = "http://www.opengis.net/ont/geosparql#";
const pairs = [[GEO + "lat", GEO + "long"], ...SCHEMA.map(ns => [ns + "latitude", ns + "longitude"])];
const singletons = [GEORSS + "point", GEO + "lat_long", GSP + "asWKT", GSP + "hasGeometry"];
export const isGeoProperty = (uri: string) => pairs.some(pair => pair.includes(uri)) || singletons.includes(uri);
export function mapEligible(facets: string[]): boolean {
  const set = new Set(facets);
  return pairs.some(pair => pair.every(uri => set.has(uri))) || singletons.some(uri => set.has(uri));
}
export function currentFocusFacets(tree: FctQueryTree, discovered: string[] = []): string[] {
  const find = (node: FctQueryNode): FctQueryNode | null => {
    if (node.children.some(child => child.name === "view")) return node;
    for (const child of node.children) { const found = find(child); if (found) return found; }
    return null;
  };
  const focus = tree.children.some(node => node.name === "view") ? tree : tree.children.map(find).find(Boolean) ?? tree;
  return [...new Set([...discovered, ...focus.children.filter(n => (n.name === "property" || n.name === "property-of") && n.attributes.iri).map(n => n.attributes.iri)])];
}
/** Color-by is an explicit choice from the live query, not a list of
 * properties discovered by Configure. Include the view-bearing relationship
 * itself and its siblings (forward properties and reverse roles), never
 * ancestor breadcrumbs or unrelated descendants. */
export type MapColorFacet = { uri: string; label: string; direction: "forward" | "reverse"; key: string };
export function currentViewColorFacets(tree: FctQueryTree): MapColorFacet[] {
  const find = (siblings: FctQueryNode[]): FctQueryNode[] | null => {
    // The view may be directly in this scope (root view), or within a
    // property/role carrier. In the latter case, choose the carrier's siblings
    // rather than the children *inside* its relationship node.
    if (siblings.some(node => node.name === "view" || node.children.some(child => child.name === "view"))) return siblings;
    for (const node of siblings) { const found = find(node.children); if (found) return found; }
    return null;
  };
  const viewScope = find(tree.children) ?? [];
  const seen = new Set<string>();
  return viewScope.flatMap((node): MapColorFacet[] => {
    if ((node.name !== "property" && node.name !== "property-of") || !node.attributes.iri) return [];
    const direction = node.name === "property-of" ? "reverse" as const : "forward" as const;
    const uri = node.attributes.iri;
    const key = `${direction}|${uri}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ uri, direction, key, label: `${uri}${direction === "reverse" ? " of" : ""}` }];
  });
}

const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
/** Extract the FCT compiler's outer WHERE without bringing its paging along. */
function outerWhere(query: string): { prefix: string; body: string } {
  const match = /\bSELECT\b[\s\S]*?\bWHERE\s*\{/i.exec(query);
  if (!match || match.index === undefined) throw new Error("Map requires a SELECT FCT query.");
  const start = match.index + match[0].length - 1;
  let depth = 0, quote = false, escape = false, iri = false;
  for (let i = start; i < query.length; i++) {
    const c = query[i];
    if (quote) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quote = false; continue; }
    if (iri) { if (c === ">") iri = false; continue; }
    if (c === '"') { quote = true; continue; }
    if (c === "<" && /[A-Za-z]/.test(query[i + 1] ?? "")) { iri = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return { prefix: query.slice(0, match.index), body: query.slice(start + 1, i) };
  }
  throw new Error("Unclosed FCT WHERE clause.");
}
/**
 * Use the same FCT focus and bindings as Browse, not the current results page.
 * This identifies the unpaged focus population and locations. Color-by values
 * are retrieved subsequently through the same FCT list-values projection
 * used by the Results badges, for the exact mapped resource IDs.
 */
export function compileMapQuery(xml: string, colorBy: string): { sparql: string; timeoutMs: number } {
  if (colorBy && !validIri(colorBy)) throw new Error("Invalid Color by property.");
  const compiled = compileFctXmlToSparql(xml);
  const { prefix, body } = outerWhere(compiled.query);
  const focus = compiled.target;
  if (!/^\?[A-Za-z][A-Za-z0-9_]*$/.test(focus)) throw new Error("Map requires a bound resource focus.");
  const geoPatterns = [
    `<${GEO}lat> ?lat ; <${GEO}long> ?lng`,
    ...SCHEMA.map(ns => `<${ns}latitude> ?lat ; <${ns}longitude> ?lng`),
  ];
  const union = [
    ...geoPatterns.map(pattern => `{ ${focus} ${pattern} . }`),
    `{ ${focus} <${GEORSS}point> ?point . }`,
    `{ ${focus} <${GEO}lat_long> ?point . }`,
    `{ ${focus} <${GSP}asWKT> ?wkt . }`,
    `{ ${focus} <${GSP}hasGeometry>/<${GSP}asWKT> ?wkt . }`,
  ].join(" UNION ");
  // Marker Color-by values are supplied by the existing FCT list-values badge projection.
  const graphAddress = /\baddr\s*=\s*(["'])(.*?)\1/.exec(xml)?.[2]?.replace(/&amp;/g, "&") ?? "";
  const graph = graphAddress.includes("@") ? graphAddress.slice(0, graphAddress.indexOf("@")) : "";
  // Keep geo, label, and Color-by triples in the same selected named graph as
  // the FCT focus, rather than silently switching to the server default graph.
  const namedGraph = graph && graph !== "$ALL$" && validIri(graph);
  const values = `{ ${union} } OPTIONAL { ${focus} <http://www.w3.org/2000/01/rdf-schema#label> ?title . }`;
  const geoScope = namedGraph ? `GRAPH <${graph}> { ${values} }` : values;
  const sparql = `${prefix}SELECT DISTINCT (${focus} AS ?c1) ?lat ?lng ?point ?wkt ?title WHERE {
    { SELECT DISTINCT ${focus} WHERE { ${body} } }
    ${geoScope}
  } LIMIT 1000`;
  return { sparql, timeoutMs: compiled.timeoutMs };
}

export type MapRow = { uri: string; lat: number; lng: number; title: string; colorValue: string };
type Binding = { type?: string; value?: string };
export function readMapRows(bindings: Record<string, Binding>[]): MapRow[] {
  const points = new Map<string, MapRow>();
  for (const row of bindings) {
    const uri = row.c1?.value ?? "";
    if (!uri || points.has(uri)) continue;
    let lat = Number(row.lat?.value), lng = Number(row.lng?.value);
    if (!row.lat?.value || !row.lng?.value) {
      const text = row.point?.value?.trim();
      const wkt = row.wkt?.value?.trim();
      if (text) { const match = /^([+-]?[\d.]+)[,\s]+([+-]?[\d.]+)$/.exec(text); if (match) { lat = Number(match[1]); lng = Number(match[2]); } }
      else if (wkt) { const match = /(?:^|>)\s*POINT\s*\(\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*\)/i.exec(wkt); if (match) { lng = Number(match[1]); lat = Number(match[2]); } }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    points.set(uri, { uri, lat, lng, colorValue: row.colorValue?.value ?? "", title: row.title?.value ?? uri });
  }
  return [...points.values()];
}
