import { rescheduleMaestroQueries } from "@/lib/graph-server-query-scheduler";
import { NextResponse } from "next/server";
import { normalizeMaestroConcurrency } from "@/lib/maestro-concurrency";
import { clientFromRequest, MAESTRO_CLIENT_COOKIE, newProxyClientId, saveProxyClientPreferences } from "@/lib/maestro-proxy-client-preferences";

/** Called after login restoration and every Sheet edit. No graph credentials are transmitted. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid preference payload" }, { status: 400 }); }
  const preferences = normalizeMaestroConcurrency(body);
  const existing = clientFromRequest(request);
  const id = existing ?? newProxyClientId();
  saveProxyClientPreferences(id, preferences);
  rescheduleMaestroQueries();
  const response = NextResponse.json({ ok: true, preferences }, { headers: { "Cache-Control": "no-store" } });
  if (!existing) response.cookies.set(MAESTRO_CLIENT_COOKIE, id, {
    path: "/", httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
