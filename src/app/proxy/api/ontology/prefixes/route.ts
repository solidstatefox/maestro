import { NextResponse } from "next/server";

type PrefixSource = "prefixcc" | "zazuko" | "builtin";
const cache = new Map<PrefixSource, { prefixes: Record<string, string>; source: string; note: string }>();

async function fetchPrefixMap(url: string): Promise<Record<string, string>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid prefix response");
  const root = body as Record<string, unknown>;
  const map = (root["@context"] && typeof root["@context"] === "object" && !Array.isArray(root["@context"]))
    ? root["@context"] as Record<string, unknown> : root;
  const prefixes: Record<string, string> = {};
  for (const [prefix, candidate] of Object.entries(map)) {
    const namespace = typeof candidate === "string" ? candidate :
      candidate && typeof candidate === "object" && "@id" in candidate ? (candidate as { "@id"?: unknown })["@id"] : undefined;
    if (/^[a-z][a-z0-9_.-]*$/i.test(prefix) && typeof namespace === "string" && /^https?:\/\//i.test(namespace)) prefixes[prefix] = namespace;
  }
  if (Object.keys(prefixes).length === 0) throw new Error("No usable namespace mappings");
  return prefixes;
}

export async function GET(request: Request) {
  const selected = new URL(request.url).searchParams.get("source");
  const source: PrefixSource = selected === "zazuko" || selected === "builtin" ? selected : "prefixcc";
  if (source === "builtin") return NextResponse.json({ prefixes: {}, source: "builtin", count: 0, note: "Built-in prefixes only" });
  const cached = cache.get(source);
  if (cached) return NextResponse.json({ ...cached, count: Object.keys(cached.prefixes).length });
  let data: { prefixes: Record<string, string>; source: string; note: string };
  try {
    if (source === "prefixcc") {
      try {
        data = { prefixes: await fetchPrefixMap("https://prefix.cc/context.jsonld"), source: "prefixcc", note: "prefix.cc community list" };
      } catch {
        data = { prefixes: await fetchPrefixMap("https://prefix.zazuko.com/api/v1/prefixes"), source: "zazuko", note: "prefix.cc unavailable; using Zazuko over HTTPS" };
      }
    } else {
      data = { prefixes: await fetchPrefixMap("https://prefix.zazuko.com/api/v1/prefixes"), source: "zazuko", note: "Zazuko curated list" };
    }
    cache.set(source, data);
  } catch {
    data = { prefixes: {}, source: "builtin", note: "Prefix service unavailable; built-in list only" };
  }
  return NextResponse.json({ ...data, count: Object.keys(data.prefixes).length }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
