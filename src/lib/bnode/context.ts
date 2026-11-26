/** Blank-node-only Record helpers. The caller's already-decoded RDF term
 * activates XState; no background population probe or second FCT request.
 * A structural URI anchor describes a set of candidates, never a portable
 * blank-node identifier. Record selection is a best-effort reconstruction. */
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query";
import type { BNodeRecordAnchor } from "./index";

/** Reuse only URI equality bindings already present in the live FCT path.
 * Called AFTER the selected term has been decoded as a bnode. No result scan,
 * extra projection, query or speculative parent inference is involved. */
export function boundBlankNodeAnchorFromFct(
  query: Pick<FctQueryTree, "children">,
  breadcrumbPath: readonly { id: string }[],
): BNodeRecordAnchor | undefined {
  // getPropertyPath() already identifies the active chain by node ID.
  // Resolve just that existing chain, never search the population or graph.
  const path: FctQueryNode[] = [];
  let children = query.children;
  for (const breadcrumb of breadcrumbPath) {
    const node = children.find(candidate => candidate.id === breadcrumb.id &&
      (candidate.name === "property" || candidate.name === "property-of"));
    if (!node) return undefined;
    path.push(node);
    children = node.children;
  }
  const focus = path.at(-1);
  if (!focus?.attributes.iri || focus.attributes.derive) return undefined;
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const values = (depth === 0 ? query.children : path[depth - 1].children)
      .filter(node => node.name === "value");
    if (values.length !== 1) continue; // OR/multiple bindings are not one anchor.
    const value = values[0];
    if (value.attributes.datatype !== "uri" || value.attributes.enabled === "false" ||
        value.attributes.from || value.attributes.fromView ||
        (value.attributes.op && value.attributes.op !== "=") ||
        value.attributes.rangeStart || value.attributes.rangeEnd ||
        !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value.text ?? "")) continue;
    return { parent: value.text!, predicate: focus.attributes.iri,
      direction: focus.name === "property-of" ? "reverse" : "forward", depth };
  }
  return undefined;
}
