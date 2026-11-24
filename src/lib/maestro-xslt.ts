import { reportRecordPerformance } from "@/lib/record-performance";
import { annotateMaestroRecordRdfa } from "@/lib/maestro-record-rdfa";
import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";
import { executeRecordXsltSandboxQueries } from "@/lib/record-xslt-sparql-sandbox";

/** Independent, bounded client-memory cache for completed Record XSLT output.
 * Identity includes the exact stylesheet, Record, FCT response, live query and
 * gallery; approval changes or fresh RDF cannot reuse old formatted markup.
 * No login/session data or RDF is stored in localStorage. */
const RECORD_FORMAT_CACHE_LIMIT = 16;
const RECORD_FORMAT_CACHE_BYTES = 12_000_000;
const recordFormatHtmlCache = new Map<string, string>();
let cachedRecordFormatBytes = 0;

export function clearMaestroRecordFormatCache(): void {
  recordFormatHtmlCache.clear();
  cachedRecordFormatBytes = 0;
}
export function maestroRecordFormatCacheStats(): { entries: number; bytes: number } {
  return { entries: recordFormatHtmlCache.size, bytes: cachedRecordFormatBytes };
}
function fromRecordFormatCache(key: string): string | undefined {
  const html = recordFormatHtmlCache.get(key);
  if (html !== undefined) {
    recordFormatHtmlCache.delete(key);
    recordFormatHtmlCache.set(key, html);
  }
  return html;
}
function cacheRecordFormat(key: string, html: string): void {
  const weight = key.length * 2 + html.length * 2;
  if (weight > RECORD_FORMAT_CACHE_BYTES) return;
  const prior = recordFormatHtmlCache.get(key);
  if (prior !== undefined) cachedRecordFormatBytes -= key.length * 2 + prior.length * 2;
  recordFormatHtmlCache.delete(key);
  recordFormatHtmlCache.set(key, html);
  cachedRecordFormatBytes += weight;
  while (recordFormatHtmlCache.size > RECORD_FORMAT_CACHE_LIMIT || cachedRecordFormatBytes > RECORD_FORMAT_CACHE_BYTES) {
    const oldest = recordFormatHtmlCache.keys().next().value;
    if (oldest === undefined) break;
    const value = recordFormatHtmlCache.get(oldest)!;
    cachedRecordFormatBytes -= (oldest.length + value.length) * 2;
    recordFormatHtmlCache.delete(oldest);
  }
}


/**
 * Record-policy XSLT 3.0 adapter. The stylesheet is stored in the graph and
 * executed by Maestro-bundled SaxonJS in the SPA.
 * The only input is a read-only FCT DESCRIBE / live-query snapshot envelope.
 * Template-generated calls are interpreted by page.tsx after rendering.
 */
const CONTEXT_NS = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT_RESPONSE_NS = "http://openlinksw.com/services/facets/1.0/";
const FCT_QUERY_NS = "http://openlinksw.com/services/facets/1.0";

function checkedXml(source: string, description: string): XMLDocument {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(`${description} is not well-formed XML.`);
  }
  return document;
}

export async function transformMaestroRecordXslt(
  stylesheetText: string,
  describedRecord: XMLDocument,
  liveQueryXml: string,
  recordUri: string,
  signal?: AbortSignal,
  commonsImages: Array<{ url: string; credit?: string; license?: string; source?: string; title?: string }> = [],
  renderStage: "initial" | "complete" = "complete",
): Promise<Document> {
  if (stylesheetText.length > 250000) throw new Error("Record stylesheet is too large.");
  const stylesheet = checkedXml(stylesheetText, "Record XSLT stylesheet");
  if (stylesheet.documentElement.namespaceURI !== "http://www.w3.org/1999/XSL/Transform" ||
      !["stylesheet", "transform"].includes(stylesheet.documentElement.localName) ||
      stylesheet.documentElement.getAttribute("version") !== "3.0") {
    throw new Error("Record templates must use XSLT 3.0.");
  }
  if (describedRecord.documentElement.localName !== "facets" ||
      describedRecord.documentElement.namespaceURI !== FCT_RESPONSE_NS) {
    throw new Error("XSLT input must contain an FCT DESCRIBE response.");
  }
  const queryDocument = checkedXml(snapshotFctQueryXml(liveQueryXml, "data"), "FCT query API snapshot");
  if (queryDocument.documentElement.localName !== "query") throw new Error("The live query has no query root.");

  const envelope = checkedXml(
    `<mctx:context xmlns:mctx="${CONTEXT_NS}" xmlns:fct="${FCT_RESPONSE_NS}"><mctx:describe/><mctx:query/></mctx:context>`,
    "XSLT context",
  );
  envelope.getElementsByTagNameNS(CONTEXT_NS, "describe")[0]
    .appendChild(envelope.importNode(describedRecord.documentElement, true));
  envelope.getElementsByTagNameNS(CONTEXT_NS, "query")[0]
    .appendChild(envelope.importNode(queryDocument.documentElement, true));
  if (commonsImages.length) {
    const gallery = envelope.createElementNS(CONTEXT_NS, "mctx:commons-gallery");
    for (const image of commonsImages.slice(0, 8)) {
      if (!/^https:\/\/upload\.wikimedia\.org\//.test(image.url)) continue;
      const item = envelope.createElementNS(CONTEXT_NS, "mctx:commons-image");
      for (const key of ["url", "credit", "license", "source", "title"] as const) {
        item.setAttribute(key, image[key] ?? "");
      }
      gallery.appendChild(item);
    }
    envelope.documentElement.appendChild(gallery);
  }


  // Provider-authored SPARQL is evaluated in the generic read-only browser
  // sandbox before rendering. This is an explicit two-pass XSLT protocol:
  // the provider emits mctx:requests, Maestro executes the bounded SELECTs,
  // then supplies their RDF bindings to that same XSLT. No EURIO predicates
  // are hardcoded into the generic Record service.
  const phaseParam = Array.from(stylesheet.getElementsByTagNameNS("http://www.w3.org/1999/XSL/Transform", "param"))
    .some(node => node.getAttribute("name") === "maestroPhase");
  if (phaseParam && renderStage === "complete") {
    const planningStarted = performance.now();
    const planned = await transformWithMaestroSaxon(stylesheetText, new XMLSerializer().serializeToString(envelope),
      { recordUri, sandboxPhase: "queries", signal, outputLimit: 160_000 });
    reportRecordPerformance("xslt-query-plan", planningStarted);
    const enrichmentStarted = performance.now();
    const enrichment = await executeRecordXsltSandboxQueries(planned, queryDocument, describedRecord, signal);
    reportRecordPerformance("record-sandbox-enrichment", enrichmentStarted);
    if (enrichment) envelope.documentElement.appendChild(envelope.importNode(enrichment, true));
  }
  // Cache only after enrichment: newly changed RDF labels must not reuse
  // HTML produced from stale sandbox results.
  const sourceXml = new XMLSerializer().serializeToString(envelope);
  const cacheKey = `${recordUri.length}:${recordUri}${stylesheetText.length}:${stylesheetText}${sourceXml}`;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const previous = fromRecordFormatCache(cacheKey);
  if (previous !== undefined) {
    reportRecordPerformance("record-formatted-html", performance.now(), "cache-hit");
    return new DOMParser().parseFromString(previous, "text/html");
  }
  const renderStarted = performance.now();
  const html = await transformWithMaestroSaxon(stylesheetText, sourceXml, { recordUri, signal });
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  reportRecordPerformance("xslt-record-render", renderStarted, renderStage);
  const rdfaStarted = performance.now();
  const withRdfa = annotateMaestroRecordRdfa(new DOMParser().parseFromString(html, "text/html"), describedRecord, recordUri);
  reportRecordPerformance("record-rdfa-decoration", rdfaStarted);
  cacheRecordFormat(cacheKey, withRdfa.documentElement.outerHTML);
  return withRdfa;
}

/**
 * Run a policy-stored XSLT 3.0 query pivot with the same bundled
 * application SaxonJS processor as Record HTML formatting.
 * The original browser FCT tree is serialized into a read-only context.
 */
export async function transformMaestroQueryXslt(
  stylesheetText: string,
  describedRecord: XMLDocument,
  liveQueryXml: string,
  recordUri: string,
  signal?: AbortSignal,
): Promise<XMLDocument> {
  if (stylesheetText.length > 250000) throw new Error("Query pivot stylesheet is too large.");
  const stylesheet = checkedXml(stylesheetText, "Query pivot XSLT stylesheet");
  if (stylesheet.documentElement.namespaceURI !== "http://www.w3.org/1999/XSL/Transform" ||
      !["stylesheet", "transform"].includes(stylesheet.documentElement.localName) ||
      stylesheet.documentElement.getAttribute("version") !== "3.0") {
    throw new Error("Query pivot templates must use XSLT 3.0.");
  }
  if (describedRecord.documentElement.localName !== "facets" ||
      describedRecord.documentElement.namespaceURI !== FCT_RESPONSE_NS) {
    throw new Error("Query pivot input must contain an FCT Record snapshot.");
  }
  const queryDocument = checkedXml(snapshotFctQueryXml(liveQueryXml, "data"), "FCT query API snapshot");
  if (queryDocument.documentElement.localName !== "query") throw new Error("The live query has no query root.");
  const envelope = checkedXml(
    `<mctx:context xmlns:mctx="${CONTEXT_NS}" xmlns:fct="${FCT_RESPONSE_NS}"><mctx:describe/><mctx:query/></mctx:context>`,
    "XSLT query-pivot context",
  );
  envelope.getElementsByTagNameNS(CONTEXT_NS, "describe")[0]
    .appendChild(envelope.importNode(describedRecord.documentElement, true));
  envelope.getElementsByTagNameNS(CONTEXT_NS, "query")[0]
    .appendChild(envelope.importNode(queryDocument.documentElement, true));
  const xml = await transformWithMaestroSaxon(
    stylesheetText,
    new XMLSerializer().serializeToString(envelope),
    { recordUri, outputLimit: 100000, signal },
  );
  const transformed = checkedXml(xml, "SaxonJS query-pivot result");
  if (transformed.documentElement.namespaceURI !== FCT_QUERY_NS ||
      transformed.documentElement.localName !== "query") {
    throw new Error("The XSLT query pivot must generate an FCT query root.");
  }
  return transformed;
}
