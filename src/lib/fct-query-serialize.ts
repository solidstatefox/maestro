/** Pure FCT XML serializer used by browser and server routes.
 * Keep it outside the client-only query store so API handlers can create
 * canonical History/bookmark queries without invoking a client reference. */
import { ensureFctQueryIds } from "./fct-node-identity";
import type { FctQueryNode, FctQueryTree } from "./fct-query";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializeNode(node: FctQueryNode): string {
  // An empty search means browse without full-text matching. Virtuoso FCT treats
  // <text></text> as a search for the placeholder token (NULL), not as no filter.
  // Keep the empty text node in the client query tree, but omit it on the wire.
  if (node.name === "text" && !(node.text ?? "").trim() && node.children.length === 0) return "";

  const attributes = Object.entries({ ...node.attributes, id: node.id })
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");

  if (node.name === "view" || node.name === "a") return `<${node.name}${attributes}/>`;

  // Serialize the value text as supplied by the query tree. XML escaping
  // protects the document syntax; it must not add SPARQL IRI delimiters.
  const textContent = node.text ?? "";
  const serializedText = textContent ? escapeXml(textContent) : "";
  // FCT query filters must precede <view>. If a filter is appended after the
  // view node (for example when a user checks a facet after initial browse),
  // emitting the tree's raw child order can cause the endpoint to stop reading
  // the query before it reaches that filter. Always serialize view last at each
  // scope, without changing the authoritative query tree itself.
  const content = [
    serializedText,
    ...node.children
      .filter((child) => child.name !== "view")
      .map((child) => serializeNode(child)),
    ...node.children
      .filter((child) => child.name === "view")
      .map((child) => serializeNode(child)),
  ].join("");

  return `<${node.name}${attributes}>${content}</${node.name}>`;
}

export function serializeFctQuery(tree: FctQueryTree): string {
  // `addr` is the sole serialized address; graph remains a UI compatibility
  // field only and must never leak into executable query XML.
  const serializedTree = ensureFctQueryIds(tree);
  const attributes = Object.entries(serializedTree.attributes)
    .filter(([name]) => name !== "graph")
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<query${attributes}>` +
    serializedTree.children
      .filter((child) => child.name !== "view")
      .map((child) => serializeNode(child))
      .join("") +
    serializedTree.children
      .filter((child) => child.name === "view")
      .map((child) => serializeNode(child))
      .join("") +
    `</query>`
  );
}
