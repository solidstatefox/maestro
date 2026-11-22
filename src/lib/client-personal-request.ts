"use client";
/** Transport credentials are scoped to a single request to the local proxy.
 * The remote Virtuoso server authenticates them; no Maestro cookie is involved. */
import { buildAuthHeader, graphForPrefix, loadPersonalAuthSession, type PersonalAuthSession } from "@/lib/personal-auth";
import { personalWriteEndpoint } from "@/lib/personal-endpoints";

export function personalRequestHeaders(session: PersonalAuthSession): Record<string, string> {
  const authorization = buildAuthHeader(session);
  if (!authorization) throw new Error("No credentials are available for the personal graph server.");
  return {
    "x-personal-graph-store": session.graphStore,
    "x-personal-graph": session.graphPrefix,
    "x-personal-auth-type": session.authType,
    "x-personal-auth": authorization,
  };
}

/** Never attach a credential to a query addressed to another graph server.
 * Legacy personal queries may explicitly address /sparql; their XML authority
 * is not rewritten, but only the protected endpoint is authenticated. */
function requestedServer(body: unknown): string | null {
  if (typeof body !== "string") return null;
  let text = body;
  if (body.trimStart().startsWith("{")) {
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      if (obj.personalRead === true || typeof obj.update === "string") return "personal-operation";
      if (typeof obj.addr === "string") return obj.addr.slice(obj.addr.lastIndexOf("@") + 1);
      text = typeof obj.queryXml === "string" ? obj.queryXml : "";
    } catch { return null; }
  }
  const root = text.match(/<query\b([^>]*)>/i)?.[1] ?? "";
  const addr = root.match(/\baddr\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at+1).replace(/&amp;/g, "&") : null;
}
export async function withPersonalProxyCredentials(url: string, init?: RequestInit): Promise<{init: RequestInit; authenticated: boolean}> {
  if (!/\/proxy\/api\/(?:sparql|fct)(?:[/?]|$)/.test(url) || typeof init?.body !== "string")
    return { init: init ?? {}, authenticated: false };
  const target = requestedServer(init.body);
  if (!target) return { init, authenticated: false };
  const session = await loadPersonalAuthSession();
  if (!session) return { init, authenticated: false };
  const authUrl = personalWriteEndpoint(session);
  const xml = init.body.trimStart().startsWith("{")
    ? (()=>{try{return (JSON.parse(init.body as string) as {queryXml?:string}).queryXml??"";}catch{return "";}})()
    : init.body;
  const statusDependent = /<(?:[\w-]+:)?status\b|<view\b[^>]*\btype\s*=\s*["']validate["']/i.test(xml);
  const base = graphForPrefix(session.graphPrefix);
  const body = init.body as string;
  let graph = "";
  if (body.trimStart().startsWith("{")) {
    try { const obj=JSON.parse(body) as {addr?:string}; graph=(obj.addr??"").split("@")[0]; }catch{}
  }
  const personalAddress = target === session.graphStore && (graph===base || graph.startsWith(`${base}/`) || graph.startsWith(`${base}#`));
  const sameOriginTarget = (()=>{try{return new URL(target).origin===new URL(authUrl).origin;}catch{return false;}})();
  if (target !== "personal-operation" && target !== authUrl && !personalAddress && !(statusDependent && sameOriginTarget))
    return { init, authenticated: false };
  const headers = new Headers(init.headers);
  for (const [key,value] of Object.entries(personalRequestHeaders(session))) headers.set(key,value);
  return { init: {...init, headers, cache: "no-store"}, authenticated: true };
}

export function personalAuthenticatedAddr(session: PersonalAuthSession): string {
  return `${graphForPrefix(session.graphPrefix)}@${personalWriteEndpoint(session)}`;
}
