import { toLabel, type EntityType } from "./uri-labels";

/** Selected query nodes remain authoritative even if an FCT facet page omits
 * them. A missing count is unknown, never evidence of zero matches. */
export function selectedFacetCount(enumerated: number | null | undefined): number | null {
  return typeof enumerated === "number" && Number.isFinite(enumerated) && enumerated >= 0 ? enumerated : null;
}

/** Prefer the same learned RDF/FCT labels as ordinary facet rows. When no
 * description has been observed, present the URI local name, not a QName that
 * looks unlike the surrounding human-readable labels. */
export function selectedFacetLabel(uri: string, kind: EntityType, enumeratedLabel?: string): string {
  const learned = toLabel(uri, kind);
  const candidate = (enumeratedLabel && enumeratedLabel !== uri ? enumeratedLabel : learned).trim();
  if (candidate && !/^[\w.-]+:[^/]/.test(candidate) && candidate !== uri) return candidate;
  const local = uri.slice(Math.max(uri.lastIndexOf("#"), uri.lastIndexOf("/"), uri.lastIndexOf(":")) + 1);
  let decoded: string;
  try { decoded = decodeURIComponent(local); } catch { decoded = local; }
  const words = decoded.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  const readable = kind === "Class"
    ? words.replace(/\b[a-z]/g, part => part.toUpperCase())
    : words.toLowerCase().replace(/\butc\b/g, "UTC");
  return readable || candidate || uri;
}
