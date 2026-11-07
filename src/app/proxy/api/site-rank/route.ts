import { NextResponse } from "next/server";

// Free, optional website popularity estimate. Cached to avoid imposing repeated
// third-party requests on a View with many visible graph servers.
const cache = new Map<string, { rank: number | null; expires: number }>();
const MAX_CACHE = 1000;

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase() ?? "";
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253) {
    return NextResponse.json({ error: "Invalid public domain" }, { status: 400 });
  }
  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ rank: cached.rank }, { headers: { "Cache-Control": "private, max-age=3600" } });
  }
  try {
    const response = await fetch(`https://rank.to/api/?d=${encodeURIComponent(domain)}&n=1`, {
      signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Rank.to HTTP ${response.status}`);
    const data = await response.json() as { ranks?: Record<string, number> };
    const valid = Object.entries(data.ranks ?? {}).filter(([, value]) => Number.isSafeInteger(value) && value > 0).sort(([a], [b]) => a.localeCompare(b));
    const rank = valid.length ? valid[valid.length - 1][1] : null;
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(domain, { rank, expires: Date.now() + 24 * 60 * 60 * 1000 });
    return NextResponse.json({ rank }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ rank: null }, { headers: { "Cache-Control": "private, max-age=300" } });
  }
}
