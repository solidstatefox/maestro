import { NextResponse } from "next/server";
import { logProxyCaller } from "@/lib/proxy-debug";

export async function POST(request: Request) {
  logProxyCaller(request, "auth.POST");
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    // Action 1: Test connectivity and authentication against the graph store
    if (action === "test") {
      const graphStore = typeof body.graphStore === "string" ? body.graphStore.trim() : "";
      if (!graphStore || !/^https?:\/\//i.test(graphStore)) {
        return NextResponse.json({ ok: false, error: "A valid HTTP(S) Graph Store URL is required." }, { status: 400 });
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/sparql-results+json, application/json, */*",
      };

      if (body.authType === "sparql-auth" && body.username && body.password) {
        headers.Authorization = `Basic ${Buffer.from(`${body.username}:${body.password}`).toString("base64")}`;
      } else if ((body.authType === "sparql-oauth" || body.authType === "sparql-webid") && body.token) {
        headers.Authorization = `Bearer ${String(body.token).trim()}`;
      }

      // Quick ASK query to verify credentials and endpoint accessibility
      const sparql = "ASK WHERE { ?s ?p ?o }";
      const response = await fetch(graphStore, {
        method: "POST",
        headers,
        body: new URLSearchParams({ query: sparql }).toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const text = (await response.text()).slice(0, 500);
        return NextResponse.json({
          ok: false,
          status: response.status,
          error: response.status === 401 || response.status === 403
            ? `Authentication failed (${response.status}): check your credentials or access rights.`
            : `Graph server returned HTTP ${response.status}: ${text || "No details."}`,
        }, { status: 200 });
      }

      return NextResponse.json({ ok: true, status: response.status, message: "Connected successfully." });
    }

    // Action 2: Resolve OpenID / WebID avatar and display name
    if (action === "profile") {
      const profileUrl = typeof body.url === "string" ? body.url.trim() : "";
      if (!profileUrl || !/^https?:\/\//i.test(profileUrl)) {
        return NextResponse.json({ ok: false, error: "A valid WebID or OpenID URL is required." }, { status: 400 });
      }

      const response = await fetch(profileUrl, {
        method: "GET",
        headers: {
          Accept: "text/turtle, application/ld+json, application/json, application/rdf+xml, text/plain",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return NextResponse.json({ ok: false, error: `Could not retrieve profile (HTTP ${response.status})` }, { status: 400 });
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      let avatarUrl: string | undefined;
      let displayName: string | undefined;

      // If JSON (e.g. OpenID Connect UserInfo)
      if (contentType.includes("json") || text.trim().startsWith("{")) {
        try {
          const json = JSON.parse(text);
          avatarUrl = json.picture || json.avatar || json.avatar_url || json.image;
          displayName = json.name || json.preferred_username || json.nickname || json.given_name;
        } catch { /* parse error non-fatal */ }
      }

      // If Turtle or RDF, scan for common avatar predicates:
      // foaf:img, foaf:depiction, vcard:hasPhoto, schema:image
      if (!avatarUrl) {
        const imgMatch = text.match(/(?:foaf:img|foaf:depiction|vcard:hasPhoto|schema:image|<http:\/\/xmlns\.com\/foaf\/0\.1\/img>|<http:\/\/xmlns\.com\/foaf\/0\.1\/depiction>|<http:\/\/www\.w3\.org\/2006\/vcard\/ns#hasPhoto>|<https:\/\/schema\.org\/image>)\s+<([^>]+)>/i);
        if (imgMatch) avatarUrl = imgMatch[1];
      }

      if (!displayName) {
        const nameMatch = text.match(/(?:foaf:name|rdfs:label|vcard:fn|schema:name|<http:\/\/xmlns\.com\/foaf\/0\.1\/name>|<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>)\s+"([^"]+)"/i);
        if (nameMatch) displayName = nameMatch[1];
      }

      // If avatarUrl is relative, resolve against profileUrl
      if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
        try {
          avatarUrl = new URL(avatarUrl, profileUrl).toString();
        } catch { /* ignore */ }
      }

      return NextResponse.json({
        ok: true,
        avatarUrl,
        displayName,
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Auth proxy failed" }, { status: 500 });
  }
}
