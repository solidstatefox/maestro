"use client";

import { attachViewToPropertyInQueryTree } from "./fct-query";
import type { FctQueryNode, FctQueryTree } from "./fct-query";

export type QueryResultValue = {
  uri: string;
  title?: string;
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
};

type RelationshipDirection = "forward" | "reverse";
type GroupByOption = {
  uri: string;
  direction: RelationshipDirection;
  key: string;
  label: string;
  nodeId: string;
  memberBindingNodeId?: string;
  ancestorRole?: boolean;
  rdfType?: boolean;
};
export type DistinctCountKind = "property" | "class" | "role" | "value";
const COUNT_QUERY_LIMIT = 1000;

function cloneQueryNode(node: FctQueryNode): FctQueryNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.name === "view" ? [] : node.children.map(cloneQueryNode),
  };
}

function findQueryNode(nodes: FctQueryNode[], nodeId: string): FctQueryNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findQueryNode(node.children, nodeId);
    if (found) return found;
  }
  return null;
}

function queryContainsIri(tree: FctQueryTree, name: string, iri: string): boolean {
  const visit = (nodes: FctQueryNode[]): boolean => nodes.some(
    (node) => (node.name === name && node.attributes.iri === iri) || visit(node.children),
  );
  return visit(tree.children);
}

function groupValueKey(value: QueryResultValue): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

function groupValueBinding(value: QueryResultValue): { text: string; datatype?: string; lang?: string } {
  const isUri = value.termType === "uri" || value.termType === undefined;
  return {
    text: value.uri,
    ...(isUri
      ? { datatype: "uri" }
      : value.datatype
        ? { datatype: value.datatype }
        : value.lang
          ? {}
          : { datatype: "string" }),
    ...(value.lang ? { lang: value.lang } : {}),
  };
}

function treeNodeContainsId(nodes: FctQueryNode[], ancestorId: string, targetId: string): boolean {
  const contains = (node: FctQueryNode): boolean => node.id === targetId || node.children.some(contains);
  const find = (node: FctQueryNode): boolean => node.id === ancestorId
    ? contains(node)
    : node.children.some(find);
  return nodes.some(find);
}

export function createPropertyWidgetQuery(
  tree: FctQueryTree,
  propertyUri: string,
  direction: RelationshipDirection = "forward",
  selectedNodeId?: string,
): FctQueryTree {
  const copyNode = (node: FctQueryNode): FctQueryNode => ({
    ...node,
    attributes: { ...node.attributes },
    children: node.name === "view" ? [] : node.children.map(copyNode),
  });
  const selectedRoleIsAncestor = direction === "reverse" && Boolean(selectedNodeId) &&
    treeNodeContainsId(tree.children, selectedNodeId!, "query-view");

  // For an ordinary relationship, delegate insertion/reuse to the shared query
  // API. It reuses a matching sibling relationship rather than manufacturing a
  // second property node beside an existing constrained one.
  if (!selectedRoleIsAncestor) {
    const view = tree.children.length ? findQueryView(tree.children) : null;
    if (!view) return tree;
    let baseTree: FctQueryTree = {
      ...tree,
      attributes: { ...tree.attributes },
      children: tree.children.map(copyNode),
    };
    if (direction === "reverse" && selectedNodeId) {
      const removeSelectedSibling = (nodes: FctQueryNode[]): FctQueryNode[] => nodes
        .filter((node) => node.id !== selectedNodeId)
        .map((node) => ({ ...node, children: removeSelectedSibling(node.children) }));
      baseTree = { ...baseTree, children: removeSelectedSibling(baseTree.children) };
    }
    const copiedView = copyNode(view);
    return attachViewToPropertyInQueryTree(
      baseTree,
      propertyUri,
      direction === "forward" ? "property" : "property-of",
      copiedView,
      `personal-${direction}-${encodeURIComponent(propertyUri)}`,
    );
  }

  // For a reverse-role ancestor, the selected role already encloses the view;
  // retain that ancestor and enumerate its values without adding another edge.
  const wrapAncestor = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) => {
    if (node.id === "query-view") {
      const ephemeralView: FctQueryNode = {
        ...copyNode(node),
        attributes: { ...node.attributes, type: "list", offset: "0" },
        children: [],
      };
      return [ephemeralView];
    }
    return [{ ...node, attributes: { ...node.attributes }, children: wrapAncestor(node.children) }];
  });
  return { ...tree, attributes: { ...tree.attributes }, children: wrapAncestor(tree.children) };
}

function findQueryView(nodes: FctQueryNode[]): FctQueryNode | null {
  for (const node of nodes) {
    if (node.id === "query-view") return node;
    const nested = findQueryView(node.children);
    if (nested) return nested;
  }
  return null;
}

/** Clone the source query for one group heading. For an ancestor reverse-role
 * breadcrumb, the source result is the heading (e.g. a paper), while the cloned
 * query must return values of that paper's publisher property. Move the active
 * view out of the <property-of> breadcrumb and onto its matching <property>.
 */
/** Build the distinct-value query for Group By. Remove the selected value
 * constraint from the chosen relationship before attaching the view; otherwise
 * Group By can only enumerate the value already checked in Focus. All other
 * query filters and the active view scope remain intact. */
export function createGroupValuesQuery(
  sourceTree: FctQueryTree,
  option: GroupByOption,
): FctQueryTree {
  // rdf:type is a furniture option: its headings come from the FCT classes
  // view, not from a property/list view attached to a synthetic relationship.
  if (option.rdfType) {
    return cloneQueryTree(sourceTree);
  }
  const removeSelectedValues = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => ({
    ...node,
    attributes: { ...node.attributes },
    children: removeSelectedValues(
      node.id === option.nodeId
        ? node.children.filter((child) => child.name !== "value")
        : node.children,
    ),
  }));
  const unconstrainedTree: FctQueryTree = {
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: removeSelectedValues(sourceTree.children),
  };
  return createPropertyWidgetQuery(
    unconstrainedTree,
    option.uri,
    option.direction,
    option.nodeId,
  );
}

export function createGroupMemberQuery(
  sourceTree: FctQueryTree,
  option: GroupByOption,
  groupValue: QueryResultValue,
): FctQueryTree {
  const tree: FctQueryTree = {
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: sourceTree.children.map(cloneQueryNode),
  };
  const binding = groupValueBinding(groupValue);
  const valueNode: FctQueryNode = {
    id: `group-value-${encodeURIComponent(option.uri)}-${encodeURIComponent(groupValueKey(groupValue))}`,
    name: "value",
    attributes: { ...(binding.datatype ? { datatype: binding.datatype } : {}), ...(binding.lang ? { "xml:lang": binding.lang } : {}) },
    text: binding.text,
    children: [],
  };

  if (option.rdfType) {
    // The synthetic rdf:type option has no node in the live query. Add a
    // real property/value constraint beside the active view in its current
    // scope, so the cloned FCT request actually filters members by class.
    const classBinding: FctQueryNode = {
      id: `group-rdf-type-${encodeURIComponent(groupValue.uri)}`,
      name: "property",
      attributes: { iri: option.uri },
      children: [valueNode],
    };
    const addBesideView = (nodes: FctQueryNode[]): FctQueryNode[] => {
      const output: FctQueryNode[] = [];
      for (const node of nodes) {
        if (node.id === "query-view") output.push(classBinding);
        output.push({ ...node, children: addBesideView(node.children) });
      }
      return output;
    };
    return { ...tree, children: addBesideView(tree.children) };
  }

  if (option.direction === "reverse" && option.ancestorRole) {
    let movedView: FctQueryNode | undefined;
    const extractView = (node: FctQueryNode): FctQueryNode | undefined => {
      if (node.id === "query-view") return node;
      for (const child of node.children) {
        const found = extractView(child);
        if (found) return found;
      }
      return undefined;
    };
    const parentId = option.memberBindingNodeId;
    const moveToParent = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => {
      if (parentId && node.id === parentId) {
        const role = node.children.find((child) => child.id === option.nodeId);
        if (role) {
          movedView = extractView(role);
          const remaining = node.children.filter((child) => child.id !== option.nodeId);
          return {
            ...node,
            children: [...remaining, valueNode, ...(movedView ? [movedView] : [])],
          };
        }
      }
      return { ...node, children: moveToParent(node.children) };
    });
    tree.children = moveToParent(tree.children);

    // If the breadcrumb has no matching <property> parent, replace the
    // <property-of> path node with a new property node carrying the group value
    // and the view moved out of the reverse-role branch.
    if (!parentId) {
      const replaceRole = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) => {
        if (node.id === option.nodeId) {
          movedView = extractView(node);
          return [{
            id: `group-property-${encodeURIComponent(option.uri)}`,
            name: "property",
            attributes: { iri: option.uri },
            children: [valueNode, ...(movedView ? [movedView] : [])],
          }];
        }
        return [{ ...node, children: replaceRole(node.children) }];
      });
      tree.children = replaceRole(tree.children);
    }
    return tree;
  }

  function bind(nodes: FctQueryNode[]): FctQueryNode[] {
    return nodes.map((node) => {
      if (node.id === option.nodeId) {
        return {
          ...node,
          children: [...node.children.filter((child) => child.name !== "value"), valueNode],
        };
      }
      return { ...node, children: bind(node.children) };
    });
  }
  return { ...tree, children: bind(tree.children) };
}

/** Build an isolated query-tree scope for one visible facet/value count. */
export function createDistinctCountQuery(
  sourceTree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: QueryResultValue,
  viewType: "list-count" | "text" | "properties" | "properties-in" | "classes" = "list-count",
): FctQueryTree {
  let tree: FctQueryTree = {
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: sourceTree.children.map(cloneQueryNode),
  };

  // Preserve the source query's <text> element even when it is empty. The
  // FCT proxy validates the presence of this element for ordinary FCT queries.

  if (kind === "property" || kind === "role") {
    const relationshipName = kind === "property" ? "property" : "property-of";
    const relationshipId = `${kind === "property" ? "count-property" : "count-role"}-${encodeURIComponent(uri)}`;
    const relationshipNode: FctQueryNode = {
      id: relationshipId,
      name: relationshipName,
      attributes: { iri: uri },
      children: [],
    };

    // The candidate facet is a condition on the current result resource, not
    // a parent of <view>. Wrapping <view> changes the counted variable to the
    // related object and can make every property count mirror Results.
    let inserted = false;
    const addBesideView = (nodes: FctQueryNode[]): FctQueryNode[] => {
      const output: FctQueryNode[] = [];
      for (const node of nodes) {
        output.push({ ...node, children: addBesideView(node.children) });
        if (node.id === "query-view" && !inserted) {
          output.push(relationshipNode);
          inserted = true;
        }
      }
      return output;
    };
    tree = { ...tree, children: addBesideView(tree.children) };
  } else if (kind === "class") {
    if (!queryContainsIri(tree, "class", uri)) {
      const classNode: FctQueryNode = {
        id: `count-class-${encodeURIComponent(uri)}`,
        name: "class",
        attributes: { iri: uri },
        children: [],
      };
      const addBesideView = (nodes: FctQueryNode[]): FctQueryNode[] => {
        const output: FctQueryNode[] = [];
        for (const node of nodes) {
          if (node.id === "query-view") output.push(classNode);
          output.push({ ...node, children: addBesideView(node.children) });
        }
        return output;
      };
      tree = { ...tree, children: addBesideView(tree.children) };
    }
  } else if (kind === "value" && propertyUri) {
    const binding = candidateValue
      ? groupValueBinding(candidateValue)
      : { text: uri, datatype: "uri" };
    const valueNode: FctQueryNode = {
      id: `count-value-${encodeURIComponent(propertyUri)}-${encodeURIComponent(uri)}`,
      name: "value",
      attributes: {
        ...(binding.datatype ? { datatype: binding.datatype } : {}),
        ...(binding.lang ? { "xml:lang": binding.lang } : {}),
      },
      text: binding.text,
      children: [],
    };
    // The value must constrain the relationship's related variable. The
    // relationship and <view> are commonly siblings, so looking for a
    // property node whose *children* contain the view silently misses the
    // candidate and produces an unfiltered count (often identical to Results).
    // Insert the value under the matching relationship in the same sibling
    // scope as the active view. Support both forward <property> and reverse
    // <property-of> facets.
    let inserted = false;
    const addValueToActiveScope = (nodes: FctQueryNode[]): FctQueryNode[] => {
      const hasActiveView = nodes.some((node) => node.id === "query-view");
      return nodes.map((node) => {
        const isTargetRelationship = hasActiveView && !inserted &&
          (node.name === "property" || node.name === "property-of") &&
          node.attributes.iri === propertyUri;
        if (isTargetRelationship) {
          inserted = true;
          // Reverse-role item counts must count matching resources in the active
          // view, not the single related value. The count compiler recognizes
          // this ID prefix and therefore keeps the view variable as its target.
          return {
            ...node,
            ...(node.name === "property-of"
              ? { id: `count-role-value-${encodeURIComponent(propertyUri)}` }
              : {}),
            children: [...node.children, valueNode],
          };
        }
        return { ...node, children: addValueToActiveScope(node.children) };
      });
    };
    tree = { ...tree, children: addValueToActiveScope(tree.children) };
    if (!inserted) {
      // Fail closed: never silently issue a count for the whole result set
      // when the candidate value could not be attached to its relationship.
      tree = {
        ...tree,
        children: [...tree.children, {
          id: `count-value-scope-missing-${encodeURIComponent(propertyUri)}`,
          name: "count-value-scope-missing",
          attributes: { iri: propertyUri },
          children: [],
        }],
      };
    }
  }

  const setCountView = (nodes: FctQueryNode[]): FctQueryNode[] =>
    nodes.map((node) =>
      node.id === "query-view"
        ? {
            ...node,
            attributes: {
              ...node.attributes,
              type: viewType,
              limit: String(COUNT_QUERY_LIMIT),
              offset: "0",
            },
          }
        : { ...node, children: setCountView(node.children) },
    );

  return { ...tree, children: setCountView(tree.children) };
}

function updateQueryNode(
  nodes: FctQueryNode[],
  nodeId: string,
  update: (node: FctQueryNode) => FctQueryNode,
): FctQueryNode[] {
  return nodes.map((node) =>
    node.id === nodeId
      ? update(node)
      : { ...node, children: updateQueryNode(node.children, nodeId, update) },
  );
}

/** Return an isolated query variant with only the active view attributes changed. */
export function setQueryViewAttributes(
  sourceTree: FctQueryTree,
  attributes: Record<string, string>,
): FctQueryTree {
  const tree = cloneQueryTree(sourceTree);
  return {
    ...tree,
    children: updateQueryNode(tree.children, "query-view", (node) => ({
      ...node,
      attributes: { ...node.attributes, ...attributes },
    })),
  };
}

/** Construct record-description requests through the same query-tree serializer. */
export function createRecordDescriptionQuery(
  subjectUri: string,
  viewType: "properties" | "list",
  propertyUri?: string,
): FctQueryTree {
  const textNode: FctQueryNode = { id: "record-description-text", name: "text", attributes: {}, text: "", children: [] };
  const subjectNode: FctQueryNode = { id: "record-description-subject", name: "value", attributes: { datatype: "uri" }, text: `[${subjectUri}]`, children: [] };
  const viewNode: FctQueryNode = { id: "query-view", name: "view", attributes: { type: viewType, limit: viewType === "properties" ? "1000" : "100", offset: "0" }, children: [] };
  const scopeNode: FctQueryNode[] = propertyUri
    ? [{ id: `record-description-property-${encodeURIComponent(propertyUri)}`, name: "property", attributes: { iri: propertyUri }, children: [viewNode] }]
    : [viewNode];
  return {
    name: "query",
    attributes: { xmlns: "http://openlinksw.com/services/facets/1.0", inference: "", "same-as": "" },
    children: [textNode, subjectNode, ...scopeNode],
  };
}

function cloneQueryTree(tree: FctQueryTree): FctQueryTree {
  return { ...tree, attributes: { ...tree.attributes }, children: tree.children.map(cloneQueryNode) };
}

