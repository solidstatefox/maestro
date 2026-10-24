import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";
import { clearQueryCache } from "@/lib/query-cache";

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

    const endpoint = process.env.RDF_LOADER_ENDPOINT || "http://localhost:8890/sparql";
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") {
      return NextResponse.json({ error: "RDF_LOADER_ENDPOINT must use HTTP or HTTPS." }, { status: 500 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/sparql-update; charset=utf-8",
      Accept: "text/plain, text/html, application/json, */*",
    };

    const username = process.env.RDF_LOADER_USERNAME;
    const password = process.env.RDF_LOADER_PASSWORD;
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

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
