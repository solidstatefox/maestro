import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, queryPersonalSparql, waitForPersonalGraphSeed } from "@/lib/personal-sparql";

/** The map isn't a built-in Perspective choice: discover the provider and its
 * XSLT from the authenticated personal shapes graph. */
export async function POST(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    await waitForPersonalGraphSeed(request);
    const shapes = getShapesGraph(request);
    const query = `PREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?provider ?label ?icon ?stylesheet WHERE { GRAPH <${shapes}> {
  ?provider a mui:Provider ; mui:perspectiveKind "map" ; mui:widget ?widget .
  ?widget a mui:PerspectiveWidget ; (mui:templateContent|rdf:value) ?stylesheet .
  OPTIONAL { ?provider rdfs:label ?label }
  OPTIONAL { ?provider mui:icon ?icon }
} } LIMIT 1`;
    const result = await queryPersonalSparql(query, 12000, request);
    const row = result.results?.bindings?.[0];
    const uri = row?.provider?.value ?? "";
    const stylesheet = row?.stylesheet?.value ?? "";
    if (!uri || !stylesheet || stylesheet.length > 250000) return NextResponse.json({ provider: null }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ provider: { uri, label: row?.label?.value || "Map", kind: "map", icon: row?.icon?.value || "map-pin", stylesheet } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Map provider discovery failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
