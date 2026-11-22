import { createHash, randomBytes } from "node:crypto";

/**
 * Virtuoso's authenticated endpoints (/sparql-auth, /sparql-graph-crud-auth) challenge with HTTP Digest
 * (realm "SPARQL"), not Basic. The login stores a Basic Authorization header, so on a 401 Digest challenge
 * this helper decodes those credentials and retries the same request once with a Digest response.
 * Server-side only. Request bodies must be strings (they are re-sent on retry).
 */

function parseChallenge(header: string): Record<string, string> | null {
  const match = header.match(/^\s*Digest\s+([\s\S]*)$/i);
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
  if (!["MD5", "MD5-SESS", "SHA-256", "SHA-256-SESS"].includes(algorithm)) throw new Error("Unsupported Virtuoso Digest algorithm.");
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

const authNotes = new WeakMap<Response, string>();

/** What the server asked for on a 401, to include in error messages (never contains credentials). */
export function authNote(response: Response): string {
  return authNotes.get(response) ?? "";
}

const redact = (header: string) => (header ? header.replace(/nonce="[^"]*"|opaque="[^"]*"/gi, "").slice(0, 160) : "none sent");

/**
 * Virtuoso Digest challenge/response. Basic is a LOCAL carrier for the saved
 * username/password; it must never be sent to the remote server, particularly
 * when an existing Virtuoso installation is configured over HTTP.
 * The initial request is unauthenticated; only the computed Digest response is
 * transmitted upstream. Bearer requests are not Digest and remain unchanged.
 */
export async function fetchWithDigestFallback(input: URL | string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const method = init.method ?? "GET";
  const safeInit = { ...init, redirect: "manual" as const };
  const creds = decodeBasic(init.headers.Authorization ?? init.headers.authorization);
  if (!creds) return fetch(url, safeInit);
  const { Authorization: _a, authorization: _b, ...withoutAuth } = init.headers;
  // Intentionally omit Basic credentials from the first upstream request.
  const challengeResponse = await fetch(url, { ...safeInit, headers: withoutAuth });
  const challengeHeader = challengeResponse.headers.get("www-authenticate") ?? "";
  if (challengeResponse.status !== 401) {
    if (challengeResponse.ok) {
      await challengeResponse.arrayBuffer().catch(() => undefined);
      return new Response("Expected a Digest authentication challenge from Virtuoso; the endpoint did not authenticate these credentials.", {status:502});
    }
    return challengeResponse;
  }
  const challenge = parseChallenge(challengeHeader);
  if (!challenge) {
    authNotes.set(challengeResponse, `${method} ${url.pathname} -> 401 without a supported Digest challenge (${redact(challengeHeader)})`);
    return challengeResponse;
  }
  await challengeResponse.arrayBuffer().catch(() => undefined);
  const headers = { ...withoutAuth, Authorization: buildDigestHeader(method, url, creds, challenge) };
  let authenticated = await fetch(url, { ...safeInit, headers });
  // RFC 7616 stale=true means the credentials were not rejected: Virtuoso
  // provided a fresh nonce. Retry exactly once without prompting Alice.
  if (authenticated.status === 401) {
    const renewed = parseChallenge(authenticated.headers.get("www-authenticate") ?? "");
    if (renewed?.stale?.toLowerCase() === "true" && renewed.nonce !== challenge.nonce) {
      await authenticated.arrayBuffer().catch(() => undefined);
      authenticated = await fetch(url, {
        ...safeInit,
        headers: { ...withoutAuth, Authorization: buildDigestHeader(method, url, creds, renewed) },
      });
    }
  }
  if (authenticated.status === 401)
    authNotes.set(authenticated, `${method} ${url.pathname} -> 401 after Digest response; check the credentials, nonce and endpoint permissions`);
  return authenticated;
}
