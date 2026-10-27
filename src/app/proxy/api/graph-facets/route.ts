import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";
import { getGraphFacets } from "@/lib/uri-registry";
import { getSelectedFctEndpoint } from "@/lib/personal-sparql";

export async function GET(request: Request) {
  logProxyCaller(request, "graph-facets.GET");
  try {
    const endpoint = await getSelectedFctEndpoint(request);
    if (!endpoint) return NextResponse.json({ graphs: [] }, { status: 200 });
    return NextResponse.json({ graphs: await getGraphFacets(endpoint.url) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load configured Datasites.", graphs: [] }, { status: 503 });
  }
}
