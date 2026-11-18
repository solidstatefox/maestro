import type { FctQueryNode } from "@/lib/fct-query-api";

/** FCT examples are identities ("i.e.") only when every bound value is an
 * equality. Regex, contains, comparisons and inclusive ranges are examples
 * ("e.g."). No binding also means an example, not an identity. The absent op
 * is the FCT default equality operator for a bound literal/IRI. */
export function fctExamplePrefix(values: readonly Pick<FctQueryNode, "name" | "attributes">[]): "i.e." | "e.g." {
  const bindings = values.filter(value => value.name === "value");
  return bindings.length && bindings.every(value => {
    if (!value.attributes || typeof value.attributes !== "object") return false;
    const { op, rangeStart, rangeEnd } = value.attributes;
    return rangeStart === undefined && rangeEnd === undefined && (!op || op === "=");
  }) ? "i.e." : "e.g.";
}
