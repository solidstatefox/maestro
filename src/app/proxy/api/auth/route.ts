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

      // The client sends a prebuilt Authorization header; also accept raw credentials.
      let authorization = typeof body.authHeader === "string" ? body.authHeader.trim() : "";
      if (!authorization) {
        if (body.authType === "sparql-auth" && body.username && body.password) {
          authorization = `Basic ${Buffer.from(`${body.username}:${body.password}`).toString("base64")}`;
        } else if ((body.authType === "sparql-oauth" || body.authType === "sparql-webid") && body.token) {
          authorization = `Bearer ${String(body.token).trim()}`;
        }
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/sparql-results+json, application/json, */*",
      };
      if (authorization) headers.Authorization = authorization;

      // Reads go to the /sparql endpoint the user entered (a pasted /sparql-auth is normalised to /sparql).
      const readUrl = new URL(graphStore);
      readUrl.pathname = readUrl.pathname.replace(/\/sparql-auth\/?$/i, "/sparql");
      // Writes (and credential verification) use /sparql-auth for sparql-auth logins.
      const writeUrl = new URL(readUrl.toString());
      if (body.authType === "sparql-auth") writeUrl.pathname = writeUrl.pathname.replace(/\/sparql\/?$/i, "/sparql-auth");

      const sparql = "ASK WHERE { ?s ?p ?o }";
      const probe = async (url: URL, label: string) => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: new URLSearchParams({ query: sparql }).toString(),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) return null;
        const text = (await response.text()).slice(0, 500);
        return {
          status: response.status,
          error: response.status === 401 || response.status === 403
            ? `Authentication failed (${response.status}) at ${label} ${url.toString()}: check your credentials or access rights.`
            : `${label} ${url.toString()} returned HTTP ${response.status}: ${text || "No details."}`,
        };
      };

      let failure;
      try {
        failure = await probe(readUrl, "read endpoint");
        if (!failure && writeUrl.toString() !== readUrl.toString()) failure = await probe(writeUrl, "write endpoint");
      } catch (error) {
        return NextResponse.json({ ok: false, connected: false, error: `Could not reach the personal graph server: ${error instanceof Error ? error.message : "fetch failed"}` }, { status: 200 });
      }
      if (failure) return NextResponse.json({ ok: false, connected: false, ...failure }, { status: 200 });

      return NextResponse.json({ ok: true, connected: true, status: 200, readEndpoint: readUrl.toString(), writeEndpoint: writeUrl.toString(), message: "Connected successfully." });
    }

    // Action 2: Resolve OpenID / WebID avatar and display name
    if (action === "profile") {
      const profileUrl = typeof body.url === "string" ? body.url.trim() : typeof body.profileUrl === "string" ? body.profileUrl.trim() : "";
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
