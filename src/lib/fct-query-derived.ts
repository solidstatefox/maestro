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
};
export type DistinctCountKind = "property" | "class" | "role" | "value";
const COUNT_QUERY_LIMIT = 1000;

function cloneQueryNode(node: FctQueryNode): FctQueryNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.children.map(cloneQueryNode),
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
    children: node.children.map(copyNode),
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
      const copiedView = copyNode(node);
      const properties = copiedView.children.find((child) => child.name === "properties" || child.id === "query-view-properties");
      const activeFilters = (properties?.children ?? []).filter((child) => child.name === "property" && child.id.startsWith("property-filter-"));
      const filterIds = new Set(activeFilters.map((filter) => filter.id));
      const ephemeralView: FctQueryNode = {
        ...copiedView,
        attributes: { ...copiedView.attributes, type: "text", offset: "0" },
        children: copiedView.children.flatMap((child) => {
          if (child.id !== properties?.id) return [child];
          const remaining = child.children.filter((filter) => !filterIds.has(filter.id));
          return remaining.length ? [{ ...child, children: remaining }] : [];
        }),
      };
      return [...activeFilters, ephemeralView];
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
  viewType: "list-count" | "text" = "list-count",
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

    // The view's property-filter-* nodes constrain the resource represented by
    // the view before this count query adds a relationship around it. If those
    // filters stay inside the view, the SPARQL compiler evaluates them against
    // the relationship's value instead of the original scoped resource. This
    // silently produces valid but incorrect zero counts whenever active facets
    // are present. Lift only the active view's filters to the same parent scope
    // as the new relationship, matching the semantics of FCT query serialization.
    const wrapView = (nodes: FctQueryNode[]): FctQueryNode[] =>
      nodes.flatMap((node) => {
        if (node.id === "query-view") {
          const liftedFilters: FctQueryNode[] = [];
          const viewWithoutFilters: FctQueryNode = {
            ...node,
            children: node.children.flatMap((child) => {
              if (child.name !== "properties" && child.id !== "query-view-properties") return [child];
              const remaining = child.children.filter((filter) => {
                const isActiveFilter = filter.name === "property" && filter.id.startsWith("property-filter-");
                if (isActiveFilter) liftedFilters.push(filter);
                return !isActiveFilter;
              });
              return remaining.length ? [{ ...child, children: remaining }] : [];
            }),
          };
          return [
            ...liftedFilters,
            {
              id: relationshipId,
              name: relationshipName,
              attributes: { iri: uri },
              children: [viewWithoutFilters],
            },
          ];
        }
        return [{ ...node, children: wrapView(node.children) }];
      });
    tree = { ...tree, children: wrapView(tree.children) };
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
    const view = findQueryNode(tree.children, "query-view");
    if (view) {
      const properties = view.children.find(
        (node) => node.id === "query-view-properties" || node.name === "properties",
      );
      const existingFilter = properties?.children.find(
        (node) => node.name === "property" &&
          node.id.startsWith("property-filter-") &&
          node.attributes.iri === propertyUri,
      );
      // Facet counts are disjunctive: replace only this active view's binding
      // with the candidate value, leaving all other filters intact. Never walk
      // the whole tree by IRI: a same-IRI path or filter in another breadcrumb
      // scope is a different structural constraint and must not be rewritten.
      if (existingFilter && properties) {
        const updatedView = {
          ...view,
          children: view.children.map((child) => child.id === properties.id
            ? {
                ...child,
                children: child.children.map((filter) => filter.id === existingFilter.id
                  ? { ...filter, children: [...filter.children.filter((item) => item.name !== "value"), valueNode] }
                  : filter),
              }
            : child),
        };
        tree = { ...tree, children: updateQueryNode(tree.children, "query-view", () => updatedView) };
      } else {
        const filterNode: FctQueryNode = {
          id: `property-filter-count-${encodeURIComponent(propertyUri)}`,
          name: "property",
          attributes: { iri: propertyUri },
          children: [valueNode],
        };
        const propertiesNode: FctQueryNode = properties ?? {
          id: "query-view-properties",
          name: "properties",
          attributes: {},
          children: [],
        };
        const updatedView = {
          ...view,
          children: properties
            ? view.children.map((child) => child.id === properties.id
                ? { ...child, children: [...child.children, filterNode] }
                : child)
            : [...view.children, { ...propertiesNode, children: [filterNode] }],
        };
        tree = { ...tree, children: updateQueryNode(tree.children, "query-view", () => updatedView) };
      }
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

