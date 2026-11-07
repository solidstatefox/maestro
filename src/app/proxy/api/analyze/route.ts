import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { ensureShapesGraphSeeded, getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";

const MA = "gttp://ggg.maestro.ecosys/ns/analyze#";
type Binding = { value?: string };
type Row = Record<string, Binding>;
export async function GET(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    await ensureShapesGraphSeeded(request);
    const graph = getShapesGraph(request);
    const query = `PREFIX ma: <${MA}> PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT ?uri ?label ?icon ?stylesheet ?order WHERE {
        GRAPH <${graph}> {
          ?uri a ma:Analysis ; rdfs:label ?label ; ma:lucideIcon ?icon ; ma:stylesheet/rdf:value ?stylesheet .
          OPTIONAL { ?uri ma:order ?order }
        }
      } ORDER BY ?order ?label LIMIT 50`;
    const payload = await queryPersonalSparql(query, 20000, request);
    const items = (payload.results?.bindings ?? [] as Row[]).map((row: Row) => ({
      uri: row.uri?.value ?? "", label: row.label?.value ?? "", icon: row.icon?.value ?? "",
      stylesheet: row.stylesheet?.value ?? "", order: Number(row.order?.value ?? 100),
    })).filter((row: { uri: string; stylesheet: string }) => row.uri && row.stylesheet);
    return NextResponse.json({ analyses: items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis discovery failed." }, { status: 500 });
  }
}
