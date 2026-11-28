"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Provider-discovery provenance and the bookmark precondition are browser
 * workflows over the user's personal RDF graphs.  The hosting proxy does not
 * interpret a policy, decide approval, or persist discovery metadata. */
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { pendingApprovalController } from "@/lib/app-lifecycle/pending-approvals";
import { personalContext, personalExists, updatePersonal } from "@/lib/client-personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA = "https://schema.org/identifier";
const HISTORY_VISIT = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit";
const HISTORY_QUERY = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML";
const valid = (value: string): boolean => value.length > 0 && value.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i.test(value);
const iri = (value: string): string => { if (!valid(value)) throw new Error("Invalid policy provenance IRI."); return `<${value}>`; };
const quote = (value: string): string => JSON.stringify(value);

export async function isClientQueryBookmarked(queryXml: string, signal?: AbortSignal): Promise<boolean> {
  if (!queryXml || queryXml.length > 200_000) return false;
  const ctx = await personalContext();
  const canonical = canonicalQueryIdentityXml(queryXml);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,"0")).join("")}`;
  return personalExists(`GRAPH ${iri(`${resolveGraph(GRAPH.BOOKMARKS, ctx.base)}`)} { ?bookmark <${SCHEMA}> ${quote(hash)} }`, ctx, signal,"client-provider-provenance:isClientQueryBookmarked",{tab:"personal",ribbon:"session"});
}

export type ClientPolicyDiscoveryContext = { component: string; queryXml: string; history?: string; record?: string };
export async function writeClientProviderDiscovery(uris: string[], context: ClientPolicyDiscoveryContext, signal?: AbortSignal): Promise<void> {
  if (!valid(context.component) || !(context.component.startsWith("gttp://ggg.maestro.ui/component/") || context.component.startsWith("urn:maestro:component:")))
    throw new Error("Provider discovery must have a registered Maestro UI component.");
  if (context.record && !valid(context.record)) throw new Error("Invalid provider discovery Record IRI.");
  if (context.history && !valid(context.history)) throw new Error("Invalid provider discovery History IRI.");
  const policies = [...new Set(uris)];
  if (policies.length > 500 || policies.some(policy => !valid(policy))) throw new Error("Invalid provider discovery identifiers.");
  if (!policies.length) return;
  // Discovery means a real component matched these resources to this query or
  // Record; it does not grant approval. Keep the View badge scoped to the
  // currently active canvas even if provenance persistence is unavailable.
  pendingApprovalController.match(context.queryXml,policies,context.record);
  const ctx = await personalContext();
  const graph = iri(`${resolveGraph(GRAPH.POLICY_APPROVALS, ctx.base)}`);
  const historyValid = Boolean(context.history && context.queryXml.length <= 200_000 &&
    await personalExists(`GRAPH ${iri(`${resolveGraph(GRAPH.HISTORY, ctx.base)}`)} {
      ${iri(context.history!)} a <${HISTORY_VISIT}> ; <${HISTORY_QUERY}> ${quote(context.queryXml)} .
    }`, ctx, signal,"client-provider-provenance:writeClientProviderDiscovery",{tab:"personal",ribbon:"session"}));
  const match = iri(context.record ?? context.component);
  const metadata = [
    `<${MUI}lastRequestedBy> ${match}`,
    `<${MUI}lastRequestDate> ?now`,
    `<${MUI}lastRequestComponent> ${iri(context.component)}`,
    ...(context.record ? [`<${MUI}matchedRecord> ${iri(context.record)}`] : []),
    ...(historyValid && context.history ? [`<${MUI}lastRequestHistory> ${iri(context.history)}`] : []),
  ];
  const remove = ["lastRequestedBy", "lastRequestDate", "lastRequestComponent", "lastRequestHistory", "matchedRecord"];
  await updatePersonal(`DELETE { GRAPH ${graph} { ${remove.map((name,index) => `?policy <${MUI}${name}> ?old${index} .`).join(" ")} } }
    INSERT { GRAPH ${graph} { ?policy ${metadata.join(" ; ")} . } }
    WHERE { VALUES ?policy { ${policies.map(iri).join(" ")} } BIND(NOW() AS ?now)
      ${remove.map((name,index) => `OPTIONAL { GRAPH ${graph} { ?policy <${MUI}${name}> ?old${index} } }`).join(" ")}
    }`,signal,undefined,"client-provider-provenance:writeClientProviderDiscovery",undefined,"view",{tab:"personal",ribbon:"session"});
}
