import { XMLParser } from "fast-xml-parser";

/**
 * Canonical FCT identity only. This never changes the live query or the XML
 * sent to Virtuoso. In particular, an enclosing property is never hoisted out
 * of its scope: only siblings within the same scope are sorted by @iri.
 */
type XmlPart = Record<string, unknown>;
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  removeNSPrefix: false,
  processEntities: true,
});

const PAGING = new Set(["limit", "offset", "timeout", "pageSize", "page"]);
const IGNORED = new Set(["id", "ctr"]);
const UNORDERED_SCOPES = new Set(["query", "property", "property-of"]);

type CanonicalNode = {
  name: string;
  iri: string | null;
  attrs: [string, string][];
  children: CanonicalNode[];
  text: string;
};

function canonicalPart(part: XmlPart, selectionOnly = false): CanonicalNode | null {
  const name = Object.keys(part).find(key => key !== ":@" && key !== "#text" && key !== "#comment");
  if (!name || name.startsWith("?")) return null;
  // As before, Status selections do not partition the query-hash graph.
  if (name.split(":").pop() === "status") return null;
  const rawAttributes = (part[":@"] ?? {}) as Record<string, unknown>;
  const isView = name.split(":").pop() === "view";
  const attrs = Object.entries(rawAttributes)
    .filter(([key]) => !IGNORED.has(key) && !(isView && (selectionOnly || PAGING.has(key))))
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const rawChildren = Array.isArray(part[name]) ? part[name] as XmlPart[] : [];
  const children = rawChildren.map(child => canonicalPart(child, selectionOnly)).filter((item): item is CanonicalNode => item !== null);
  const texts = rawChildren
    .filter(child => Object.prototype.hasOwnProperty.call(child, "#text"))
    .map(child => String(child["#text"] ?? ""));
  // Ignore pretty-print indentation between elements, but retain lexical text
  // inside value/text nodes. (Query text/values can contain significant spaces.)
  // Removing <status> from a projection can leave a formerly nonempty query
  // scope with whitespace-only XML text. Such formatting is not a filter:
  // normalize it identically before and after the projection. Preserve text
  // verbatim in <text> and <value>, where spaces may be meaningful.
  const localName = name.split(":").pop() ?? name;
  const lexicalContent = localName === "text" || localName === "value";
  const text = lexicalContent && !children.length
    ? texts.join("")
    : texts.filter(value => value.trim()).join("");
  const iriValue = rawAttributes.iri;
  return { name, iri: typeof iriValue === "string" ? iriValue : null, attrs, children, text };
}

function encode(node: CanonicalNode): string {
  const items = node.children.map(child => ({ child, key: encode(child) }));
  if (UNORDERED_SCOPES.has(node.name.split(":").pop() ?? "")) {
    items.sort((a, b) => {
      const x = a.child.iri ?? "", y = b.child.iri ?? "";
      if (x !== y) return x < y ? -1 : 1;
      // For a missing or identical IRI, the subtree is a stable tie-breaker.
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }
  return JSON.stringify([node.name, node.attrs, node.text, items.map(item => item.key)]);
}

function canonicalXml(xml: string, selectionOnly: boolean): string {
  try {
    const parsed = parser.parse(xml) as XmlPart[];
    const root = parsed.map(part => canonicalPart(part, selectionOnly)).find(node => node?.name.split(":").pop() === "query");
    return root ? encode(root) : xml.trim();
  } catch {
    // Invalid user-supplied XML is never interpreted as an equivalent query.
    return xml.trim();
  }
}

/** Canonical bookmarked query identity, including the view type. */
export function canonicalQueryIdentityXml(xml: string): string {
  return canonicalXml(xml, false);
}

/** Canonical identity for comparing the selection of a derived FCT view with
 * its bookmarked live query. Ignore <view> attributes because list-status
 * deliberately changes the view type and pagination, but retain the <view>
 * node at its original position in the breadcrumb/property tree. All graph,
 * path, class, value, text and other selection constraints still participate.
 * Unlike this projection comparison, bookmark hashes retain the view type. */
export function canonicalFctSelectionXml(xml: string): string {
  return canonicalXml(xml, true);
}
