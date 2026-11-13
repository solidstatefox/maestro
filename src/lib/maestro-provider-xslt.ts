"use client";

import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";

/** Generic XSLT input envelope. All providers receive mctx:query; Record
 * providers also receive mctx:describe. Derived FCT/SPARQL result XML is
 * provided on demand, not duplicated in ad-hoc JS data models.
 */
export const MAESTRO_CONTEXT_NS = "gttp://ggg.maestro.ui/context";
const xmlDoc = (text: string, label: string): XMLDocument => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error(`Invalid ${label} XML.`);
  return doc;
};

export function createProviderXsltContext(options: {
  queryXml: string;
  describeXml?: string;
  resultXml?: string;
  componentUrn?: string;
  metadata?: Record<string, string>;
  facetValues?: Record<string, string[]>;
}): string {
  const live = xmlDoc(options.queryXml, "live FCT query");
  if (live.documentElement.localName !== "query") throw new Error("The provider requires an FCT query root.");
  const context = xmlDoc(`<mctx:context xmlns:mctx="${MAESTRO_CONTEXT_NS}"><mctx:query/><mctx:describe/><mctx:results/><mctx:component/><mctx:metadata/><mctx:facet-values/><mctx:query-text/></mctx:context>`, "provider context");
  const attach = (name: string, source?: XMLDocument): void => {
    if (source) context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, name)[0].appendChild(context.importNode(source.documentElement, true));
  };
  attach("query", live);
  if (options.describeXml) attach("describe", xmlDoc(options.describeXml, "Record DESCRIBE"));
  if (options.resultXml) attach("results", xmlDoc(options.resultXml, "derived query results"));
  if (options.componentUrn) context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "component")[0].setAttribute("uri", options.componentUrn);
  context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "query-text")[0].textContent = options.queryXml;
  const metadata = context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "metadata")[0];
  for (const [name, value] of Object.entries(options.metadata ?? {})) {
    const entry = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:entry");
    entry.setAttribute("name", name);
    entry.textContent = value;
    metadata.appendChild(entry);
  }
  const facets = context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "facet-values")[0];
  for (const [key, values] of Object.entries(options.facetValues ?? {})) {
    const facet = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:facet");
    facet.setAttribute("key", key);
    for (const value of values) {
      const term = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:term");
      term.textContent = value;
      facet.appendChild(term);
    }
    facets.appendChild(facet);
  }
  return new XMLSerializer().serializeToString(context);
}

export async function transformProviderXslt(
  stylesheet: string,
  options: Parameters<typeof createProviderXsltContext>[0],
  signal?: AbortSignal,
): Promise<string> {
  return transformWithMaestroSaxon(stylesheet, createProviderXsltContext(options), { signal, outputLimit: 24_000_000, providerExecutableMarkup: true });
}
