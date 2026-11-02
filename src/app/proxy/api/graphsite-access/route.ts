import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { logProxyCaller } from "@/lib/proxy-debug";
import { getPersonalSession, updatePersonalSparql } from "@/lib/personal-sparql";
import { describeUpstreamError } from "@/lib/upstream-error";

/**
 * Write-access probe for a graphsite. Inserts one test triple made of ephemeral URIs into the graph, then
 * deletes it again. `access` is true only when BOTH the INSERT and the DELETE succeed on the personal graph server.
 */
export async function POST(request: Request) {
  logProxyCaller(request, "graphsite-access.POST");
  const headers = { "Cache-Control": "no-store" };
  const body = await request.json().catch(() => null) as { graphsite?: unknown } | null;
  const graphsite = typeof body?.graphsite === "string" ? body.graphsite.trim() : "";
  if (!/^https?:\/\/[^\s<>"{}|\\^`]+$/i.test(graphsite)) {
    return NextResponse.json({ access: false, error: "A valid graphsite IRI is required." }, { status: 400, headers });
  }
  if (!getPersonalSession(request)) {
    return NextResponse.json({ access: false, error: "Not logged in to a personal graph server." }, { headers });
  }

  const id = randomUUID();
  const triple = `<urn:uuid:${id}> <urn:uuid:${randomUUID()}> <urn:uuid:${randomUUID()}>`;
  const insert = `INSERT DATA { GRAPH <${graphsite}> { ${triple} } }`;
  const remove = `DELETE DATA { GRAPH <${graphsite}> { ${triple} } }`;

  try {
    await updatePersonalSparql(insert, 15000, request);
  } catch (error) {
    return NextResponse.json({ access: false, stage: "insert", error: describeUpstreamError(error, "INSERT failed") }, { headers });
  }
  try {
    await updatePersonalSparql(remove, 15000, request);
  } catch (error) {
    return NextResponse.json({ access: false, stage: "delete", error: `The test triple was inserted but could not be deleted (${triple}): ${describeUpstreamError(error, "DELETE failed")}` }, { headers });
  }
  return NextResponse.json({ access: true }, { headers });
}
