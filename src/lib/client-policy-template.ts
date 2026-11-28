"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
// The client build uses the same installed version pinned in the Maestro package.
import maestroPackage from "../../package.json";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const validIri = (value: string) => value.length > 0 && value.length <= 4096 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
export type ClientPolicyTemplate = { templateXslt: string; enrichmentXslt: string;
  nextName: string; nextVersion: string; debugSparql: string };

/** Formatting is a browser transform, not a privileged Service operation.
 * Resolve the XSLT from the authenticated personal RDF graph. BOTH the
 * ClassPolicy and its provider must currently be directly or curator-approved.
 * This is a presentation gate only; privileged actions reverify on server. */
export async function loadClientPolicyTemplate(template: string, signal?: AbortSignal): Promise<ClientPolicyTemplate> {
  if (!validIri(template)) throw new Error("A valid XSLT template URI is required.");
  const ctx = await personalContext();
  const graph = `${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`;
  const query = `PREFIX rdf: <${RDF}> PREFIX sh: <${SH}> PREFIX rdfs: <${RDFS}> PREFIX mui: <${MUI}>
    SELECT DISTINCT ?policy ?provider ?templateXslt ?enrichmentXslt WHERE {
      GRAPH <${graph}> {
        ?policy a mui:ClassPolicy ; mui:forClass ?class ; mui:widget ?widgetClass .
        ?provider a mui:Provider ; mui:accepts ?inputShape ; mui:widget <${template}> .
        ?inputShape a mui:InputShape ; sh:class ?class .
        <${template}> rdf:type/rdfs:subClassOf* ?widgetClass ; (rdf:value|mui:templateContent) ?templateXslt .
        OPTIONAL { <${template}> mui:enrichmentTemplate ?enrichmentTemplate .
          ?enrichmentTemplate (rdf:value|mui:templateContent) ?enrichmentXslt }
      }
    } LIMIT 50`;
  const rows = await selectPersonal(query, ctx, signal,"client-policy-template:loadClientPolicyTemplate","view",{tab:"record",ribbon:"session"});
  const actors = [...new Set(rows.flatMap(row => [row.policy?.value ?? "", row.provider?.value ?? ""]).filter(validIri))];
  const approvals = await readClientPolicyApprovals(actors, signal,"RecordTemplateApprovalLookup",{tab:"record",ribbon:"session"});
  const approved = new Set(approvals.filter(entry => entry.status === "Approved").map(entry => entry.uri));
  const selected = rows.find(row => approved.has(row.policy?.value ?? "") && approved.has(row.provider?.value ?? ""));
  const templateXslt = selected?.templateXslt?.value ?? "";
  const enrichmentXslt = selected?.enrichmentXslt?.value ?? "";
  if (!templateXslt) throw new Error(`Template ${template} is not available from an Approved policy and provider.`);
  if (templateXslt.length > 250_000 || enrichmentXslt.length > 250_000) throw new Error("Formatter XSLT exceeds its size limit.");
  return { templateXslt, enrichmentXslt, nextName: "next", nextVersion: maestroPackage.dependencies.next, debugSparql: query };
}
