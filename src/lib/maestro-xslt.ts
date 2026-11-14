import { transformWithMaestroSaxon } from "@/lib/maestro-browser-xslt";
import { snapshotFctQueryXml } from "@/lib/fct-query-api";

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


  const html = await transformWithMaestroSaxon(
    stylesheetText,
    new XMLSerializer().serializeToString(envelope),
    { recordUri, signal },
  );
  return new DOMParser().parseFromString(html, "text/html");
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
