/** Validate class predicates returned by an FCT response before storing them in live XML.
 * Relative fragment IRIs are not executable without an explicit server-provided base. */
export function isAbsoluteFacetIri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
}
export function resolveFacetIri(value: string, base?: string): string | null {
  const iri = value.trim();
  if (isAbsoluteFacetIri(iri)) return iri;
  if (!base || !isAbsoluteFacetIri(base)) return null;
  try {
    const resolved = new URL(iri, base).href;
    return isAbsoluteFacetIri(resolved) ? resolved : null;
  } catch { return null; }
}
