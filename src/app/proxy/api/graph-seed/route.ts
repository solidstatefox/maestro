import { NextResponse } from "next/server";
import { logProxyCaller } from "@/lib/proxy-debug";
import { clearQueryCache } from "@/lib/query-cache";
import { ensureGraphDirectorySeeded, getPersonalSession, personalSparqlUrl, personalSparqlWriteUrl } from "@/lib/personal-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";

/**
 * Called right after a successful login. Loads every RDF document in ./graph into the user's
 * personal graph server: <graphPrefix>/query + the fragment mapped in graph/manifest.json.
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
    // Keep full diagnostics server-side; never send project or temp paths to the browser.
    console.error("Maestro graph seed failed:", error);
    const message = describeUpstreamError(error, "Could not load ./graph into the personal graph server.");
    const safeMessage = message
      .replaceAll(process.cwd(), "[project]")
      .replace(/[A-Za-z]:[\\/][^\r\n]+?(?=[:\s]|$)/g, "[local path]");
    return NextResponse.json({ ok: false, error: safeMessage }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
