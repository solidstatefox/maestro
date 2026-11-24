/** Re-target a saved Maestro Bookmark to the current application origin.
 * The underlying FCT query owns its own addr; this operation MUST NOT rewrite
 * the graph-server URL or any filter, node identity, or view attribute.
 * History cursor, ribbon, UI state, and hash are also preserved intact.
 * A corrupt/missing URL q may be recovered only from the same Bookmark's
 * separately stored canonical FCT query, never from the current Browse query.
 */
export function bookmarkAtCurrentHost(
  savedUrl: string,
  currentUrl: string,
  bookmarkQueryXml: string,
  acceptsQuery: (xml: string) => boolean,
): string | null {
  try {
    const saved = new URL(savedUrl);
    const current = new URL(currentUrl);
    if (!/^https?:$/.test(saved.protocol) || !/^https?:$/.test(current.protocol)) return null;
    if (saved.origin === current.origin) return null;
    const incomingQuery = saved.searchParams.get("q") ?? "";
    const validQuery = (xml: string) => {
      try { return Boolean(xml.trim()) && acceptsQuery(xml); }
      catch { return false; }
    };
    if (!validQuery(incomingQuery)) {
      if (!validQuery(bookmarkQueryXml)) return null;
      saved.searchParams.set("q", bookmarkQueryXml);
    }
    // Preserve *everything* except the application origin; no cross-host
    // redirect, network fetch, server ID lookup, or new History visit here.
    return new URL(saved.pathname + saved.search + saved.hash, current.origin).href;
  } catch {
    return null;
  }
}
