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
const RDF_TYPE_URI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

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
  forPersonalFacet = false,
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
    const widgetTree = attachViewToPropertyInQueryTree(
      baseTree,
      propertyUri,
      direction === "forward" ? "property" : "property-of",
      copiedView,
      `personal-${direction}-${encodeURIComponent(propertyUri)}`,
    );
    // A personal facet still needs to enumerate values for an excluded
    // relationship. The exclusion remains untouched in the authoritative query;
    // remove it only from this derived widget query so the edge can bind values.
    const clearWidgetExclusion = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => {
      const containsView = treeNodeContainsId([node], node.id, "query-view");
      const isTargetRelationship = node.name === (direction === "forward" ? "property" : "property-of") &&
        node.attributes.iri === propertyUri && containsView;
      const attributes = { ...node.attributes };
      if (forPersonalFacet && isTargetRelationship) delete attributes.exclude;
      return { ...node, attributes, children: clearWidgetExclusion(node.children) };
    });
    return { ...widgetTree, children: clearWidgetExclusion(widgetTree.children) };
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
    const attributes = { ...node.attributes };
    // As above, this is a facet-values query rather than the authoritative
    // result query, so an excluded ancestor role must be bindable here.
    if (forPersonalFacet && node.id === selectedNodeId && node.name === "property-of") delete attributes.exclude;
    return [{ ...node, attributes, children: wrapAncestor(node.children) }];
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
  let tree: FctQueryTree = {
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: sourceTree.children.map(cloneQueryNode),
  };
  let bindingNodeId = option.nodeId;
  // Group-by furniture (such as rdf:type) can be selected even when that
  // relationship is not already a filter in the live query. Build the same
  // ordinary relationship/view shape used by dynamic options, then bind its value.
  if (!findQueryNode(tree.children, bindingNodeId)) {
    tree = createPropertyWidgetQuery(tree, option.uri, option.direction, option.nodeId);
    const findBindingNode = (nodes: FctQueryNode[]): FctQueryNode | null => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri === option.uri && treeNodeContainsId([node], node.id, "query-view")) return node;
        const nested = findBindingNode(node.children);
        if (nested) return nested;
      }
      return null;
    };
    bindingNodeId = findBindingNode(tree.children)?.id ?? bindingNodeId;
  }
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
      if (node.id === bindingNodeId) {
        return {
          ...node,
          children: [...node.children.filter((child) => child.name !== "value"), valueNode],
        };
      }
      return { ...node, children: bind(node.children) };
    });
  }
  tree = { ...tree, children: bind(tree.children) };

  // Group headings for rdf:type are classes, but their members must be the
  // resources typed with that class. If the <view> stays nested in the
  // rdf:type <property>, FCT focuses on the class itself and can return the
  // misleading one-item group "Article" containing "Article". Keep the
  // rdf:type/value constraint and move the view beside that binding, preserving
  // any enclosing property path while returning the typed resources.
  if (option.direction === "forward" && option.uri === RDF_TYPE_URI) {
    const view = findQueryView(tree.children);
    if (view) {
      const removeView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) => {
        if (node.id === view.id) return [];
        return [{ ...node, children: removeView(node.children) }];
      });
      const moveViewToBindingScope = (nodes: FctQueryNode[]): FctQueryNode[] => {
        // The active focus may be nested beneath a property path. Hoist the
        // view only to the sibling scope containing the rdf:type binding, not
        // unconditionally to the query root, which would discard that path.
        if (nodes.some((node) => node.id === bindingNodeId)) {
          if (nodes.some((node) => node.id === view.id)) return nodes;
          return [...removeView(nodes), view];
        }
        return nodes.map((node) => ({
          ...node,
          children: moveViewToBindingScope(node.children),
        }));
      };
      tree = { ...tree, children: moveViewToBindingScope(tree.children) };
    }
  }

  return tree;
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

  // Candidate counts must model the constraint that clicking the item would
  // add to the live query. Work only in the active view's immediate sibling
  // scope: a matching IRI elsewhere in an ancestor/descendant path is not the
  // same facet constraint.
  const updateActiveViewScope = (
    nodes: FctQueryNode[],
    update: (siblings: FctQueryNode[]) => FctQueryNode[],
  ): { nodes: FctQueryNode[]; updated: boolean } => {
    if (nodes.some((node) => node.id === "query-view")) {
      return { nodes: update(nodes), updated: true };
    }
    let updated = false;
    const next = nodes.map((node) => {
      if (updated) return node;
      const result = updateActiveViewScope(node.children, update);
      if (result.updated) {
        updated = true;
        return { ...node, children: result.nodes };
      }
      return node;
    });
    return { nodes: next, updated };
  };

  if (kind === "property" || kind === "role") {
    const relationshipName = kind === "property" ? "property" : "property-of";
    const relationshipId = `${kind === "property" ? "count-property" : "count-role"}-${encodeURIComponent(uri)}`;
    const relationshipNode: FctQueryNode = {
      id: relationshipId,
      name: relationshipName,
      attributes: { iri: uri },
      children: [],
    };
    const scoped = updateActiveViewScope(tree.children, (siblings) => {
      const existing = siblings.find((node) =>
        node.name === relationshipName && node.attributes.iri === uri &&
        (kind !== "property" || node.id.startsWith("property-filter-") || node.id.startsWith("count-property-")) &&
        (kind !== "role" || node.id.startsWith("role-filter-") || node.id.startsWith("count-role-")),
      );
      if (existing) {
        // An excluded item becomes an inclusion candidate for its count.
        // Otherwise keep the existing relationship: duplicating it creates a
        // second SPARQL variable and can distort the count for multi-valued data.
        return siblings.map((node) => {
          if (node !== existing) return node;
          const attributes = { ...node.attributes };
          delete attributes.exclude;
          return { ...node, attributes };
        });
      }
      const viewIndex = siblings.findIndex((node) => node.id === "query-view");
      const next = [...siblings];
      next.splice(viewIndex + 1, 0, relationshipNode);
      return next;
    });
    tree = { ...tree, children: scoped.nodes };
  } else if (kind === "class") {
    const classNode: FctQueryNode = {
      id: `count-class-${encodeURIComponent(uri)}`,
      name: "class",
      attributes: { iri: uri },
      children: [],
    };
    const scoped = updateActiveViewScope(tree.children, (siblings) => {
      const existing = siblings.find((node) => node.name === "class" && node.attributes.iri === uri);
      if (existing) {
        return siblings.map((node) => {
          if (node !== existing) return node;
          const attributes = { ...node.attributes };
          delete attributes.exclude;
          return { ...node, attributes };
        });
      }
      const viewIndex = siblings.findIndex((node) => node.id === "query-view");
      const next = [...siblings];
      next.splice(viewIndex + 1, 0, classNode);
      return next;
    });
    tree = { ...tree, children: scoped.nodes };
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
    let inserted = false;
    const attachValue = (node: FctQueryNode): FctQueryNode => {
      const attributes = { ...node.attributes };
      delete attributes.exclude;
      const existingValue = node.children.some((child) => child.name === "value" &&
        child.text === binding.text &&
        (child.attributes.datatype ?? "") === (binding.datatype ?? "") &&
        (child.attributes["xml:lang"] ?? child.attributes.lang ?? "") === (binding.lang ?? ""));
      inserted = true;
      return {
        ...node,
        // The count compiler measures the active focus for reverse roles.
        ...(node.name === "property-of" ? { id: `count-role-value-${encodeURIComponent(propertyUri)}` } : {}),
        attributes,
        children: existingValue ? node.children : [...node.children, valueNode],
      };
    };
    const addValueToActiveScope = (nodes: FctQueryNode[]): FctQueryNode[] => {
      const hasActiveView = nodes.some((node) => node.id === "query-view");
      return nodes.map((node) => {
        const isTargetRelationship = hasActiveView && !inserted &&
          (node.name === "property" || node.name === "property-of") &&
          node.attributes.iri === propertyUri;
        if (isTargetRelationship) return attachValue(node);
        // If the facet relationship itself is the active path carrying the
        // view, its related variable is the view subject; constrain it there.
        const carriesView = treeNodeContainsId([node], node.id, "query-view");
        if (!inserted && carriesView &&
            (node.name === "property" || node.name === "property-of") &&
            node.attributes.iri === propertyUri) return attachValue(node);
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

