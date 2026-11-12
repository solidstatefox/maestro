import { createHash } from "node:crypto";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { getHistoryGraph, getUserGraph, askPersonalSparql, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA = "https://schema.org/identifier";
const POLICY_GRAPH_SUFFIX = "#policy-approvals";
export type PolicyApprovalStatus = "Approved" | "Pending" | null;
export type PolicyApprovalEntry = { uri: string; status: PolicyApprovalStatus; triggeredBy: string[]; lastRequestedBy?: string; lastRequestDate?: string; matchedRecord?: string; lastRequestHistory?: string; lastRequestComponent?: string };
export type PolicyMatchContext = { component: string; queryXml: string; history?: string; record?: string };

export function validPolicyIri(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length < 4096 &&
    /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
}
function iri(value: string): string {
  if (!validPolicyIri(value)) throw new Error("Invalid RDF IRI for policy approval.");
  return `<${value}>`;
}
export const policyApprovalGraph = (request: Request): string => `${getUserGraph(request)}${POLICY_GRAPH_SUFFIX}`;

/** Approval-management requests require the calling FCT query to be saved as a bookmark.
 * Verify this in the personal store, not from a client-provided boolean or ID.
 */
export async function verifyApprovalBookmark(queryXml: string, request: Request): Promise<boolean> {
  if (!queryXml || queryXml.length > 200000) return false;
  const canonical = canonicalQueryIdentityXml(queryXml);
  const hash = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  const graph = `${getHistoryGraph(request).split("#", 1)[0]}#bookmarks`;
  return askPersonalSparql(`ASK WHERE { GRAPH ${iri(graph)} { ?bookmark <${SCHEMA}> ${JSON.stringify(hash)} } }`, 15000, request);
}

export async function readPolicyApprovals(uris: string[], request: Request): Promise<PolicyApprovalEntry[]> {
  const distinct = [...new Set(uris)];
  if (!distinct.length) return [];
  if (distinct.length > 500 || distinct.some(uri => !validPolicyIri(uri))) throw new Error("Expected at most 500 valid policy IRIs.");
  const graph = iri(policyApprovalGraph(request));
  const values = distinct.map(iri).join(" ");
  const query = `SELECT ?policy ?status ?trigger ?lastRequestedBy ?lastRequestDate ?matchedRecord ?lastRequestHistory ?lastRequestComponent WHERE { VALUES ?policy { ${values} } OPTIONAL { GRAPH ${graph} { ?policy <${MUI}status> ?status . OPTIONAL { ?policy <${MUI}triggeredBy> ?trigger } OPTIONAL { ?policy <${MUI}lastRequestedBy> ?lastRequestedBy } OPTIONAL { ?policy <${MUI}lastRequestDate> ?lastRequestDate } OPTIONAL { ?policy <${MUI}matchedRecord> ?matchedRecord } OPTIONAL { ?policy <${MUI}lastRequestHistory> ?lastRequestHistory } OPTIONAL { ?policy <${MUI}lastRequestComponent> ?lastRequestComponent } } } }`;
  const payload = await queryPersonalSparql(query, 20000, request);
  const rows = payload.results?.bindings ?? [];
  return distinct.map((uri) => {
    const matching = rows.filter((row) => row.policy?.value === uri);
    const status = matching.some(row => row.status?.value === `${MUI}Approved`) ? "Approved" : matching.some(row => row.status?.value === `${MUI}Pending`) ? "Pending" : null;
    return { uri, status, triggeredBy: [...new Set(matching.map(row => row.trigger?.value ?? "").filter(Boolean))], lastRequestedBy: matching.map(row => row.lastRequestedBy?.value).find(Boolean), lastRequestDate: matching.map(row => row.lastRequestDate?.value).find(Boolean), matchedRecord: matching.map(row => row.matchedRecord?.value).find(Boolean), lastRequestHistory: matching.map(row => row.lastRequestHistory?.value).find(Boolean), lastRequestComponent: matching.map(row => row.lastRequestComponent?.value).find(Boolean) };
  });
}

/** Persist only a successful SHACL eligibility match, never a catalog listing.
 * The UI component is mandatory; the Record and matching History visit are
 * independent optional provenance. We deliberately have no legacy fallback.
 */
export async function discoverPolicyApprovals(uris: string[], context: PolicyMatchContext, request: Request): Promise<void> {
  if (!validPolicyIri(context.component) || !context.component.startsWith("gttp://ggg.maestro.ui/component/"))
    throw new Error("A registered Maestro UI component is required for policy discovery.");
  if (context.record && !validPolicyIri(context.record)) throw new Error("Invalid matching Record IRI.");
  if (context.history && !validPolicyIri(context.history)) throw new Error("Invalid History visit IRI.");
  const policies = [...new Set(uris)];
  if (policies.length > 500 || policies.some(policy => !validPolicyIri(policy)))
    throw new Error("Expected at most 500 discovered policy IRIs.");
  if (!policies.length) return;
  const graph = iri(policyApprovalGraph(request));
  const values = policies.map(iri).join(" ");
  // A History ID can lag discovery while the visit is being saved. Record it
  // only if the URI genuinely exists in this user's own History graph.
  const historyGraph = iri(`${getHistoryGraph(request).split("#", 1)[0]}#history`);
  const historyIsValid = context.history && context.queryXml.length <= 200000 ? await askPersonalSparql(`ASK WHERE { GRAPH ${historyGraph} {
    ${iri(context.history)} a <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit> ;
      <https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML> ${JSON.stringify(context.queryXml)} .
  } }`, 15000, request) : false;
  const match = context.record ? iri(context.record) : iri(context.component);
  const metadata = [
    `<${MUI}lastRequestedBy> ${match}`,
    `<${MUI}lastRequestDate> ?now`,
    `<${MUI}lastRequestComponent> ${iri(context.component)}`,
    ...(context.record ? [`<${MUI}matchedRecord> ${iri(context.record)}`] : []),
    ...(historyIsValid && context.history ? [`<${MUI}lastRequestHistory> ${iri(context.history)}`] : []),
  ];
  const remove = ["lastRequestedBy", "lastRequestDate", "lastRequestComponent", "lastRequestHistory", "matchedRecord"];
  await updatePersonalSparql(`DELETE { GRAPH ${graph} { ${remove.map((name, index) => `?policy <${MUI}${name}> ?old${index} .`).join(" ")} } }
    INSERT { GRAPH ${graph} { ?policy ${metadata.join(" ; ")} . } }
    WHERE { VALUES ?policy { ${values} } BIND(NOW() AS ?now)
      ${remove.map((name, index) => `OPTIONAL { GRAPH ${graph} { ?policy <${MUI}${name}> ?old${index} } }`).join(" ")}
    }`, 20000, request);
  // Newly discovered policies are Pending; already Approved policies remain Approved.
  await updatePersonalSparql(`INSERT { GRAPH ${graph} { ?policy <${MUI}status> <${MUI}Pending> ; <${MUI}triggeredBy> ${match} } }
    WHERE { VALUES ?policy { ${values} } FILTER NOT EXISTS { GRAPH ${graph} { ?policy <${MUI}status> ?existing } } }`, 20000, request);
}

/** A provider cannot execute merely because it was discovered or selected. */
export async function isApprovedPolicy(policy: string, request: Request): Promise<boolean> {
  return validPolicyIri(policy) && askPersonalSparql(`ASK WHERE { GRAPH ${iri(policyApprovalGraph(request))} { ${iri(policy)} <${MUI}status> <${MUI}Approved> } }`, 15000, request);
}

export async function writePolicyApproval(policy: string, status: PolicyApprovalStatus, request: Request): Promise<void> {
  const graph = iri(policyApprovalGraph(request));
  const node = iri(policy);
  if (status === null) {
    await updatePersonalSparql(`DELETE WHERE { GRAPH ${graph} { ${node} ?predicate ?value } }`, 20000, request);
    return;
  }
  const value = iri(`${MUI}${status}`);
  await updatePersonalSparql(`DELETE { GRAPH ${graph} { ${node} <${MUI}status> ?old } }
    INSERT { GRAPH ${graph} { ${node} <${MUI}status> ${value} } }
    WHERE { OPTIONAL { GRAPH ${graph} { ${node} <${MUI}status> ?old } } }`, 20000, request);
}

/** Atomically approve or pend a set of policies that passed endpoint validation. */
export async function writePolicyApprovals(policies: string[], status: Exclude<PolicyApprovalStatus, null>, request: Request): Promise<void> {
  const distinct = [...new Set(policies)];
  if (!distinct.length) return;
  if (distinct.length > 500 || distinct.some(policy => !validPolicyIri(policy)))
    throw new Error("Expected at most 500 valid policy IRIs.");
  const graph = iri(policyApprovalGraph(request));
  const values = distinct.map(iri).join(" ");
  await updatePersonalSparql(`DELETE { GRAPH ${graph} { ?policy <${MUI}status> ?old } }
    INSERT { GRAPH ${graph} { ?policy <${MUI}status> <${MUI}${status}> } }
    WHERE { VALUES ?policy { ${values} }
      OPTIONAL { GRAPH ${graph} { ?policy <${MUI}status> ?old } }
    }`, 20000, request);
}
