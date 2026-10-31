import { NextResponse } from "next/server";
import { logProxyCaller } from "@/lib/proxy-debug";
import { clearQueryCache } from "@/lib/query-cache";
import { ensureGraphDirectorySeeded, getPersonalSession, personalSparqlUrl, personalSparqlWriteUrl } from "@/lib/personal-sparql";

/**
 * Called right after a successful login. Loads every RDF document in ./graph into the user's
 * personal graph server: <graphsitePrefix>/query + the fragment mapped in graph/manifest.json.
 */
export async function POST(request: Request) {
  logProxyCaller(request, "graph-seed.POST");
  if (!getPersonalSession(request)) {
    return NextResponse.json({ ok: false, error: "No personal graph server session. Log in first." }, { status: 401 });
  }
  try {
    const loaded = await ensureGraphDirectorySeeded(request, { force: true });
    clearQueryCache();
    return NextResponse.json({
      ok: true,
      readEndpoint: personalSparqlUrl(request).toString(),
      writeEndpoint: personalSparqlWriteUrl(request).toString(),
      loaded,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load ./graph into the personal graph server." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
