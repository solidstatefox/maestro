import { createHash, randomBytes } from "node:crypto";

/**
 * Virtuoso's authenticated endpoints (/sparql-auth, /sparql-graph-crud-auth) challenge with HTTP Digest
 * (realm "SPARQL"), not Basic. The login stores a Basic Authorization header, so on a 401 Digest challenge
 * this helper decodes those credentials and retries the same request once with a Digest response.
 * Server-side only. Request bodies must be strings (they are re-sent on retry).
 */

function parseChallenge(header: string): Record<string, string> | null {
  const match = header.match(/^\s*Digest\s+(.*)$/is);
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const part of match[1].matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi)) {
    params[part[1].toLowerCase()] = (part[2] ?? part[3] ?? "").replace(/\\(.)/g, "$1");
  }
  return params.nonce ? params : null;
}

function decodeBasic(authorization: string | undefined): { user: string; pass: string } | null {
  const match = authorization?.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1].trim(), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? { user: decoded, pass: "" } : { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

function buildDigestHeader(method: string, url: URL, creds: { user: string; pass: string }, challenge: Record<string, string>): string {
  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  const hashName = algorithm.startsWith("SHA-256") ? "sha256" : "md5";
  const hash = (value: string) => createHash(hashName).update(value).digest("hex");
  const realm = challenge.realm ?? "";
  const uri = `${url.pathname}${url.search}`;
  const qopOptions = (challenge.qop ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const qop = qopOptions.includes("auth") ? "auth" : "";
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";
  let ha1 = hash(`${creds.user}:${realm}:${creds.pass}`);
  if (algorithm.endsWith("-SESS")) ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = hash(`${method.toUpperCase()}:${uri}`);
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const fields = [
    `username=${quote(creds.user)}`,
    `realm=${quote(realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
    `response=${quote(response)}`,
  ];
  if (challenge.opaque) fields.push(`opaque=${quote(challenge.opaque)}`);
  if (challenge.algorithm) fields.push(`algorithm=${challenge.algorithm}`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  return `Digest ${fields.join(", ")}`;
}

/** fetch() that answers a Digest challenge using the credentials in a Basic Authorization header. */
export async function fetchWithDigestFallback(input: URL | string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const first = await fetch(url, init);
  if (first.status !== 401) return first;
  const challenge = parseChallenge(first.headers.get("www-authenticate") ?? "");
  const creds = decodeBasic(init.headers.Authorization ?? init.headers.authorization);
  if (!challenge || !creds) return first;
  await first.arrayBuffer().catch(() => undefined);
  const headers = { ...init.headers, Authorization: buildDigestHeader(init.method ?? "GET", url, creds, challenge) };
  return fetch(url, { ...init, headers });
}
