/**
 * Record-policy XSLT 3.0 adapter. The stylesheet is stored in the graph and
 * executed by SaxonJS on the server, never by browser XSLTProcessor.
 * The only input is a read-only FCT DESCRIBE / live-query snapshot envelope.
 * Template-generated calls are interpreted by page.tsx after rendering.
 */
const CONTEXT_NS = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT_RESPONSE_NS = "http://openlinksw.com/services/facets/1.0/";

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
  const queryDocument = checkedXml(liveQueryXml, "Cloned live FCT query");
  if (queryDocument.documentElement.localName !== "query") throw new Error("The live query has no query root.");

  const envelope = checkedXml(
    `<mctx:context xmlns:mctx="${CONTEXT_NS}" xmlns:fct="${FCT_RESPONSE_NS}"><mctx:describe/><mctx:live-query/></mctx:context>`,
    "XSLT context",
  );
  envelope.getElementsByTagNameNS(CONTEXT_NS, "describe")[0]
    .appendChild(envelope.importNode(describedRecord.documentElement, true));
  envelope.getElementsByTagNameNS(CONTEXT_NS, "live-query")[0]
    .appendChild(envelope.importNode(queryDocument.documentElement, true));

  const response = await fetch("/proxy/api/xslt", {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stylesheetText,
      sourceXml: new XMLSerializer().serializeToString(envelope),
      recordUri,
    }),
  });
  const data: { html?: string; error?: string } = await response.json();
  if (!response.ok || typeof data.html !== "string") {
    throw new Error(data.error || `XSLT transformation failed (${response.status}).`);
  }
  if (data.html.length > 1000000) throw new Error("Record template generated too much HTML.");
  return new DOMParser().parseFromString(data.html, "text/html");
}
