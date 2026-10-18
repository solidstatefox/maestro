import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { recordUriObservations } from "@/lib/uri-registry";


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
  if (legacyUrl && /^https?:\/\//i.test(legacyUrl) && !endpoints.some((item) => item.url === legacyUrl)) {
    endpoints.unshift({ id: slugify("Current VOS"), url: legacyUrl });
  }
  return endpoints;
}

function selectedEndpoint(request: Request) {
  const endpoints = getConfiguredEndpoints();
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)fct_endpoint=([^;]+)/);
  const selectedId = match ? decodeURIComponent(match[1]) : "";
  return endpoints.find((item) => item.id === selectedId) ?? endpoints[0] ?? null;
}

export async function POST(request: Request) {
  try {
    const endpoint = selectedEndpoint(request);
    if (!endpoint) return NextResponse.json({ error: "No FCT endpoint is configured." }, { status: 503 });

    const body = await request.json().catch(() => null) as { observations?: unknown } | null;
    if (!Array.isArray(body?.observations)) {
      return NextResponse.json({ error: "Expected an observations array." }, { status: 400 });
    }
    if (body.observations.length > 2000) {
      return NextResponse.json({ error: "Observation batch exceeds 2,000 items." }, { status: 413 });
    }

    const observations = body.observations.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const uri = typeof record.uri === "string" ? record.uri.trim() : "";
      if (!uri || uri.length > 8192 || !/^[a-z][a-z0-9+.-]*:/i.test(uri) || /[\u0000-\u0020<>"{}|\\^`]/.test(uri)) return [];
      return [{ uri, isNamedGraph: record.isNamedGraph === true }];
    });

    // Forwarded IP headers are only trustworthy when the app is behind a
    // reverse proxy that overwrites them and MAESTRO_TRUST_PROXY_HEADERS is set.
    const trustProxy = /^(1|true|yes)$/i.test(process.env.MAESTRO_TRUST_PROXY_HEADERS ?? "");
    const forwardedIp = trustProxy
      ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "")
      : "";
    const normalizedIp = forwardedIp.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
    const ip = isIP(normalizedIp) ? normalizedIp : "unknown";

    const result = await recordUriObservations({ observations, quadStore: endpoint.url, clientIp: ip });
    return NextResponse.json({ accepted: observations.length, ...result });
  } catch (error) {
    console.error("URI observation report failed:", error);
    return NextResponse.json({ error: "Could not record URI observations." }, { status: 500 });
  }
}
