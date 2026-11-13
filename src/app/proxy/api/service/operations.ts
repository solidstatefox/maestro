/** Final-stage internal Maestro service operations. Strict allowlist: no path or
 * module names are accepted from clients and no user-controlled URL is fetched.
 * Each operation retains its original authentication/validation contract and
 * returns its original Response (including NDJSON streams and Set-Cookie). */
import { NextResponse } from "next/server";

type Handler = (request: Request) => Promise<Response>;
const operations: Record<string, { GET?: Handler; POST?: Handler }> = {
  'appbar-buttons': { POST: async request => (await import("@/app/proxy/api/service/handlers/appbar-buttons")).POST(request) },
  'auth': { POST: async request => (await import("@/app/proxy/api/service/handlers/auth")).POST(request) },
  'bookmark-analysis': { POST: async request => (await import("@/app/proxy/api/service/handlers/bookmark-analysis")).POST(request) },
  'graph-seed': { POST: async request => (await import("@/app/proxy/api/service/handlers/graph-seed")).POST(request) },
  'ontology': { POST: async request => (await import("@/app/proxy/api/service/handlers/ontology")).POST(request), GET: async request => (await import("@/app/proxy/api/service/handlers/ontology")).GET(request) },
  'otc': { POST: async request => (await import("@/app/proxy/api/service/handlers/otc")).POST(request), GET: async request => (await import("@/app/proxy/api/service/handlers/otc")).GET(request) },
  'otc-chat': { POST: async request => (await import("@/app/proxy/api/service/handlers/otc-chat")).POST(request), GET: async request => (await import("@/app/proxy/api/service/handlers/otc-chat")).GET(request) },
  'otc-import': { POST: async request => (await import("@/app/proxy/api/service/handlers/otc-import")).POST(request) },
  'personal-facet-providers': { POST: async request => (await import("@/app/proxy/api/service/handlers/personal-facet-providers")).POST(request) },
  'perspectives': { POST: async request => (await import("@/app/proxy/api/service/handlers/perspectives")).POST(request) },
  'policies': { POST: async request => (await import("@/app/proxy/api/service/handlers/policies")).POST(request) },
  'query-favorites': { POST: async request => (await import("@/app/proxy/api/service/handlers/query-favorites")).POST(request), GET: async request => (await import("@/app/proxy/api/service/handlers/query-favorites")).GET(request) },
  'record-status': { POST: async request => (await import("@/app/proxy/api/service/handlers/record-status")).POST(request) },
  'services': { POST: async request => (await import("@/app/proxy/api/service/handlers/services")).POST(request) },
};
export const MAESTRO_INTERNAL_OPERATIONS = Object.freeze(Object.keys(operations));

export async function dispatchMaestroService(request: Request, method: "GET" | "POST"): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("service") !== "maestro" || url.searchParams.getAll("operationId").length !== 1)
    return NextResponse.json({ error: "Invalid Maestro service operation." }, { status: 400 });
  const operation = operations[url.searchParams.get("operationId") ?? ""];
  const handler = operation?.[method];
  if (!handler) return NextResponse.json({ error: "Unknown or unsupported Maestro service operation." }, { status: 404 });
  // Prevent a cross-origin browser form from invoking an authenticated write.
  const origin = request.headers.get("origin");
  if (method === "POST" && origin && origin !== url.origin)
    return NextResponse.json({ error: "Cross-origin service operation is not allowed." }, { status: 403 });
  return handler(request);
}
