import { logProxyCaller } from "@/lib/proxy-debug-server";
import { NextResponse } from "next/server";
import { getGraphFacets } from "@/lib/uri-registry";
import { getSelectedFctEndpoint } from "@/lib/personal-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";

export async function GET(request: Request) {
  logProxyCaller(request, "graph-facets.GET");
  try {
    const endpoint = await getSelectedFctEndpoint(request);
    if (!endpoint) return NextResponse.json({ graphs: [] }, { status: 200 });
    return NextResponse.json({ graphs: await getGraphFacets(endpoint.url) });
  } catch (error) {
    return NextResponse.json({ error: describeUpstreamError(error, "Could not load configured graphs."), graphs: [] }, { status: 503 });
  }
}
