import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { policyApprovalGraph, readPolicyApprovals, verifyApprovalBookmark, validPolicyIri, writePolicyApproval, writePolicyApprovals } from "@/lib/policy-approval-store";

import { queryGraphPolicies } from "@/lib/policy-graph-catalog";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";

/** Transport for the bookmarked policy-provider's XSLT actions. The provider
 * owns the UI logic; this endpoint enforces the authenticated bookmark boundary
 * and persists the ordinary RDF mui:status triples. */
export async function POST(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    const body = await request.json() as { queryXml?: unknown; action?: unknown; policies?: unknown; policy?: unknown };
    const action = body.action;
    // Reading discovery status is safe before bookmarking. Approve/forget and
    // explicit discovery continue to require a server-verified bookmark.
    if (action !== "list" && (typeof body.queryXml !== "string" || !(await verifyApprovalBookmark(body.queryXml, request))))
      return NextResponse.json({ error: "Bookmark this query before managing policy approvals.", bookmarkRequired: true }, { status: 409 });
    if (!["list", "approve", "pending", "forget", "approve-all"].includes(String(action)))
      return NextResponse.json({ error: "Unknown policy approval action." }, { status: 400 });
    const policies = action === "list" || action === "approve-all"
      ? (Array.isArray(body.policies) && body.policies.length <= 500
        ? [...new Set(body.policies)].filter(validPolicyIri) : [])
      : [body.policy];
    if (!policies.length || policies.some(uri => !validPolicyIri(uri)))
      return NextResponse.json({ error: "Policy IRIs are required." }, { status: 400 });
    // The provider targets RDF policies (including declared mui:Providers).
    // A non-policy item follows ordinary validation/error reporting.
    const policyIris = policies as string[];
    const policyValues = policyIris.map(uri => `<${uri}>`).join(" ");
    // Validate the entire selection in one query rather than one request per
    // card. The approval service never treats an arbitrary result as a policy.
    const local = await queryPersonalSparql(`SELECT DISTINCT ?policy WHERE {
      VALUES ?policy { ${policyValues} }
      { GRAPH <${getShapesGraph(request)}> { ?policy a ?type .
        VALUES ?type { <${MUI}ClassPolicy> <${MUI}Provider> } } }
      UNION
      { GRAPH <${policyApprovalGraph(request)}> {
        ?policy <${MUI}status> ?status ; <${MUI}lastRequestComponent> ?component .
        VALUES ?status { <${MUI}Pending> <${MUI}Approved> }
      } }
    }`, 20000, request);
    const verified = new Set((local.results?.bindings ?? []).map(row => row.policy?.value).filter(Boolean));
    const missing = policyIris.filter(uri => !verified.has(uri));
    if (missing.length) {
      // A list request may omit queryXml. A graph-server lookup requires the
      // current FCT query to identify the server; never pass unknown JSON to it.
      if (typeof body.queryXml !== "string")
        return NextResponse.json({ error: "An FCT query is required to verify policies outside the personal shapes graph." }, { status: 400 });
      for (const item of await queryGraphPolicies(body.queryXml, request, missing)) verified.add(item.uri);
      const invalid = missing.find(uri => !verified.has(uri));
      if (invalid) return NextResponse.json({ error: `Resource ${invalid} is not a policy.` }, { status: 422 });
    }
    if (action === "approve-all") {
      await writePolicyApprovals(policyIris, "Approved", request);
    }
    if (action === "approve" || action === "pending" || action === "forget") {
      await writePolicyApproval((policies as string[])[0], action === "forget" ? null : action === "approve" ? "Approved" : "Pending", request);
    }
    const bookmarked = typeof body.queryXml === "string" && await verifyApprovalBookmark(body.queryXml, request);
    return NextResponse.json({ entries: await readPolicyApprovals(policies as string[], request), bookmarked }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not manage policy approval." }, { status: 502 });
  }
}
