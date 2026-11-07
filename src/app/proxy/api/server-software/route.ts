import { NextResponse } from "next/server";
import { getConfiguredFctEndpoints } from "@/lib/personal-sparql";

// Only configured graph servers can be probed. Never accept a URL from the client.
const cache = new Map<string, { until: number; value: { product: string; version: string } }>();
const VIRtuosoProbe = `PREFIX bif: <bif:>\nSELECT (bif:sys_stat('st_dbms_name') AS ?product) (bif:sys_stat('st_dbms_ver') AS ?version) WHERE {} LIMIT 1`;

export async function GET(request: Request) {
  const endpointId = new URL(request.url).searchParams.get("endpointId") ?? "";
  const endpoints = await getConfiguredFctEndpoints(request);
  const endpoint = endpoints.find((entry) => entry.id === endpointId);
  if (!endpoint) return NextResponse.json({ error: "Unknown graph server" }, { status: 404 });
  const previous = cache.get(endpoint.url);
  if (previous && previous.until > Date.now()) return NextResponse.json(previous.value);
  const unknown = { product: "Unknown", version: "" };
  let value = unknown;
  try {
    const target = new URL(endpoint.url);
    if (!["https:", "http:"].includes(target.protocol)) throw new Error("Unsupported SPARQL URL");
    const body = new URLSearchParams({ query: VIRtuosoProbe });
    const response = await fetch(target, {
      method: "POST", body, signal: AbortSignal.timeout(6500), cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/sparql-results+json" },
    });
    if (response.ok) {
      const json = await response.json() as {
        results?: { bindings?: Array<{ product?: { value?: string }; version?: { value?: string } }> };
      };
      const row = json.results?.bindings?.[0];
      if (row?.product?.value) value = { product: row.product.value.slice(0, 100), version: (row.version?.value ?? "").slice(0, 100) };
    }
  } catch { /* Not all SPARQL servers support Virtuoso's optional sys_stat extension. */ }
  cache.set(endpoint.url, { until: Date.now() + 60 * 60 * 1000, value });
  return NextResponse.json(value);
}
