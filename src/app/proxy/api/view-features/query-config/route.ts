import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, graphForFile, personalSparqlUrl } from "@/lib/personal-sparql";
import { policyApprovalGraph } from "@/lib/policy-approval-store";

/** The Feature ribbon switches to a personal graph backed by a real FCT query.
 * Return graph locations, never a synthesized SPARQL result list. */
export async function POST(request: Request) {
  const unauthenticated = requirePersonalLogin(request);
  if (unauthenticated) return unauthenticated;
  try {
    const body = await request.json() as { feature?: unknown };
    const feature = body.feature;
    if (feature !== "policies" && feature !== "formats" && feature !== "transcoders")
      return NextResponse.json({ error: "Unsupported Features collection." }, { status: 400 });
    const graph = feature === "policies" ? policyApprovalGraph(request) :
      feature === "formats" ? getShapesGraph(request) : graphForFile("otc-transcoders.rdf", request);
    return NextResponse.json({ graph, personalEndpointUrl: personalSparqlUrl(request).toString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Feature graph discovery failed." }, { status: 502 });
  }
}
