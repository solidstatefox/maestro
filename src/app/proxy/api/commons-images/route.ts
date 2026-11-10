import { NextResponse } from "next/server";

// Read-only Wikimedia Commons enrichment shared by all XSLT record formatters.
// It never substitutes for the RDF record's own depiction assertions.
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_FILE = /^https:\/\/upload\.wikimedia\.org\//i;

function plain(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|quot|lt|gt);/g, (m) => ({"&nbsp;":" ","&amp;":"&","&quot;":"\"","&lt;":"<","&gt;":">"})[m] ?? m).replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
}

type CommonsPage = {
  title?: string;
  imageinfo?: Array<{
    thumburl?: string; url?: string; descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

export async function GET(request: Request) {
  const label = new URL(request.url).searchParams.get("label")?.trim() ?? "";
  if (label.length < 2 || label.length > 120 || /[\x00-\x1f<>]/.test(label)) {
    return NextResponse.json({ images: [] });
  }
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6",
    gsrsearch: `filetype:bitmap intitle:"${label.replace(/["\\]/g, " ")}"`, gsrlimit: "6",
    prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1280",
  });
  try {
    const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "Maestro/0.1 (https://github.com/solidstatefox/maestro; Wikimedia Commons image lookup)" },
      signal: AbortSignal.timeout(6500), next: { revalidate: 86400 },
    });
    if (!response.ok) return NextResponse.json({ images: [] });
    const data = await response.json() as { query?: { pages?: Record<string, CommonsPage> } };
    const images = Object.values(data.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0];
      const url = info?.thumburl ?? info?.url;
      if (!url || !COMMONS_FILE.test(url)) return [];
      const m = info?.extmetadata ?? {};
      const source = info?.descriptionurl ?? "";
      return [{ url, credit: plain(m.Artist?.value), license: plain(m.LicenseShortName?.value),
        source: source.startsWith("https://commons.wikimedia.org/wiki/") ? source : "", title: plain(page.title) }];
    }).slice(0, 6);
    return NextResponse.json({ images }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" } });
  } catch {
    // Commons is optional; failures must never prevent a Record formatter from loading.
    return NextResponse.json({ images: [] });
  }
}
