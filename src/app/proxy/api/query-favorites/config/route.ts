import { NextResponse } from "next/server";
import { getHistoryGraph, personalSparqlUrl } from "@/lib/personal-sparql";

/** Return History graph and personal SPARQL endpoint configuration without requiring a saved FCT query. */
export async function GET() {
  try {
    return NextResponse.json({
      historyGraph: getHistoryGraph(),
      personalEndpointUrl: personalSparqlUrl().toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the query History configuration.";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
