/** Shared browser-side URI input rules; the FCT translator remains authoritative
 * for validating external/shared query XML. Preserve the user's original IRI
 * spelling (including percent escapes) rather than serializing URL.href. */
export const MAX_ROOT_URI_CHARS = 2048;
const UNSAFE_IRI = /[\x00-\x20<>"{}|^`\\]/;
const NON_BROWSABLE_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:"]);

/** A complete, absolute URL/IRI suitable for a root `datatype="uri"` term. */
export function parseRootUri(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_ROOT_URI_CHARS || UNSAFE_IRI.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (!/^[a-z][a-z\d+.-]*:$/i.test(url.protocol) || NON_BROWSABLE_SCHEMES.has(url.protocol.toLowerCase())) return null;
    if ((url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ftp:") &&
        (!url.hostname || url.username || url.password)) return null;
    // Preserve RDF urn: and other absolute identifiers accepted by URL(), too.
    return candidate;
  } catch {
    return null;
  }
}

/** Do not query autocomplete for a complete URL or even a URL-shaped draft.
 * Prefixes include http, https, ftp, www. and RDF absolute schemes (urn:, etc.). */
export function isRootUriOrPrefix(value: string): boolean {
  const draft = value.trim();
  if (!draft) return false;
  const lower = draft.toLowerCase();
  const urlPrefixes = ["http://", "https://", "ftp://", "www.", "urn:"];
  return parseRootUri(draft) !== null ||
    urlPrefixes.some(prefix => lower.startsWith(prefix)) ||
    /^(?:https?|ftp):/i.test(draft) ||
    /^www\./i.test(draft) ||
    /^[a-z][a-z\d+.-]*:\/{0,2}/i.test(draft);
}
