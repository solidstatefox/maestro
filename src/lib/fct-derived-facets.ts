/** Generic, policy-driven computed facet support. No provider-specific URI
 * is required by the FCT query manipulator or the SPARQL compiler. */
import { ensureFctQueryIds } from "./fct-node-identity";
import type { FctQueryNode, FctQueryTree } from "./fct-query";

export type DerivedRegexField = { iri: string; label: string; pattern: string; capture: string };
const validIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);
/** Insert siblings at the same FCT scope; each child has its own rid and pid
 * equal to the spawning source's rid. Existing children are never relocated. */
export function spawnRegexDerivedFacets(tree: FctQueryTree, sourceId: string,
  fields: DerivedRegexField[]): FctQueryTree {
  if (!fields.length || fields.length > 12 || fields.some(f => !validIri(f.iri) || !f.label.trim() ||
    !f.pattern || f.pattern.length > 2000 || !/^[1-9]$/.test(f.capture)))
    throw new Error("Invalid regex-derived facet definition.");
  const normalized = ensureFctQueryIds(tree) as FctQueryTree;
  let found = false;
  function update(nodes: FctQueryNode[]): FctQueryNode[] {
    const result: FctQueryNode[] = [];
    for (const node of nodes) {
      result.push({...node, attributes:{...node.attributes}, children:update(node.children)});
      if (node.id !== sourceId || (node.name !== "property" && node.name !== "property-of")) continue;
      found = true;
      if (!node.attributes.rid) throw new Error("Spawning facet has no relationship ID.");
      for (const field of fields) {
        if (nodes.some(candidate => candidate.attributes.derive === "regex" &&
          candidate.attributes.pid === node.attributes.rid && candidate.attributes.iri === field.iri)) continue;
        result.push({id:"derived-facet", name:node.name, attributes:{
          iri:field.iri, label:field.label, derive:"regex", pattern:field.pattern,
          capture:field.capture, pid:node.attributes.rid,
        }, children:[]});
      }
    }
    return result;
  }
  const children=update(normalized.children);
  if (!found) throw new Error("Spawning facet no longer exists in the live query.");
  return ensureFctQueryIds({...normalized,children}) as FctQueryTree;
}
