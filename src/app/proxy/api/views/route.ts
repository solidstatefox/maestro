import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";

type Row = Record<string, { value?: string }>;
const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length <= 4096;

export async function POST(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    const body = await request.json() as { classes?: unknown };
    const classes = Array.isArray(body.classes) ? [...new Set(body.classes.filter((value): value is string => typeof value === "string" && safeIri(value)))].slice(0, 50) : [];
    if (!classes.length) return NextResponse.json({ views: [] }, { headers: { "Cache-Control": "no-store" } });
    const graph = getShapesGraph(request);
    const query = `PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?policy ?class ?label ?template ?stylesheet WHERE {
  GRAPH <${graph}> {
    VALUES ?class { ${classes.map((iri) => `<${iri}>`).join(" ")} }
    ?policy sh:targetClass ?class ; mui:widget ?widgetClass .
    ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
    ?inputShape a mui:InputShape ; sh:class ?class .
    ?template rdf:type/rdfs:subClassOf* ?widgetClass .
    OPTIONAL { ?policy rdfs:label ?label }
    ?template (rdf:value|mui:templateContent) ?stylesheet .
    FILTER(CONTAINS(STR(?stylesheet), 'xsl:stylesheet') || CONTAINS(STR(?stylesheet), 'xsl:transform'))
  }
} ORDER BY ?label LIMIT 50`;
    const payload = await queryPersonalSparql(query, 10000, request);
    const views = ((payload.results?.bindings ?? []) as Row[]).map((row) => ({
      uri: row.policy?.value ?? "", matchedClass: row.class?.value ?? "",
      label: row.label?.value || row.policy?.value || "View", template: row.template?.value ?? "",
      stylesheet: row.stylesheet?.value ?? "",
    })).filter((v) => v.uri && v.template && v.stylesheet && v.stylesheet.length <= 250000);
    return NextResponse.json({ views }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "View discovery failed." }, { status: 500 });
  }
}
