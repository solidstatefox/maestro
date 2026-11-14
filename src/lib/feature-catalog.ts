"use client";

import { fctProjectPage, type Projection } from "./fct-client";
import type { FeatureKind, FeatureItem } from "@/lib/feature-view-xslt";
import { toLabel } from "@/lib/uri-labels";

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
const approval: Projection[] = [
  ...["status", "triggeredBy", "lastRequestedBy", "lastRequestDate", "matchedRecord", "lastRequestHistory", "lastRequestComponent"]
    .map(name => ({ property: `${mui}${name}`, direction: "forward" as const })),
];

function activation(feature: FeatureKind, target: string): string {
  if (feature === "fsm-providers") return "Activation: RDF-defined state transitions executed by the XState v5 adapter.";
  if (feature === "curators") return "Activation: approve this curator to trust its mui:widget RDF list of providers.";
  if (feature === "policies") return "Activation: a matching resource must satisfy this provider's SHACL policy.";
  if (feature === "transcoders") return "Activation: the input must satisfy the transcoder's input shape.";
  return `Activation: the approved provider must match the current resource${target ? ` (${toLabel(target)})` : ""}.`;
}

/** Project ONLY the FCT result page, never repeat a catalog membership query. */
export async function featureItemsFromFct(
  queryXml: string, uris: string[], feature: FeatureKind, bookmarked: boolean, signal?: AbortSignal,
): Promise<FeatureItem[]> {
  const records = await fctProjectPage(queryXml, uris, [...meta, ...(bookmarked ? approval : [])], signal, bookmarked);
  // Feature *items* come exclusively from FCT. Approval is independent
  // client-policy metadata: a listed provider is effectively Approved only
  // while a current curator is Approved for its implementation digest.
  let approvals = new Map<string,"Approved" | "Pending" | null>();
  if (bookmarked && uris.length) {
    const response = await fetch("/proxy/api/service?service=maestro&operationId=policies", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({action:"statuses",uris:[...new Set(uris)].slice(0,500)}),
    });
    const body = await response.json() as {error?:string;approvals?:Array<{uri:string;status:"Approved"|"Pending"|null}>};
    if(!response.ok || body.error)throw new Error(body.error||`Provider approval lookup failed (HTTP ${response.status})`);
    approvals = new Map((body.approvals??[]).map(item=>[item.uri,item.status]));
  }
  return records.map(record => {
    const values = (iri: string) => record.properties.get(iri);
    const resolvedTarget = first(values(`${mui}forClass`)) || first(values(`${sh}class`));
    const statusValues = (values(`${mui}status`) || []).map(item => item.value);
    const status = bookmarked ? (approvals.get(record.uri) ?? "") :
      statusValues.includes(`${mui}Approved`) ? "Approved" : statusValues.includes(`${mui}Pending`) ? "Pending" : "";
    const detail = first(values(`${mui}recordShape`)) || first(values(`${mui}widget`)) || first(values(`${otc}outputShape`));
    const item: FeatureItem & Record<string, string> = {
      uri: record.uri,
      label: first(values(`${rdf}label`)) || first(values(`${dct}title`)) || (record.label && record.label !== record.uri ? record.label : toLabel(record.uri)),
      description: first(values(`${dct}description`)) || first(values(`${rdf}comment`)),
      author: first(values("https://schema.org/author")) || first(values(`${dct}creator`)),
      target: resolvedTarget,
      detail,
      activation: activation(feature, resolvedTarget),
      ...(bookmarked ? {
        bookmarked: "true", status,
        triggeredBy: (values(`${mui}triggeredBy`) ?? []).map(v => v.value).join(", "),
        lastRequestedBy: first(values(`${mui}lastRequestedBy`)),
        lastRequestDate: first(values(`${mui}lastRequestDate`)),
        matchedRecord: first(values(`${mui}matchedRecord`)),
        lastRequestHistory: first(values(`${mui}lastRequestHistory`)),
        lastRequestComponent: first(values(`${mui}lastRequestComponent`)),
      } : { bookmarked: "false", status: "" }),
    };
    return item;
  });
}
