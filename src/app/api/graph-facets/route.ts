import { NextResponse } from "next/server";
import { getGraphFacets } from "@/lib/uri-registry";

function getConfiguredEndpoints(): Array<{ id: string; url: string }> {
  const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const entries = (process.env.FCT_ENDPOINTS ?? "").split(";").map((entry) => entry.trim()).filter(Boolean);
  const endpoints = entries.flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return [];
    const left = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    if (!/^https?:\/\//i.test(url)) return [];
    const groupSeparator = left.indexOf("::");
    const group = groupSeparator >= 0 ? left.slice(0, groupSeparator).trim() : "Endpoints";
    const label = (groupSeparator >= 0 ? left.slice(groupSeparator + 2) : left).trim();
    return label ? [{ id: groupSeparator >= 0 ? slugify(`${group}-${label}`) : slugify(label), url }] : [];
  });
  const legacyUrl = (process.env.FCT_ENDPOINT ?? "").trim();
  if (legacyUrl && /^https?:\/\//i.test(legacyUrl) && !endpoints.some((item) => item.url === legacyUrl)) endpoints.unshift({ id: slugify("Current VOS"), url: legacyUrl });
  return endpoints;
}

export async function GET(request: Request) {
  const endpoints = getConfiguredEndpoints();
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  const selectedId = match ? decodeURIComponent(match[1]) : "";
  const endpoint = endpoints.find((item) => item.id === selectedId) ?? endpoints[0];
  if (!endpoint) return NextResponse.json({ graphs: [] }, { status: 200 });
  return NextResponse.json({ graphs: await getGraphFacets(endpoint.url) });
}
