/** Semantic FCT query identity. UI paging and execution timeouts do not
 * change which resources a query describes. Keep the serialized query intact
 * for execution; only normalize the bytes used by the identity digest. */
export function canonicalQueryIdentityXml(xml: string): string {
  return xml.trim()
    // Status facet selections do not change the identity of the observed query.
    // Keep the query-hash graph as a stable bus across Status filter changes.
    .replace(/<(?:[\w.-]+:)?status\b[^>]*>(?:[^<]*)<\/(?:[\w.-]+:)?status\s*>/gi, "")
    .replace(/<(?:[\w.-]+:)?status\b[^>]*\/\s*>/gi, "")
    .replace(
    /(<(?:[\w.-]+:)?view\b[^>]*)(\/?>)/gi,
    (_match, attributes: string, close: string) =>
      attributes.replace(/\s+(?:limit|offset|timeout|pageSize|page)=(["'])[^"']*\1/gi, "") + close,
  );
}
