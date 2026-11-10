import { logProxyCaller } from "@/lib/proxy-debug-server";
import { NextResponse } from "next/server";
import { getQueryCache, queryCacheKey, setQueryCache } from "@/lib/query-cache";
import { getConfiguredFctEndpoints, resolveFctEndpointFromAddr } from "@/lib/personal-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";

function isSafeIri(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !/[<>"{}|^`\\\u0000-\u0020]/.test(value) && /^(?:https?|urn):/i.test(value);
}

export async function POST(request: Request) {
  logProxyCaller(request, "describe.POST");
  try {
    const body = await request.json().catch(() => null);
    if (!isSafeIri(body?.iri)) {
      return NextResponse.json({ error: "A valid resource IRI is required for DESCRIBE." }, { status: 400 });
    }
    const endpoints = await getConfiguredFctEndpoints(request);
    const endpoint = resolveFctEndpointFromAddr(endpoints, body?.addr);
    if (!endpoint) return NextResponse.json({ error: "DESCRIBE requires a registered graph server in query addr." }, { status: 503 });

    const sparqlUrl = new URL("/sparql", endpoint.url);
    const query = `DESCRIBE <${body.iri}>`;
    const cacheKey = queryCacheKey("describe-response", endpoint.url, `application/rdf+xml\\u0000${query}`);
    const cached = getQueryCache<string>(cacheKey);
    if (cached !== undefined) {
      return NextResponse.json({ rdfXml: cached }, { headers: { "X-Maestro-Cache": "HIT" } });
    }
    const response = await fetch(sparqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/rdf+xml, application/xml;q=0.9",
      },
      body: new URLSearchParams({ query }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const rdfXml = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: `Virtuoso SPARQL endpoint returned HTTP ${response.status}${rdfXml.trim() ? `: ${rdfXml.trim().slice(0, 1000)}` : "."}`, details: rdfXml.slice(0, 2000) }, { status: 502 });
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("xml") && !contentType.includes("rdf")) {
      return NextResponse.json({ error: "Virtuoso DESCRIBE did not return RDF/XML.", details: rdfXml.slice(0, 1000) }, { status: 502 });
    }
    setQueryCache(cacheKey, rdfXml);
    return NextResponse.json({ rdfXml }, { headers: { "X-Maestro-Cache": "MISS" } });
  } catch (error) {
    const message = describeUpstreamError(error, "Unknown DESCRIBE proxy error.");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
