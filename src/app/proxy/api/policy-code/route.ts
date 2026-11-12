import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { validPolicyIri } from "@/lib/policy-approval-store";
import { queryGraphPolicyTriples } from "@/lib/policy-graph-catalog";

/** Read the policy's RDF triples from the selected graph, without executing it. */
export async function POST(request: Request) {
  const denied = requirePersonalLogin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { policy?: unknown; queryXml?: unknown };
    if (!validPolicyIri(body.policy) || typeof body.queryXml !== "string" || body.queryXml.length > 200000)
      return NextResponse.json({ error: "A policy IRI and FCT query are required." }, { status: 400 });
    const policy = body.policy;
    const rows = await queryGraphPolicyTriples(body.queryXml, policy, request);
    const code = rows.map((row) => {
      const term = row.type === "uri" ? `<${row.value}>` : `${JSON.stringify(row.value)}${row.lang ? `@${row.lang}` : row.datatype ? `^^<${row.datatype}>` : ""}`;
      return `<${policy}> <${row.predicate}> ${term} .`;
    }).join("\n");
    return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load policy code." }, { status: 502 });
  }
}
