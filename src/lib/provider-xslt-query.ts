"use client";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { sparqlBindingsToXml } from "@/lib/sparql-results-xml";
import { providerFctContextXml } from "@/lib/provider-fct-context";
import { readProviderShapeXml } from "@/lib/provider-shape";

/** Run a provider-owned XSLT to derive SPARQL from the live query and
 * the provider's declared SHACL shape. No geographic predicates in Maestro. */
export async function compileProviderXsltQuery(queryXml: string, shapeUri: string, stylesheet: string, signal?: AbortSignal): Promise<{ sparql: string; timeoutMs: number }> {
  if (!shapeUri || !stylesheet) throw new Error("The provider has no SHACL shape or query stylesheet.");
  const shapeXml = await readProviderShapeXml(shapeUri, signal);
  const compiled = providerFctContextXml(queryXml, shapeXml, shapeUri);
  const output = await transformWithMaestroSaxon(stylesheet, compiled.xml, { signal });
  const doc = new DOMParser().parseFromString(output, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "query-request") throw new Error("Provider returned an invalid query request.");
  if (doc.documentElement.getAttribute("valid") === "false") throw new Error("Provider input shape has no usable query alternatives.");
  const sparql = doc.documentElement.getElementsByTagName("sparql")[0]?.textContent?.trim() ?? "";
  if (!sparql || !/\bSELECT\b/i.test(sparql) || !/\bWHERE\b/i.test(sparql))
    throw new Error("Provider XSLT did not return an valid derived SPARQL query.");
  return { sparql, timeoutMs: compiled.timeoutMs };
}

/** Apply any provider-owned result stylesheet. The returned XML is deliberately
 * not interpreted as a map object in the generic host. */
export async function transformProviderQueryResults(payload: Parameters<typeof sparqlBindingsToXml>[0], stylesheet: string, signal?: AbortSignal): Promise<Document> {
  const xml = sparqlBindingsToXml(payload);
  const output = await transformWithMaestroSaxon(stylesheet, xml, { signal });
  const doc = new DOMParser().parseFromString(output, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Provider result stylesheet returned invalid XML.");
  return doc;
}
