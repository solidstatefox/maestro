import { logProxyCaller } from "@/lib/proxy-debug";
import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { recordUriObservations } from "@/lib/uri-registry";
import { getSelectedFctEndpoint } from "@/lib/personal-sparql";


export async function POST(request: Request) {
  try {
    const endpoint = await getSelectedFctEndpoint(request);
    if (!endpoint) return NextResponse.json({ error: "No Datasites are configured in SITE_SPARQL_ENDPOINTS." }, { status: 503 });

    const body = await request.json().catch(() => null) as {
      observations?: unknown;
      _debug?: { source?: unknown; component?: unknown; requestId?: unknown };
    } | null;
    logProxyCaller(request, "observations.POST", body?._debug);
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
