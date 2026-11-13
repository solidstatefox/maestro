import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { readPolicyApprovals, discoverPolicyApprovals } from "@/lib/policy-approval-store";
import { matchShaclProviders } from "@/lib/shacl-provider-matching";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";
import { COERCIBLE_NUMERIC_MODE, NUMERIC_LEXICAL_PATTERN, NUMERIC_FACET_PROJECTION } from "@/lib/virtuoso-numeric-coercion";
import { getShapesGraph, getOntologyGraph, queryPersonalSparql, waitForPersonalGraphSeed } from "@/lib/personal-sparql";

const validIri = (iri: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(iri);

/** Discover all personal facet widget providers whose SHACL input paths occur
 * amongst the relationships at the live <view> scope (carrier and siblings). */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body = await request.json() as { properties?: unknown; queryXml?: unknown; datatypeEvidence?: unknown; timeoutMs?: unknown };
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
    // The SELECT below is already an existence test and carries the bindings
    // required to render the widget. A separate ASK doubled the query workload.
    // Shape conformance itself uses the generic SHACL validation service.
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
    // The numeric widget is property-agnostic: SHACL declares accepted literal
    // datatypes. A provider can inject aggregate projections into the *same*
    // scalar count query graph, not a hand-written separate SPARQL query.
    const numeric = await queryPersonalSparql(`${prefixes} SELECT DISTINCT ?provider ?aggregate ?expression ?alias ?subjectSlot ?predicateSlot ?objectSlot ?coercion ?lexicalPattern WHERE {
      GRAPH <${graph}> {
        ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget ;
                  mui:countProjection ?projection ; mui:countTriple ?triple .
        ?widget a mui:NumericRangeFacetWidget .
        OPTIONAL { ?provider mui:numericCoercion ?coercion ; mui:numericPattern ?lexicalPattern }
        ?projection mui:aggregate ?aggregate ; mui:expression ?expression ; mui:alias ?alias .
        ?triple mui:subjectSlot ?subjectSlot ; mui:predicateSlot ?predicateSlot ; mui:objectSlot ?objectSlot .
        ?shape a mui:InputShape .
        FILTER EXISTS { ?shape sh:property/sh:qualifiedValueShape/sh:in/rdf:rest*/rdf:first ?numericDatatype .
          FILTER (?numericDatatype IN (<http://www.w3.org/2001/XMLSchema#integer>,
            <http://www.w3.org/2001/XMLSchema#decimal>, <http://www.w3.org/2001/XMLSchema#double>,
            <http://www.w3.org/2001/XMLSchema#float>)) }
      }
    } LIMIT 20`, timeoutMs, request);
    const numericByProvider = new Map<string, { uri: string; projections: Array<{ aggregate: "MIN" | "MAX" | "AVG" | "SUM"; expression: "xsd:decimal(?facetValue)" | typeof NUMERIC_FACET_PROJECTION; alias: string }> }>();
    for (const row of numeric.results?.bindings ?? []) {
      const uri = row.provider?.value ?? "";
      const aggregate = row.aggregate?.value ?? "";
      const expression = row.expression?.value ?? "";
      const alias = row.alias?.value ?? "";
      const coercible = row.coercion?.value === COERCIBLE_NUMERIC_MODE && row.lexicalPattern?.value === NUMERIC_LEXICAL_PATTERN;
      // Do not interpolate arbitrary provider-supplied SPARQL or regex. The
      // provider names a supported strategy; the compiler owns its expansion.
      if (!validIri(uri) || !["MIN", "MAX", "AVG", "SUM"].includes(aggregate) ||
          !(coercible ? expression === NUMERIC_FACET_PROJECTION : expression === "xsd:decimal(?facetValue)") ||
          !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(alias) ||
          row.subjectSlot?.value !== "view" || row.predicateSlot?.value !== "facetProperty" || row.objectSlot?.value !== "facetValue") continue;
      if (!numericByProvider.has(uri)) numericByProvider.set(uri, { uri, projections: [] });
      numericByProvider.get(uri)!.projections.push({ aggregate: aggregate as "MIN" | "MAX" | "AVG" | "SUM", expression: coercible ? NUMERIC_FACET_PROJECTION : "xsd:decimal(?facetValue)", alias });
    }
    const discoveredNumeric = [...numericByProvider.values()].filter(provider =>
      provider.projections.some(projection => projection.alias === "min") &&
      provider.projections.some(projection => projection.alias === "max"));
    // The compiler supplies all-population datatype evidence, never a slice of
    // displayed facet values. SHACL (not an ad-hoc numeric regex in React)
    // determines whether the Numeric facet provider accepts this context.
    const evidence = body.datatypeEvidence && typeof body.datatypeEvidence === "object" && !Array.isArray(body.datatypeEvidence)
      ? body.datatypeEvidence as Record<string, unknown> : {};
    if (discoveredNumeric.length && typeof body.queryXml === "string" && body.queryXml.length <= 200000 && body.queryXml.includes("<query")) {
      for (const property of properties) {
        const datatypes = Array.isArray(evidence[property]) ? [...new Set((evidence[property] as unknown[])
          .filter((value): value is string => typeof value === "string" && validIri(value)))].slice(0, 100) : [];
        if (!datatypes.length) continue;
        const focus = `urn:maestro:facet:${encodeURIComponent(property)}`;
        const result = await matchShaclProviders(request, focus, datatypes.map(datatype => ({
          subject: focus, predicate: "gttp://ggg.maestro.ecosys/ns/ui#inferredDatatype",
          object: datatype, objectType: "uri" as const,
        })), { widgetType: "gttp://ggg.maestro.ecosys/ns/ui#NumericRangeFacetWidget",
          component: UI_COMPONENT.personalPane, queryXml: body.queryXml, discover: true });
        if (result.failures.length) throw new Error(`SHACL provider validation failed: ${result.failures[0].error}`);
      }
    }
    // Matching a date facet must discover its provider as Pending, just as
    // the numeric SHACL matcher does. Neither kind may run without Approved.
    if (providers.length && typeof body.queryXml === "string" && body.queryXml.length <= 200000 && body.queryXml.includes("<query")) {
      await discoverPolicyApprovals(providers.map(provider => provider.uri), {
        component: UI_COMPONENT.personalPane, queryXml: body.queryXml,
      }, request);
    }
    const approvals = await readPolicyApprovals([
      ...providers.map(provider => provider.uri), ...discoveredNumeric.map(provider => provider.uri),
    ], request);
    const approved = new Set(approvals.filter(entry => entry.status === "Approved").map(entry => entry.uri));
    return NextResponse.json({ providers: providers.filter(provider => approved.has(provider.uri)), numericProviders: discoveredNumeric.filter(provider => approved.has(provider.uri)) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Facet discovery failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
