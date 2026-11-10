import { NextResponse } from "next/server";
import { getConfiguredFctEndpoints, normalizeGraphServerUri, resolveConfiguredFctEndpoint } from "@/lib/personal-sparql";
import { withProxyClient } from "@/lib/maestro-proxy-client-preferences";
import { withGraphServerSlot } from "@/lib/server-query-scheduler";
import { traceVirtuosoDispatch } from "@/lib/proxy-query-events";

/** Explicit, uncached URIBurner dereference. This is opt-in, not part of normal FCT evaluation. */
async function execute(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as { uri?: unknown; endpoint?: unknown; timeoutMs?: unknown } | null;
  const uri = typeof body?.uri === "string" ? body.uri.trim() : "";
  const server = typeof body?.endpoint === "string" ? normalizeGraphServerUri(body.endpoint) : "";
  let target: URL;
  try { target = new URL(uri); } catch { return NextResponse.json({ error: "A valid HTTP(S) URI is required." }, { status: 400 }); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password || !uri || /[<>"{}|^`\\\s]/.test(uri)) {
    return NextResponse.json({ error: "An HTTP(S) resource URI without embedded credentials is required." }, { status: 400 });
  }
  const endpoints = await getConfiguredFctEndpoints(request);
  const configured = resolveConfiguredFctEndpoint(endpoints, server);
  if (!configured) return NextResponse.json({ error: "The graph server must be registered in your personal endpoint list." }, { status: 400 });
  const parsedEndpoint = new URL(configured.url);
  if (!["linkeddata.uriburner.com", "uriburner.com"].includes(parsedEndpoint.hostname.toLowerCase())) {
    return NextResponse.json({ error: "Sponge URI currently supports the public URIBurner graph server." }, { status: 400 });
  }
  const timeoutMs = Number.isSafeInteger(body?.timeoutMs) && Number(body?.timeoutMs) >= 0 && Number(body?.timeoutMs) <= 3_600_000
    ? Number(body?.timeoutMs) : 0;
  const sparql = `DEFINE get:soft "soft"\nSELECT ?s ?p ?o FROM <${uri}> WHERE { ?s ?p ?o } LIMIT 1`;
  try {
    const upstream = await withGraphServerSlot(configured.url, "interactive", request.signal, () => traceVirtuosoDispatch(() => fetch(configured.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Accept": "application/sparql-results+json" },
      body: new URLSearchParams({ query: sparql, ...(timeoutMs > 0 ? { timeout: String(timeoutMs) } : {}) }),
      cache: "no-store", signal: request.signal,
    })));
    const responseText = await upstream.text();
    if (!upstream.ok) return NextResponse.json({ error: `URIBurner returned HTTP ${upstream.status}: ${responseText.slice(0, 500)}`, authorizationRequired: upstream.status === 401 || upstream.status === 403 }, { status: upstream.status });
    let bindings = 0;
    try { bindings = (JSON.parse(responseText) as { results?: { bindings?: unknown[] } }).results?.bindings?.length ?? 0; } catch {
      return NextResponse.json({ error: "URIBurner returned an unexpected response.", details: responseText.slice(0, 250) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sampled: bindings, uri, message: "URIBurner accepted the dereference request." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Sponge operation canceled." }, { status: 499 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "URIBurner sponging failed." }, { status: 502 });
  }
}
export async function POST(request: Request): Promise<Response> {
  try { return await withProxyClient(request, () => execute(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sponging failed." }, { status: 502 }); }
}
