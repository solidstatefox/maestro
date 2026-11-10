import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, graphForFile, queryPersonalSparql } from "@/lib/personal-sparql";

type Term = { type?: string; value?: string; datatype?: string; "xml:lang"?: string };
type Row = Record<string, Term | undefined>;
const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value) && value.length < 4096;
const iri = (value: string) => `<${value}>`;
const escapeLiteral = (value: string) => JSON.stringify(value);
function term(value: Term | undefined): string {
  if (!value) return '""';
  if (value.type === "uri") return iri(value.value || "");
  if (value.type === "bnode") return `_:${(value.value || "b").replace(/[^A-Za-z0-9_]/g, "_")}`;
  return `${escapeLiteral(value.value || "")}${value["xml:lang"] ? `@${value["xml:lang"]}` : value.datatype ? `^^${iri(value.datatype)}` : ""}`;
}
/** Fetch the actual stored RDF and XSLT for a Features result, not its HTML preview. */
export async function POST(request: Request) {
  const auth = requirePersonalLogin(request);
  if (auth) return auth;
  try {
    const body: unknown = await request.json();
    const { feature, uri } = body && typeof body === "object" ? body as { feature?: unknown; uri?: unknown } : {};
    if (!["policies", "formats", "transcoders"].includes(String(feature)) || typeof uri !== "string" || !validIri(uri))
      return NextResponse.json({ error: "Invalid feature or resource URI" }, { status: 400 });
    const graph = feature === "transcoders" ? graphForFile("otc-transcoders.rdf", request) : getShapesGraph(request);
    // Retrieve directly related shape/provider nodes as well as the selected resource.
    const query = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?s ?p ?o WHERE { GRAPH ${iri(graph)} {
      { BIND(${iri(uri)} AS ?s) ?s ?p ?o }
      UNION { ${iri(uri)} ?link ?s . FILTER(?link IN (<gttp://ggg.maestro.ecosys/ns/ui#recordShape>, <gttp://ggg.maestro.ecosys/ns/ui#widget>, <gttp://ggg.maestro.ecosys/ns/ui#accepts>, <http://www.w3.org/ns/shacl#property>)) ?s ?p ?o }
      UNION { ?s ?link ${iri(uri)} . FILTER(?link IN (<gttp://ggg.maestro.ecosys/ns/ui#widget>, <gttp://ggg.maestro.ecosys/ns/ui#recordShape>)) ?s ?p ?o }
    }} LIMIT 800`;
    const result = await queryPersonalSparql(query, 12000, request);
    const rows = (result.results?.bindings ?? []) as Row[];
    const rdf = rows.map((row) => `${term(row.s)} ${term(row.p)} ${term(row.o)} .`).join("\n");
    const xmlLiterals = rows.filter((row) => row.o?.type === "literal" && /<\?xml|<xsl:(?:stylesheet|transform)|<rdf:RDF/.test(row.o.value ?? ""));
    const xslt = xmlLiterals.find((row) => /<xsl:(?:stylesheet|transform)/.test(row.o?.value ?? ""))?.o?.value ?? "";
    const xml = xmlLiterals.find((row) => /<rdf:RDF|<\?xml/.test(row.o?.value ?? "") && !/<xsl:/.test(row.o?.value ?? ""))?.o?.value ?? "";
    return NextResponse.json({ rdf, xslt, xml }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not retrieve feature source" }, { status: 502 });
  }
}
