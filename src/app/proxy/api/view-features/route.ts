import { NextResponse } from "next/server";
import { discoverFeatureSuperclasses } from "@/lib/feature-superclasses";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, graphForFile, queryPersonalSparql } from "@/lib/personal-sparql";

type Row = Record<string, { type?: string; value?: string }>;
const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length < 4096;
const rowValue = (row: Row, key: string) => row[key]?.value ?? "";

/** Feature lookup is read-only. It never invokes graph seeding or changes the current FCT query. */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body = await request.json() as { feature?: string; classes?: unknown; queryXml?: unknown };
    if (!(["policies", "formats", "transcoders"] as string[]).includes(body.feature ?? ""))
      return NextResponse.json({ error: "Unsupported feature" }, { status: 400 });
    if (typeof body.queryXml !== "string" || body.queryXml.length > 200000 || !body.queryXml.includes("<query"))
      return NextResponse.json({ error: "A cloned FCT query is required" }, { status: 400 });
    const classes = Array.isArray(body.classes) ? [...new Set(body.classes.filter((value): value is string => typeof value === "string" && safeIri(value)))].slice(0, 50) : [];
    if (!classes.length) return NextResponse.json({ items: [] });
    const inheritedClasses = await discoverFeatureSuperclasses(body.queryXml, classes, request);
    const values = inheritedClasses.map((iri) => `<${iri}>`).join(" ");
    const shapesGraph = getShapesGraph(request);
    const otcGraph = graphForFile("otc-transcoders.rdf", request);
    const common = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX sh: <http://www.w3.org/ns/shacl#>\nPREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX dct: <http://purl.org/dc/terms/>\nPREFIX otc: <gttp://ggg.openlink.sw/nlp/transcoder#>\n`;
    const query = body.feature === "policies" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail WHERE { GRAPH <${shapesGraph}> {
  ?item a mui:ClassPolicy ; mui:forClass ?target ; mui:recordShape ?detail ; mui:widget ?widgetClass .
  FILTER EXISTS { ?detail ?shapePredicate ?shapeValue }
  OPTIONAL { ?item rdfs:label ?label }
  OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
} } LIMIT 150` : body.feature === "formats" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail WHERE { GRAPH <${shapesGraph}> {
  ?policy a mui:ClassPolicy ; mui:forClass ?target ; mui:recordShape ?shape ; mui:widget ?widgetClass .
  ?provider a mui:Provider ; mui:widget ?item ; mui:accepts ?inputShape .
  ?inputShape a mui:InputShape ; sh:class ?target .
  ?item rdf:type/rdfs:subClassOf* ?widgetClass .
  OPTIONAL { ?item rdfs:label ?label }
  OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
  OPTIONAL { ?item mui:mediaType ?detail }
} } LIMIT 150` : `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail WHERE {
  GRAPH <${otcGraph}> {
    ?item a otc:Transcoder, mui:Provider ; mui:accepts ?inputShape ; mui:widget ?widget .
    ?inputShape a mui:InputShape .
    ?widget a mui:RdfTranscoderWidget .
    OPTIONAL { ?item (rdfs:label|dct:title) ?label }
    OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
    OPTIONAL { ?item otc:outputShape ?detail }
    OPTIONAL { ?inputShape sh:class ?target }
  }
  VALUES ?target { ${values} }
} LIMIT 150`;
    const result = await queryPersonalSparql(query, 12000, request);
    const allowed = new Set(inheritedClasses);
    const items = [...new Map(((result.results?.bindings ?? []) as Row[]).map((row) => ({
      uri: rowValue(row, "item"), label: rowValue(row, "label") || rowValue(row, "item").split(/[\/#]/).pop() || "Untitled",
      description: rowValue(row, "description"), target: rowValue(row, "target"), detail: rowValue(row, "detail"),
    })).filter((item) => item.uri && (body.feature === "transcoders" || allowed.has(item.target))).map((item) => [`${item.uri}\u0000${item.target}`, item])).values()];
    return NextResponse.json({ items, resolvedClasses: inheritedClasses }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Feature lookup failed" }, { status: 502 });
  }
}
