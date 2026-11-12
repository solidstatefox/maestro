/**
 * Resolve a persisted Maestro bookmark URL for the instance currently serving
 * the app. Bookmarks made on localhost are portable across hosts and ports.
 * Do not redirect to arbitrary external origins supplied by saved RDF data.
 */
export function resolveBookmarkShareUrl(savedUrl: string, currentOrigin: string): string | null {
  try {
    const current = new URL(currentOrigin);
    const target = new URL(savedUrl, current);
    if (!/^https?:$/.test(target.protocol)) return null;
    if (target.hostname.toLowerCase() === "localhost") {
      target.protocol = current.protocol;
      target.host = current.host;
    }
    if (target.origin !== current.origin || !target.searchParams.has("q")) return null;
    return target.href;
  } catch {
    return null;
  }
}
