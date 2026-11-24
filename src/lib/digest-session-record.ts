/** The single persisted user-session record. No password or bearer token. */
export const DIGEST_SESSION_DB = "maestro-user-session";
export const DIGEST_SESSION_STORE = "sessions";
export const DIGEST_SESSION_KEY = "personal-sparql-auth";
export const DIGEST_SESSION_HEADER = "Authorization";
export const DIGEST_SESSION_SCHEME = "MaestroDigest ";
export type DigestSessionIdentity = {
  username: string; graphStore: string; graphPrefix: string; ha1: string;
};
export type DigestSessionRecord = DigestSessionIdentity & {
  realm: "SPARQL"; algorithm: "MD5"; qop: "auth";
  nonce: string; cnonce: string; opaque: string | null;
  /** Last reserved nonce count; the next request increments before dispatch. */
  nc: number;
};
const token = (x: unknown): x is string => typeof x === "string" && /^[\x21-\x7e]{1,1024}$/.test(x) && !/["\\]/.test(x);
export function parseDigestIdentity(value: unknown): DigestSessionIdentity | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<DigestSessionIdentity>;
  if (!token(r.username) || typeof r.ha1 !== "string" || !/^[a-f0-9]{32}$/i.test(r.ha1) ||
      typeof r.graphStore !== "string" || typeof r.graphPrefix !== "string" ||
      !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(r.graphPrefix) || r.graphPrefix.length > 4096) return null;
  try {
    const url = new URL(r.graphStore);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        !/\/sparql\/?$/i.test(url.pathname)) return null;
    return {username:r.username, graphStore:url.toString(), graphPrefix:r.graphPrefix, ha1:r.ha1.toLowerCase()};
  } catch { return null; }
}
export function parseDigestSession(value: unknown): DigestSessionRecord | null {
  const identity = parseDigestIdentity(value);
  if (!identity) return null;
  const r = value as Partial<DigestSessionRecord>;
  if (!token(r.nonce) || !token(r.cnonce) || !(r.opaque === null || r.opaque === "" || token(r.opaque)) ||
      r.realm !== "SPARQL" || r.algorithm !== "MD5" || r.qop !== "auth" ||
      typeof r.nc !== "number" || !Number.isInteger(r.nc) || r.nc < 0 || r.nc >= 0xffffffff) return null;
  return {...identity, realm:"SPARQL", algorithm:"MD5", qop:"auth", nonce:r.nonce, cnonce:r.cnonce, opaque:r.opaque, nc:r.nc};
}
export function digestEndpoint(record: {graphStore:string}): string {
  const url = new URL(record.graphStore);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/\/sparql\/?$/i.test(url.pathname)) throw new Error("Invalid personal graph endpoint.");
  url.pathname = url.pathname.replace(/\/sparql\/?$/i,"/sparql-auth");
  return url.toString();
}
