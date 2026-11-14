/** Pure query snapshots. The live store is never passed to consumers by this API. */
import type { FctQueryNode, FctQueryTree } from "./fct-query";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

export type FctClonePlane = "exact" | "data";

/** Clone an individual node without retaining ephemeral UI results. */
export function cloneFctQueryNode(node: FctQueryNode, plane: FctClonePlane = "exact"): FctQueryNode {
  const attributes = { ...node.attributes };
  if (plane === "data") {
    // Grouping describes the viewer, not the resource selection.
    delete attributes.group;
    // Obsolete Group-by presentation attributes from older share URLs.
    if (node.name === "view") {
      for (const key of ["by", "bucket", "lexical", "previousType", "previousLimit", "previousOffset"]) {
        delete attributes[key];
      }
    }
  }
  const copy: FctQueryNode = {
    ...node,
    attributes,
    children: node.name === "view" ? [] : node.children.filter(child => plane !== "data" || child.name !== "a").map(child => cloneFctQueryNode(child, plane)),
  };
  delete copy.uiResultSummary;
  return copy;
}

/** Exact snapshots are for editing/history; data snapshots are for derived reads. */
export function cloneFctQueryTree(tree: FctQueryTree, plane: FctClonePlane = "exact"): FctQueryTree {
  const copy: FctQueryTree = {
    ...tree,
    attributes: { ...tree.attributes },
    children: tree.children.filter(node => plane !== "data" || node.name !== "a").map(node => cloneFctQueryNode(node, plane)),
  };
  delete copy.uiResultSummary;
  return copy;
}

/** A parsed XML element or text node in fast-xml-parser's preserveOrder form. */
export type FctXmlNode = Record<string, unknown>;
const fctXmlOptions = { preserveOrder: true, ignoreAttributes: false, trimValues: false, attributeNamePrefix: "@_" } as const;

export function parseFctQuerySnapshot(xml: string): FctXmlNode[] {
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid FCT query XML for query API snapshot.");
  const nodes = new XMLParser(fctXmlOptions).parse(xml) as FctXmlNode[];
  if (!Array.isArray(nodes) || !nodes.some(node => Object.keys(node).some(key => key === "query" || key.endsWith(":query")))) {
    throw new Error("The query API requires an FCT query root.");
  }
  return nodes;
}

export function serializeFctQuerySnapshot(nodes: FctXmlNode[]): string {
  return new XMLBuilder({ ...fctXmlOptions, suppressEmptyNode: true }).build(nodes);
}

/** An XML query snapshot, shared by the browser XSLT host and Node proxy. */
export function snapshotFctQueryXml(xml: string, plane: FctClonePlane = "data"): string {
  // Parsing builds a fully detached representation; the live tree is never exposed.
  const nodes = parseFctQuerySnapshot(xml);
  const walk = (entries: FctXmlNode[]) => {
    for (const node of entries) {
      const attributes = node[":@"] as Record<string, string> | undefined;
      if (plane === "data" && attributes) {
        delete attributes["@_group"];
        if (Object.keys(node).some(key => key === "view" || key.endsWith(":view"))) {
          for (const key of ["by", "bucket", "lexical", "previousType", "previousLimit", "previousOffset"]) {
            delete attributes[`@_${key}`];
          }
        }
      }
      for (const child of Object.values(node)) if (Array.isArray(child)) walk(child as FctXmlNode[]);
    }
  };
  walk(nodes);
  return serializeFctQuerySnapshot(nodes);
}
