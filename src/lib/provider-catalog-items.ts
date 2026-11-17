"use client";

import { fctProjectPage, type Projection } from "./fct-client";
import type { ProviderKind, ProviderCatalogItem } from "@/lib/provider-catalog-xslt";
import { toLabel } from "@/lib/uri-labels";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";

const mui = "gttp://ggg.maestro.ecosys/ns/ui#";
const rdf = "http://www.w3.org/2000/01/rdf-schema#";
const dct = "http://purl.org/dc/terms/";
const sh = "http://www.w3.org/ns/shacl#";
const otc = "gttp://ggg.openlink.sw/nlp/transcoder#";
const first = (values?: { value: string }[]) => values?.[0]?.value ?? "";
const meta: Projection[] = [
  ...[`${rdf}label`, `${dct}title`, `${dct}description`, `${rdf}comment`, "https://schema.org/author", `${dct}creator`,
    `${mui}forClass`, `${mui}recordShape`, `${mui}widget`, `${otc}outputShape`].map(property => ({ property, direction: "forward" as const })),
  { property: `${sh}class`, direction: "forward", path: [`${mui}accepts`, `${sh}class`] },
];

function activation(providerKind: ProviderKind, target: string): string {
  if (providerKind === "fsm-providers") return "Activation: RDF-defined state transitions executed by the XState v5 adapter.";
  if (providerKind === "perspectives") return "Activation: an approved PerspectiveWidget provider must match the current query scope.";
  if (providerKind === "analysis-providers") return "Activation: this RDF-declared Analysis provider must be approved before use in Analyze.";
  if (providerKind === "kinds") return "Activation: a KindProvider declares typed RDF term classification rules.";
  if (providerKind === "curators") return "Activation: approve this curator to trust its mui:widget RDF list of providers.";
  if (providerKind === "policies") return "Activation: a matching resource must satisfy this provider's SHACL policy.";
  if (providerKind === "transcoders") return "Activation: the input must satisfy the transcoder's input shape.";
  return `Activation: the approved provider must match the current resource${target ? ` (${toLabel(target)})` : ""}.`;
}

/** Project ONLY the FCT result page, never repeat a catalog membership query. */
export async function providerItemsFromFct(
  queryXml: string, uris: string[], providerKind: ProviderKind, bookmarked: boolean, signal?: AbortSignal,
): Promise<ProviderCatalogItem[]> {
  // Read-only FCT provider membership and metadata must never depend on an
  // approval machine, bookmarked-query Status projection or provenance read.
  const records = await fctProjectPage(queryXml, uris, meta, signal, false);
  // Provider *items* come exclusively from FCT. Approval is independent
  // client-policy metadata: a listed provider is effectively Approved only
  // while a current curator is Approved for its implementation digest.
  let approvals = new Map<string,"Approved" | "Pending" | null>();
  if (bookmarked && uris.length) {
    try {
      const entries = await readClientPolicyApprovals(uris.slice(0,500), signal);
      approvals = new Map(entries.map(entry=>[entry.uri,entry.status]));
    } catch (error) {
      if (signal?.aborted) throw error;
      // A missing/invalid approval policy only disables approval actions. It
      // must never erase the FCT provider cards or enter catalog.failed.
    }
  }
  return records.map(record => {
    const values = (iri: string) => record.properties.get(iri);
    const resolvedTarget = first(values(`${mui}forClass`)) || first(values(`${sh}class`));
    const status = bookmarked ? (approvals.get(record.uri) ?? "") : "";
    const detail = first(values(`${mui}recordShape`)) || first(values(`${mui}widget`)) || first(values(`${otc}outputShape`));
    const item: ProviderCatalogItem & Record<string, string> = {
      uri: record.uri,
      label: first(values(`${rdf}label`)) || first(values(`${dct}title`)) || (record.label && record.label !== record.uri ? record.label : toLabel(record.uri)),
      description: first(values(`${dct}description`)) || first(values(`${rdf}comment`)),
      author: first(values("https://schema.org/author")) || first(values(`${dct}creator`)),
      target: resolvedTarget,
      detail,
      activation: activation(providerKind, resolvedTarget),
      ...(bookmarked ? {
        bookmarked: "true", status,
        triggeredBy: "", lastRequestedBy: "", lastRequestDate: "",
        matchedRecord: "", lastRequestHistory: "", lastRequestComponent: "",
      } : { bookmarked: "false", status: "" }),
    };
    return item;
  });
}
