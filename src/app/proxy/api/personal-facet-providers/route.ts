import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, getOntologyGraph, askPersonalSparql, queryPersonalSparql, waitForPersonalGraphSeed } from "@/lib/personal-sparql";

const validIri = (iri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri);

/** Discover all personal facet widget providers whose SHACL input paths occur
 * amongst the relationships at the live <view> scope (carrier and siblings). */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body = await request.json() as { properties?: unknown; timeoutMs?: unknown };
    const properties = Array.isArray(body.properties) ? [...new Set(body.properties.filter(
      (value): value is string => typeof value === "string" && validIri(value),
    ))].slice(0, 200) : [];
    if (!properties.length) return NextResponse.json({ providers: [] }, { headers: { "Cache-Control": "no-store" } });
    const timeoutMs = typeof body.timeoutMs === "number" && Number.isInteger(body.timeoutMs) && body.timeoutMs >= 0 && body.timeoutMs <= 120000 ? body.timeoutMs : 0;
    await waitForPersonalGraphSeed(request);
    const graph = getShapesGraph(request);
    const ontologyGraph = getOntologyGraph(request);
    const values = properties.map(value => `<${value}>`).join(" ");
    const where = `GRAPH <${graph}> { ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
      ?shape sh:path ?property . ?widget a mui:DateRangeFacetWidget .
      OPTIONAL { ?widget rdfs:label ?label } }
      VALUES ?property { ${values} }`;
    const prefixes = `PREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>
      PREFIX sh: <http://www.w3.org/ns/shacl#>
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;
    // ASK lets the client discover no-match scopes without requiring any UI surrogate.
    const existence = await askPersonalSparql(`${prefixes} ASK WHERE { ${where} }`, timeoutMs, request);
    if (!existence) return NextResponse.json({ providers: [] }, { headers: { "Cache-Control": "no-store" } });
    const result = await queryPersonalSparql(`${prefixes} SELECT DISTINCT ?provider ?property ?label ?range ?acceptedDatatype WHERE {
      ${where}
      OPTIONAL { GRAPH <${graph}> { ?shape sh:or/rdf:rest*/rdf:first/sh:datatype ?acceptedDatatype } }
      OPTIONAL { GRAPH <${ontologyGraph}> { ?property rdfs:range ?range } }
    } LIMIT 200`, timeoutMs, request);
    // SHACL's own accepted datatype alternatives gatekeep a declared range.
    // An undeclared range is allowed: actual values are screened by date-bucket
    // conversion so heterogeneous public RDF does not disable the facet.
    const eligible = (result.results?.bindings ?? []).filter(row => !row.range?.value ||
      (row.acceptedDatatype?.value && row.acceptedDatatype.value === row.range.value));
    const providers = [...new Map(eligible.map(row => ({
      uri: row.provider?.value ?? "", property: row.property?.value ?? "",
      label: row.label?.value ?? "Date/time range",
    })).filter(item => validIri(item.uri) && properties.includes(item.property))
      .map(item => [`${item.uri}|${item.property}`, item] as const)).values()];
    return NextResponse.json({ providers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Facet discovery failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
