/** Generic, policy-driven computed facet support. No provider-specific URI
 * is required by the FCT query manipulator or the SPARQL compiler. */
import { ensureFctQueryIds } from "./fct-node-identity";
import type { FctQueryNode, FctQueryTree } from "./fct-query";

/** Each approved provider creates a distinct authoritative FCT sibling.
 * Regex captures produce one binding; split produces one binding per token. */
export type DerivedRegexField = { iri: string; label: string; pattern: string; capture: string; sourceValuePredicate?: string; mode?: "regex" }
  | { iri: string; label: string; splitPattern: string; sourceValuePredicate?: string; mode: "split" };
const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
/** Insert siblings at the same FCT scope; each child has its own rid and pid
 * equal to the spawning source's rid. Existing children are never relocated. */
export function spawnRegexDerivedFacets(tree: FctQueryTree, sourceId: string,
  fields: DerivedRegexField[]): FctQueryTree {
  if (!fields.length || fields.length > 12 || fields.some(f => !validIri(f.iri) || !f.label.trim() ||
    (f.mode === "split" ? !f.splitPattern || f.splitPattern.length > 2000 : !f.pattern || f.pattern.length > 2000 || !/^[1-9]$/.test(f.capture)) ||
    (f.sourceValuePredicate && !validIri(f.sourceValuePredicate))))
    throw new Error("Invalid provider-derived facet definition.");
  const normalized = ensureFctQueryIds(tree) as FctQueryTree;
  let found = false;
  function update(nodes: FctQueryNode[]): FctQueryNode[] {
    const result: FctQueryNode[] = [];
    const refresh = new Map<string, DerivedRegexField>();
    for (const node of nodes) {
      result.push({...node, attributes:{...node.attributes}, children:update(node.children)});
      if (node.id !== sourceId || (node.name !== "property" && node.name !== "property-of")) continue;
      found = true;
      if (!node.attributes.rid) throw new Error("Spawning facet has no relationship ID.");
      for (const field of fields) {
        const existing = nodes.find(candidate => (candidate.attributes.derive === "regex" || candidate.attributes.derive === "split") &&
          candidate.attributes.pid === node.attributes.rid && candidate.attributes.iri === field.iri);
        if (existing) {
          // Re-extract after a provider revision: keep the existing FCT node,
          // its selected values and rid, but refresh the policy-controlled
          // pattern, capture, label and optional lexical source predicate.
          refresh.set(existing.id, field);
          continue;
        }
        result.push({id:"derived-facet", name:node.name, attributes:{
          iri:field.iri, label:field.label, derive:field.mode === "split" ? "split" : "regex",
          ...(field.mode === "split" ? {splitPattern:field.splitPattern} : {pattern:field.pattern, capture:field.capture}),
          pid:node.attributes.rid,
          ...(field.sourceValuePredicate ? {sourceValuePredicate:field.sourceValuePredicate} : {}),
        }, children:[]});
      }
    }
    return result.map(node => {
      const field = refresh.get(node.id);
      if (!field) return node;
      const attributes: FctQueryNode["attributes"] = { ...node.attributes, label:field.label,
        derive:field.mode === "split" ? "split" : "regex" };
      delete attributes.pattern;
      delete attributes.capture;
      delete attributes.splitPattern;
      if (field.mode === "split") attributes.splitPattern = field.splitPattern;
      else { attributes.pattern = field.pattern; attributes.capture = field.capture; }
      delete attributes.sourceValuePredicate;
      if (field.sourceValuePredicate) attributes.sourceValuePredicate = field.sourceValuePredicate;
      return { ...node, attributes };
    });
  }
  const children=update(normalized.children);
  if (!found) throw new Error("Spawning facet no longer exists in the live query.");
  return ensureFctQueryIds({...normalized,children}) as FctQueryTree;
}
