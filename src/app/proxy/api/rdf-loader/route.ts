import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";
import { clearQueryCache } from "@/lib/query-cache";
import { personalSparqlUrl, personalSparqlHeaders } from "@/lib/personal-sparql";

function validateIri(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  const raw = value.trim();
  if (/[<>"{}|\\^`\s]/.test(raw)) {
    throw new Error(`${field} contains characters that are not allowed in an IRI.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${field} must not contain embedded credentials.`);
  }

  return parsed.href;
}

export async function POST(request: Request) {
  logProxyCaller(request, "rdf-loader.POST");
  try {
    const body = await request.json().catch(() => null);
    const sourceUrl = validateIri(body?.sourceUrl, "RDF source URL");
    const targetGraph = validateIri(body?.targetGraph, "Target graph IRI");

    const endpointUrl = personalSparqlUrl(request);
    const headers = personalSparqlHeaders(request, "application/sparql-update; charset=utf-8", "text/plain, text/html, application/json, */*");

    const update = `LOAD <${sourceUrl}> INTO GRAPH <${targetGraph}>`;
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: update,
      cache: "no-store",
      signal: AbortSignal.timeout(600_000),
    });
    const responseText = (await response.text()).slice(0, 6000);

    if (!response.ok) {
      return NextResponse.json({
        error: `Virtuoso RDF load failed (HTTP ${response.status}). ${responseText || "No error details were returned."}`,
      }, { status: 502 });
    }

    if (/error|failed|not found|no such/i.test(responseText) && !/0 errors/i.test(responseText)) {
      return NextResponse.json({
        error: `Virtuoso may have rejected the load: ${responseText}`,
      }, { status: 502 });
    }

    // A successful data load makes previously cached query results potentially stale.
    clearQueryCache();
    return NextResponse.json({
      ok: true,
      message: `Virtuoso accepted the LOAD request for ${sourceUrl}. Target graph: ${targetGraph}. Response: ${responseText || "(empty response)"}`,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.name === "TimeoutError"
        ? "The RDF load timed out. For large files, use Virtuoso's bulk loader instead."
        : error.message
      : "RDF load failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
