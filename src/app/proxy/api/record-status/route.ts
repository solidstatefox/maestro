import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { isRecordStatusName } from "@/lib/personal-status-vocabulary";
import { recordLocatedPage, recordPageStatus, updateRecordStatus, updateHiddenRecord, buildFederatedStatusAsk, queryFederatedStatusCounts, queryFederatedStatusResults } from "@/lib/personal-status-server";

export async function POST(request: Request) {
  const loginRequired = requirePersonalLogin(request);
  if (loginRequired) return loginRequired;
  try {
    const body = await request.json() as { action?: string; uri?: unknown; uris?: unknown; status?: unknown; enabled?: unknown; queryXml?: unknown; queryHash?: unknown; executionTime?: unknown; selected?: unknown; limit?: unknown; offset?: unknown };
    const hash = typeof body.queryHash === "string" ? body.queryHash : "";
    const uris = Array.isArray(body.uris) ? body.uris.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 150) : [];
    if (body.action === "preview-facets-ask" && typeof body.queryXml === "string") {
      const { askQuery } = await buildFederatedStatusAsk(request, body.queryXml, hash);
      return NextResponse.json({ sparql: askQuery }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "results" && typeof body.queryXml === "string") return NextResponse.json(
      await queryFederatedStatusResults(request, body.queryXml, hash, Array.isArray(body.selected) ? body.selected.filter((s): s is string => typeof s === "string") : [], Number(body.limit), Number(body.offset)),
      { headers: { "Cache-Control": "no-store" } });
    if (body.action === "facets" && typeof body.queryXml === "string") return NextResponse.json(await queryFederatedStatusCounts(request, body.queryXml, hash), { headers: { "Cache-Control": "no-store" } });
    if (body.action === "page") return NextResponse.json(await recordPageStatus(request, hash, uris), { headers: { "Cache-Control": "no-store" } });
    if (body.action === "located" && typeof body.executionTime === "string") {
      await recordLocatedPage(request, hash, uris, body.executionTime);
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "set" && typeof body.uri === "string" && isRecordStatusName(body.status) && typeof body.enabled === "boolean") {
      await updateRecordStatus(request, hash, body.uri, body.status, body.enabled);
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "hide" && typeof body.uri === "string" && typeof body.enabled === "boolean") {
      await updateHiddenRecord(request, body.uri, body.enabled);
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Invalid Record status request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Record status operation failed." }, { status: 502 });
  }
}
