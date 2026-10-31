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
 * fetch() for Virtuoso's authenticated endpoints. Sends the Basic Authorization header first (as Maestro always
 * has) and falls back to HTTP Digest, which /sparql-auth and /sparql-graph-crud-auth use behind OpenLink's gateway:
 *  1. Basic answered 401 with a Digest challenge  -> answer that challenge.
 *  2. Basic answered 401 with no challenge at all -> some gateways only issue the challenge to requests that carry
 *     no Authorization header, so repeat the request without it to obtain the challenge, then answer it.
 * Request bodies must be strings (they are re-sent).
 */
export async function fetchWithDigestFallback(input: URL | string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const method = init.method ?? "GET";
  const first = await fetch(url, init);
  if (first.status !== 401) return first;

  const creds = decodeBasic(init.headers.Authorization ?? init.headers.authorization);
  const basicChallenge = first.headers.get("www-authenticate") ?? "";
  if (!creds) {
    authNotes.set(first, `${method} ${url.pathname} -> 401; server challenge: ${redact(basicChallenge)}; no Basic credentials were available to answer it`);
    return first;
  }

  let challenge = parseChallenge(basicChallenge);
  let probeNote = "";
  if (!challenge) {
    await first.arrayBuffer().catch(() => undefined);
    const { Authorization: _a, authorization: _b, ...withoutAuth } = init.headers;
    const probe = await fetch(url, { ...init, headers: withoutAuth });
    const probeChallenge = probe.headers.get("www-authenticate") ?? "";
    challenge = parseChallenge(probeChallenge);
    if (!challenge) {
      if (probe.status === 401) authNotes.set(probe, `${method} ${url.pathname} -> 401 with Basic credentials (challenge: ${redact(basicChallenge)}) and 401 without credentials (challenge: ${redact(probeChallenge)}); no Digest challenge to answer`);
      return probe;
    }
    await probe.arrayBuffer().catch(() => undefined);
    probeNote = " (challenge obtained from a request without credentials)";
  } else {
    await first.arrayBuffer().catch(() => undefined);
  }

  const headers = { ...init.headers, Authorization: buildDigestHeader(method, url, creds, challenge) };
  const second = await fetch(url, { ...init, headers });
  if (second.status === 401) authNotes.set(second, `${method} ${url.pathname} -> 401 even after a Digest response${probeNote}; check the username/password and the account's rights on this endpoint`);
  return second;
}
