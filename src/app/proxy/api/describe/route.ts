import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";

type FctEndpoint = { id: string; label: string; url: string; group: string };

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getConfiguredEndpoints(): FctEndpoint[] {
  const configured = (process.env.FCT_ENDPOINTS ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return null;
      const left = entry.slice(0, separator).trim();
      const url = entry.slice(separator + 1).trim();
      if (!left || !/^https?:\/\//i.test(url)) return null;
      const groupSeparator = left.indexOf("::");
      const group = groupSeparator >= 0 ? left.slice(0, groupSeparator).trim() : "Endpoints";
      const label = (groupSeparator >= 0 ? left.slice(groupSeparator + 2) : left).trim();
      if (!label) return null;
      return { id: groupSeparator >= 0 ? slugify(`${group}-${label}`) : slugify(label), group: group || "Endpoints", label, url };
    })
    .filter((endpoint): endpoint is FctEndpoint => Boolean(endpoint));
  const legacyUrl = (process.env.FCT_ENDPOINT ?? "").trim();
  if (legacyUrl && !configured.some((endpoint) => endpoint.url === legacyUrl)) {
    configured.unshift({ id: slugify("Current VOS"), group: "Endpoints", label: "Current VOS", url: legacyUrl });
  }
  const seen = new Set<string>();
  return configured.filter((endpoint) => {
    if (seen.has(endpoint.id)) return false;
    seen.add(endpoint.id);
    return true;
  });
}

function getSelectedEndpointId(request: Request, endpoints: FctEndpoint[]) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  const id = match ? decodeURIComponent(match[1]) : "";
  return endpoints.some((endpoint) => endpoint.id === id) ? id : endpoints[0]?.id ?? "";
}

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
    const endpoints = getConfiguredEndpoints();
    const endpointId = getSelectedEndpointId(request, endpoints);
    const endpoint = endpoints.find((item) => item.id === endpointId);
    if (!endpoint) return NextResponse.json({ error: "No FCT endpoints are configured." }, { status: 500 });

    const sparqlUrl = new URL("/sparql", endpoint.url);
    const response = await fetch(sparqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/rdf+xml, application/xml;q=0.9",
      },
      body: new URLSearchParams({ query: `DESCRIBE <${body.iri}>` }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const rdfXml = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: `Virtuoso SPARQL endpoint returned HTTP ${response.status}.`, details: rdfXml.slice(0, 2000) }, { status: 502 });
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("xml") && !contentType.includes("rdf")) {
      return NextResponse.json({ error: "Virtuoso DESCRIBE did not return RDF/XML.", details: rdfXml.slice(0, 1000) }, { status: 502 });
    }
    return NextResponse.json({ rdfXml });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DESCRIBE proxy error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
