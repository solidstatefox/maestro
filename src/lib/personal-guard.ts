import { NextResponse } from "next/server";
import { getPersonalSession } from "@/lib/personal-sparql";

/**
 * Personal-graph-store routes (History, Favorites, policies, ontology cache, loader) only work for a logged-in
 * user. Returns a 401 response when there is no session, or null when the request may proceed.
 */
export function requirePersonalLogin(request: Request): NextResponse | null {
  if (getPersonalSession(request)) return null;
  return NextResponse.json(
    { error: "Not logged in: the personal graph server is only used with a login session.", loginRequired: true },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
