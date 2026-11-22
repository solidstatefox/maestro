/** A graph-server URL comes from the FCT query, not a registry. Protect the
 * server-side proxy from obvious local/metadata targets, credentials, invalid
 * ports and non-HTTP schemes. Development's own loopback SPARQL endpoint is
 * deliberately allowed for local Virtuoso testing. */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function forbiddenIpv4(value: string): boolean {
  const n = value.split(".").map(Number);
  if (n.length !== 4 || n.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  return n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) || (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 192 && n[1] === 0) || (n[0] === 198 && [18, 19].includes(n[1])) ||
    (n[0] === 198 && n[1] === 51 && n[2] === 100) || (n[0] === 203 && n[1] === 0 && n[2] === 113);
}
export function permittedGraphServerTarget(value: string): boolean {
  try {
    const u = new URL(value);
    if (!(u.protocol === "http:" || u.protocol === "https:") || !u.hostname || u.username || u.password || u.hash) return false;
    const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    if (loopback) return process.env.NODE_ENV === "development";
    if (hostname === "metadata.google.internal" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
        hostname.endsWith(".internal") || hostname === "localhost" || hostname.endsWith(".test")) return false;
    if (isIP(hostname) === 4) return !forbiddenIpv4(hostname);
    if (isIP(hostname) === 6) return /^[23]/.test(hostname) &&
      !/^2001:db8:/i.test(hostname) && !/^2001:0:/i.test(hostname) && !/^2002:/i.test(hostname);
    // Public global-unicast IPv6 endpoints are valid; link-local, ULA,
    // loopback, transition tunnels and documentation ranges are not.
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostname)) return false;
    return true;
  } catch { return false; }
}
export function requireGraphServerTarget(value: string): string {
  if (!permittedGraphServerTarget(value)) throw new Error("Invalid or unsafe graph-server URL in query addr.");
  return value;
}

/** Reject public hostnames resolving to private/metadata addresses. A deployment
 * using an HTTP proxy should enforce the same egress policy at network level.
 * This DNS preflight is deliberately independent of Maestro's courtesy list. */
export async function checkGraphServerDestination(value: string): Promise<void> {
  requireGraphServerTarget(value);
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) || hostname === "localhost") return;
  const records = await lookup(hostname, { all: true });
  if (!records.length || records.some(record => !permittedGraphServerTarget(`https://${record.family === 6 ? `[${record.address}]` : record.address}/sparql`))) {
    throw new Error("Graph-server hostname resolves to an unsafe network destination.");
  }
}
