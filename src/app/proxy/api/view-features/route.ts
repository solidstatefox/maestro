import { NextResponse } from "next/server";
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
    // Prevent the supplied class bindings from diverging from the cloned authoritative query.
    if (classes.some((iri) => !(body.queryXml as string).includes(iri))) {
  return NextResponse.json(
    { error: "Class is absent from query context" },
    { status: 400 }
  );
}
    const values = classes.map((iri) => `<${iri}>`).join(" ");
    const shapesGraph = getShapesGraph(request);
    const otcGraph = graphForFile("otc-transcoders.rdf", request);
    const common = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX sh: <http://www.w3.org/ns/shacl#>\nPREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX dct: <http://purl.org/dc/terms/>\nPREFIX otc: <gttp://ggg.openlink.sw/nlp/transcoder#>\n`;
    const query = body.feature === "policies" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail WHERE { GRAPH <${shapesGraph}> {
  VALUES ?target { ${values} }
  { ?item sh:targetClass ?target } UNION { ?item mui:forClass ?target }
  OPTIONAL { ?item rdfs:label ?label }
  OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
  OPTIONAL { ?item (mui:recordShape|sh:property) ?detail }
} } LIMIT 150` : body.feature === "formats" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail WHERE { GRAPH <${shapesGraph}> {
  VALUES ?target { ${values} }
  ?policy (sh:targetClass|mui:forClass) ?target ; mui:widget ?widgetClass .
  ?provider a mui:Provider ; mui:accepts ?inputShape ; mui:widget ?item .
  ?inputShape a mui:InputShape .
  ?inputShape sh:class ?target .
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
    const items = [...new Map(((result.results?.bindings ?? []) as Row[]).map((row) => ({
      uri: rowValue(row, "item"), label: rowValue(row, "label") || rowValue(row, "item").split(/[\/#]/).pop() || "Untitled",
      description: rowValue(row, "description"), target: rowValue(row, "target"), detail: rowValue(row, "detail"),
    })).filter((item) => item.uri).map((item) => [item.uri, item])).values()];
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Feature lookup failed" }, { status: 502 });
  }
}
