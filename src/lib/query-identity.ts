/** Semantic FCT query identity. UI paging and execution timeouts do not
 * change which resources a query describes. Keep the serialized query intact
 * for execution; only normalize the bytes used by the identity digest. */
export function canonicalQueryIdentityXml(xml: string): string {
  return xml.trim()
    // State facet selections do not change the identity of the observed query.
    // Keep the query-hash graph as a stable bus across State filter changes.
    .replace(/<(?:[\w.-]+:)?state\b[^>]*>(?:[^<]*)<\/(?:[\w.-]+:)?state\s*>/gi, "")
    .replace(/<(?:[\w.-]+:)?state\b[^>]*\/\s*>/gi, "")
    .replace(
    /(<(?:[\w.-]+:)?view\b[^>]*)(\/?>)/gi,
    (_match, attributes: string, close: string) =>
      attributes.replace(/\s+(?:limit|offset|timeout|pageSize|page)=(["'])[^"']*\1/gi, "") + close,
  );
}
