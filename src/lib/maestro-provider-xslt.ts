"use client";

import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";

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
  // Keep the exact live XML only for resolving viewer-plane <a> references.
  // No <a> is ever passed as a data-plane WHERE constraint to a provider.
  const exact = xmlDoc(options.queryXml, "live FCT query");
  const detachedQueryXml = snapshotFctQueryXml(options.queryXml, "data");
  const live = xmlDoc(detachedQueryXml, "FCT query snapshot");
  if (live.documentElement.localName !== "query") throw new Error("The provider requires an FCT query root.");
  const context = xmlDoc(`<mctx:context xmlns:mctx="${MAESTRO_CONTEXT_NS}"><mctx:query/><mctx:describe/><mctx:results/><mctx:component/><mctx:metadata/><mctx:facet-values/><mctx:transported-facets/><mctx:query-text/></mctx:context>`, "provider context");
  const attach = (name: string, source?: XMLDocument): void => {
    if (source) context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, name)[0].appendChild(context.importNode(source.documentElement, true));
  };
  attach("query", live);
  if (options.describeXml) attach("describe", xmlDoc(options.describeXml, "Record DESCRIBE"));
  if (options.resultXml) attach("results", xmlDoc(options.resultXml, "derived query results"));
  if (options.componentUrn) context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "component")[0].setAttribute("uri", options.componentUrn);
  context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "query-text")[0].textContent = detachedQueryXml;
  const metadata = context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "metadata")[0];
  for (const [name, value] of Object.entries(options.metadata ?? {})) {
    const entry = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:entry");
    entry.setAttribute("name", name);
    entry.textContent = value;
    metadata.appendChild(entry);
  }
  // Every View / Analyze provider sees the same scope-qualified transported
  // facet descriptors. This is generic host metadata, not provider-specific
  // RDF logic. The path is resolved by original FCT element identity, and
  // exposes every forward/reverse hop for the existing merge-values engine.
  // Record (DESCRIBE) intentionally has no transported facet dependency.
  if (!options.describeXml) {
    const envelope = context.getElementsByTagNameNS(MAESTRO_CONTEXT_NS, "transported-facets")[0];
    const elements = Array.from(exact.getElementsByTagName("*"));
    const focus = elements.find(item => item.localName === "view")?.parentElement;
    if (focus) {
      const byId = new Map(elements.map(item => [item.getAttribute("id"), item]));
      for (const child of Array.from(focus.children).filter(item => item.localName === "a")) {
        const id = child.getAttribute("id") ?? "";
        const target = byId.get(child.getAttribute("href"));
        if (!id || !target || target === focus) continue;
        const path: Element[] = [];
        let node: Element | null = target;
        while (node && node !== focus) {
          if (node.localName !== "property" && node.localName !== "property-of" || !node.getAttribute("iri")) break;
          path.unshift(node);
          node = node.parentElement;
        }
        if (node !== focus || !path.length || path.length > 16) continue;
        const facet = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:facet");
        facet.setAttribute("id", id);
        facet.setAttribute("key", `alias:${id}`);
        facet.setAttribute("target-id", target.getAttribute("id") ?? "");
        facet.setAttribute("iri", path[path.length - 1].getAttribute("iri") ?? "");
        facet.setAttribute("direction", path[0].localName === "property-of" ? "reverse" : "forward");
        for (const step of path) {
          const hop = context.createElementNS(MAESTRO_CONTEXT_NS, "mctx:hop");
          hop.setAttribute("id", step.getAttribute("id") ?? "");
          hop.setAttribute("iri", step.getAttribute("iri") ?? "");
          hop.setAttribute("direction", step.localName === "property-of" ? "reverse" : "forward");
          facet.appendChild(hop);
        }
        envelope.appendChild(facet);
      }
    }
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
