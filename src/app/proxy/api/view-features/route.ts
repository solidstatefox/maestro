import { NextResponse } from "next/server";
import { toLabel } from "@/lib/uri-labels";
import { discoverFeatureSuperclasses } from "@/lib/feature-superclasses";
import { queryGraphPolicies } from "@/lib/policy-graph-catalog";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, graphForFile, queryPersonalSparql } from "@/lib/personal-sparql";

type Row = Record<string, { type?: string; value?: string }>;
const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length < 4096;
const rowValue = (row: Row, key: string) => row[key]?.value ?? "";


/** Human-readable activation prerequisites in familiar RDF QNames. */
function qname(iri: string): string {
  const namespaces: Array<[string, string]> = [
    ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
    ["rdfs", "http://www.w3.org/2000/01/rdf-schema#"],
    ["sh", "http://www.w3.org/ns/shacl#"],
    ["mui", "gttp://ggg.maestro.ecosys/ns/ui#"],
    ["dbo", "http://dbpedia.org/ontology/"],
    ["dbp", "http://dbpedia.org/property/"],
    ["dbr", "http://dbpedia.org/resource/"],
    ["schema", "https://schema.org/"],
    ["schema", "http://schema.org/"],
    ["dcterms", "http://purl.org/dc/terms/"],
    ["bookmark", "http://www.w3.org/2002/01/bookmark#"],
    ["otc", "gttp://ggg.openlink.sw/nlp/transcoder#"],
    ["foaf", "http://xmlns.com/foaf/0.1/"],
    ["skos", "http://www.w3.org/2004/02/skos/core#"],
    ["owl", "http://www.w3.org/2002/07/owl#"],
    ["vfct", "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#"],
  ];
  for (const [prefix, ns] of namespaces) if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
  const hash = iri.lastIndexOf("#"), slash = iri.lastIndexOf("/");
  return `ns:${iri.slice(Math.max(hash, slash) + 1) || "Resource"}`;
}
function activationText(target: string, detail: string, kind: string): string {
  if (kind === "policies") {
    if (target) return `Activation: browse a resource whose rdf:type is ${qname(target)} (or its subclass), then approve the discovered policy in View > Features > Policies. ${detail ? `Validation uses ${qname(detail)}.` : ""}`.trim();
    return "Activation: the provider's sh:class or SHACL eligibility condition must match the browsing context; then approve the discovered policy.";
  }
  if (kind === "formats") return `Activation: approve the supplying mui:Provider policy, then select its formatter for a matching${target ? ` ${qname(target)}` : ""} resource.`;
  return `Activation: supply an input matching the transcoder's mui:InputShape${target ? ` (${qname(target)})` : ""} and select the provider.`;
}

/** Feature lookup is read-only. It never invokes graph seeding or changes the current FCT query. */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body = await request.json() as { feature?: string; classes?: unknown; queryXml?: unknown; featureQuery?: unknown };
    if (!(["policies", "formats", "transcoders"] as string[]).includes(body.feature ?? ""))
      return NextResponse.json({ error: "Unsupported feature" }, { status: 400 });
    if (typeof body.queryXml !== "string" || body.queryXml.length > 200000 || !body.queryXml.includes("<query"))
      return NextResponse.json({ error: "A cloned FCT query is required" }, { status: 400 });
    const classes = Array.isArray(body.classes) ? [...new Set(body.classes.filter((value): value is string => typeof value === "string" && safeIri(value)))].slice(0, 50) : [];
    // Everything at the root is a legitimate policy-library query. The
    // bookmark/provider XSLT determines whether approval actions are available.
    const fctBody = body.queryXml.replace(/^\s*<\?xml[^>]*>/, "");
    // The FCT Results pane owns feature membership; this endpoint is metadata
    // enrichment only when featureQuery=true. Never substitute its SPARQL rows
    // for the resource set enumerated by the live FCT query.
    const fctPopulation = body.featureQuery === true;
    const rootEverything = fctPopulation || (!classes.length &&
      !/<(?:property|property-of|class|status|value)\b/i.test(fctBody) &&
      !/<text\b[^>]*>\s*[^\s<]/i.test(fctBody));
    if (!classes.length && !rootEverything) return NextResponse.json({ items: [] });
    if (rootEverything && !fctPopulation && body.feature === "policies") {
      // Root Everything enumerates policies in the FCT graph, not a fixed
      // personal shapes graph that might describe a different graph address.
      const items = await queryGraphPolicies(body.queryXml, request);
      return NextResponse.json({ items: items.map(item => ({ ...item, activation: activationText(item.target, item.detail, body.feature!) })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const inheritedClasses = classes.length ? await discoverFeatureSuperclasses(body.queryXml, classes, request) : [];
    const values = inheritedClasses.map((iri) => `<${iri}>`).join(" ");
    const shapesGraph = getShapesGraph(request);
    const otcGraph = graphForFile("otc-transcoders.rdf", request);
    const common = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX sh: <http://www.w3.org/ns/shacl#>\nPREFIX mui: <gttp://ggg.maestro.ecosys/ns/ui#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX dct: <http://purl.org/dc/terms/>\nPREFIX otc: <gttp://ggg.openlink.sw/nlp/transcoder#>\n`;
    
    const query = body.feature === "policies" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail ?targetLabel ?detailLabel ?author WHERE { GRAPH <${shapesGraph}> {
  { ?item a mui:ClassPolicy ; mui:forClass ?target ; mui:recordShape ?detail }
  UNION { ?item a mui:Provider . OPTIONAL { ?item mui:accepts/sh:class ?target } }
  OPTIONAL { ?item rdfs:label ?label }
  OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
  OPTIONAL { ?item <https://schema.org/author> ?author }
  OPTIONAL { ?target rdfs:label ?targetLabel }
  OPTIONAL { ?detail rdfs:label ?detailLabel }
} } LIMIT 1000` : body.feature === "formats" ? `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail ?author WHERE { GRAPH <${shapesGraph}> {
  ${rootEverything ? `?provider a mui:Provider ; mui:widget ?item . OPTIONAL { ?provider mui:accepts/sh:class ?target }` : `?policy a mui:ClassPolicy ; mui:forClass ?target ; mui:recordShape ?shape ; mui:widget ?widgetClass .
  ?provider a mui:Provider ; mui:widget ?item ; mui:accepts ?inputShape .
  ?inputShape a mui:InputShape ; sh:class ?target .
  ?item rdf:type/rdfs:subClassOf* ?widgetClass .`}
  OPTIONAL { ?item rdfs:label ?label }
  OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
  OPTIONAL { ?item <https://schema.org/author> ?author }
  OPTIONAL { ?item mui:mediaType ?detail }
} } LIMIT 150` : `${common}
SELECT DISTINCT ?item ?label ?description ?target ?detail ?author WHERE {
  GRAPH <${otcGraph}> {
    ?item a otc:Transcoder, mui:Provider ; mui:accepts ?inputShape ; mui:widget ?widget .
    ?inputShape a mui:InputShape .
    ?widget a mui:RdfTranscoderWidget .
    OPTIONAL { ?item (rdfs:label|dct:title) ?label }
    OPTIONAL { ?item (dct:description|rdfs:comment) ?description }
  OPTIONAL { ?item <https://schema.org/author> ?author }
    OPTIONAL { ?item otc:outputShape ?detail }
    OPTIONAL { ?inputShape sh:class ?target }
  }
  ${rootEverything ? "" : `VALUES ?target { ${values} }`}
} LIMIT 150`;
    const result = await queryPersonalSparql(query, 12000, request);
    const allowed = new Set(inheritedClasses);
    const items = [...new Map(((result.results?.bindings ?? []) as Row[]).map((row) => ({
      uri: rowValue(row, "item"), label: rowValue(row, "label") || rowValue(row, "item").split(/[\/#]/).pop() || "Untitled",
      description: rowValue(row, "description"), author: rowValue(row, "author"), target: rowValue(row, "target"), detail: rowValue(row, "detail"),
      targetLabel: rowValue(row, "targetLabel") || toLabel(rowValue(row, "target")),
      detailLabel: rowValue(row, "detailLabel") || toLabel(rowValue(row, "detail")),
    })).filter((item) => item.uri && (rootEverything || body.feature === "transcoders" || allowed.has(item.target))).map((item) => [`${item.uri}\u0000${item.target}`, item])).values()];
    return NextResponse.json({ items: items.map(item => ({ ...item, activation: activationText(item.target, item.detail, body.feature!) })), resolvedClasses: inheritedClasses }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Feature lookup failed" }, { status: 502 });
  }
}
