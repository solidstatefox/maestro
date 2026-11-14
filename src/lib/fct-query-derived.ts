"use client";

import { FCT_VIEW_TYPES } from "./fct-view-types";
import { findGroupCarrier, ungroupForMembers, markFctGroup } from "./fct-groups-carrier";
import { isBlankNodeTerm } from "./bnode";
import { attachViewToPropertyInQueryTree } from "./fct-query";
import { fctQueryTreeApi, cloneFctQueryNode } from "./fct-query-api";
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

const cloneQueryNode = (node: FctQueryNode): FctQueryNode => cloneFctQueryNode(node, "data");

function findQueryNode(nodes: FctQueryNode[], nodeId: string): FctQueryNode | null {
  for (const node of nodes) {
    if ((node.id === nodeId || node.uiKey === nodeId)) return node;
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
  const contains = (node: FctQueryNode): boolean => (node.id === targetId || node.uiKey === targetId) || node.children.some(contains);
  const find = (node: FctQueryNode): boolean => (node.id === ancestorId || node.uiKey === ancestorId)
    ? contains(node)
    : node.children.some(find);
  return nodes.some(find);
}

/** Personal facets always enumerate bound values; Configure facets use
 * properties/properties-in to discover predicates instead. */
function personalFacetListView(tree: FctQueryTree, forPersonalFacet: boolean): FctQueryTree {
  return forPersonalFacet
    ? setQueryViewAttributes(tree, { type: FCT_VIEW_TYPES.LIST, offset: "0" })
    : tree;
}

/** Derive the actual value-list query for a selected Personal reverse-role facet.
 * Drop only its selected <value> constraints so all candidate values appear. */
export function createPersonalRoleValuesQuery(tree: FctQueryTree, roleNode: FctQueryNode): FctQueryTree {
  const withoutSelectedValues = (node: FctQueryNode): FctQueryNode => ({
    ...node,
    attributes: { ...node.attributes },
    children: (node.id === roleNode.id
      ? node.children.filter((child) => child.name !== "value")
      : node.children).map(withoutSelectedValues),
  });
  const dataTree = fctQueryTreeApi.getDataTree(tree);
  const snapshot: FctQueryTree = {
    ...dataTree,
    children: dataTree.children.map(withoutSelectedValues),
  };
  return createPropertyWidgetQuery(snapshot, roleNode.attributes.iri ?? "", "reverse", roleNode.id, true);
}

export function createPropertyWidgetQuery(
  tree: FctQueryTree,
  propertyUri: string,
  direction: RelationshipDirection = "forward",
  selectedNodeId?: string,
  forPersonalFacet = false,
): FctQueryTree {
  // Facet candidate values belong to the incoming resource selection. In
  // groups mode the live view is on the grouped term; derive a parent-scope
  // query without modifying the authoritative grouped query or its breadcrumbs.
  // The selected group facet itself uses createGroupValuesQuery instead.
  tree = fctQueryTreeApi.getDataTree(tree);
  if (forPersonalFacet) tree = ungroupForMembers(tree);
  const copyNode = (node: FctQueryNode): FctQueryNode => cloneFctQueryNode(node, "data");
  const selectedRoleIsAncestor = direction === "reverse" && Boolean(selectedNodeId) &&
    treeNodeContainsId(tree.children, selectedNodeId!, "query-view");

  // When the active view is already carried by the target relationship, that
  // relationship is the facet binding. Reuse it rather than adding a duplicate
  // nested edge (e.g. Locality -> Locality), which would make the Personal
  // facet return no values. Keep its constraints and only normalize the view.
  if (forPersonalFacet) {
    const relationshipName = direction === "forward" ? "property" : "property-of";
    let reusedCarrier = false;
    const reuseCarrier = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => {
      const isCarrier = !reusedCarrier && node.name === relationshipName &&
        node.attributes.iri === propertyUri &&
        node.children.some((child) => (child.uiKey === "query-view" || child.id === "query-view"));
      if (isCarrier) {
        reusedCarrier = true;
        const attributes = { ...node.attributes };
        delete attributes.exclude;
        return {
          ...node,
          attributes,
          children: node.children.map((child) => (child.uiKey === "query-view" || child.id === "query-view")
            ? { ...copyNode(child), attributes: { ...child.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0" }, children: [] }
            : copyNode(child)),
        };
      }
      return { ...node, attributes: { ...node.attributes }, children: reuseCarrier(node.children) };
    });
    const children = reuseCarrier(tree.children);
    if (reusedCarrier) return personalFacetListView({ ...tree, attributes: { ...tree.attributes }, children }, forPersonalFacet);
  }

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
    return personalFacetListView({ ...widgetTree, children: clearWidgetExclusion(widgetTree.children) }, forPersonalFacet);
  }

  // For a reverse-role ancestor, the selected role already encloses the view;
  // retain that ancestor and enumerate its values without adding another edge.
  const wrapAncestor = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) => {
    if ((node.uiKey === "query-view" || node.id === "query-view")) {
      const ephemeralView: FctQueryNode = {
        ...copyNode(node),
        attributes: { ...node.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0" },
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
  return personalFacetListView({ ...tree, attributes: { ...tree.attributes }, children: wrapAncestor(tree.children) }, forPersonalFacet);
}

function findQueryView(nodes: FctQueryNode[]): FctQueryNode | null {
  for (const node of nodes) {
    if ((node.uiKey === "query-view" || node.id === "query-view")) return node;
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
/** Build the value-list query for Group By. It is the SAME query the matching
 * Personal facet widget runs to list its values (count-sorted), so every group
 * heading carries exactly the count shown next to that value in the facet:
 *  - Category (rdf:type): the Categories facet's `classes` view;
 *  - forward property: createPropertyWidgetQuery(..., forPersonalFacet = true);
 *  - reverse role: the Roles widget's query (selected role values removed so
 *    every candidate value is listed, as in that widget).
 * Counts are COUNT(DISTINCT focus resource) per value, not raw join rows.
 * Each group's members are then built by createGroupMemberQuery, which clones
 * the source query, binds the heading value to the property and keeps the view
 * on the result resources. */
export function createGroupValuesQuery(
  sourceTree: FctQueryTree,
  option: GroupByOption,
  paging: { limit: number; offset: number } = { limit: 30, offset: 0 },
): FctQueryTree {
  const clean = ungroupForMembers(sourceTree);
  const marked = markFctGroup(clean, {
    id: findQueryNode(clean.children, option.nodeId)?.id,
    name: option.direction === "reverse" ? "property-of" : "property",
    iri: option.uri,
  });
  return setQueryViewAttributes(marked, {
    type: FCT_VIEW_TYPES.LIST,
    limit: String(paging.limit),
    offset: String(paging.offset),
    order: "yes",
  });
}

export function createGroupMemberQuery(
  sourceTree: FctQueryTree,
  option: GroupByOption,
  groupValue: QueryResultValue,
): FctQueryTree {
  let tree: FctQueryTree = ungroupForMembers({
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: sourceTree.children.map(cloneQueryNode),
  });
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
      if ((node.uiKey === "query-view" || node.id === "query-view")) return node;
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
  viewType: typeof FCT_VIEW_TYPES.LIST_COUNT | typeof FCT_VIEW_TYPES.TEXT | typeof FCT_VIEW_TYPES.PROPERTIES | typeof FCT_VIEW_TYPES.PROPERTIES_IN | typeof FCT_VIEW_TYPES.CLASSES = FCT_VIEW_TYPES.LIST_COUNT,
  valueRelationship?: { direction: RelationshipDirection; nodeId?: string },
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
    if (nodes.some((node) => (node.uiKey === "query-view" || node.id === "query-view"))) {
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
        (kind !== "property" || (node.uiKey ?? node.id).startsWith("property-filter-") || (node.uiKey ?? node.id).startsWith("count-property-")) &&
        (kind !== "role" || (node.uiKey ?? node.id).startsWith("role-filter-") || (node.uiKey ?? node.id).startsWith("count-role-")),
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
      const viewIndex = siblings.findIndex((node) => (node.uiKey === "query-view" || node.id === "query-view"));
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
      const viewIndex = siblings.findIndex((node) => (node.uiKey === "query-view" || node.id === "query-view"));
      const next = [...siblings];
      next.splice(viewIndex + 1, 0, classNode);
      return next;
    });
    tree = { ...tree, children: scoped.nodes };
  } else if (kind === "value" && propertyUri) {
    // A SPARQL result-set blank-node label cannot identify that node in a
    // later independent query. Do not mistake it for a string literal and
    // manufacture a false zero count; leave its count unavailable instead.
    if (isBlankNodeTerm(candidateValue?.termType)) {
      return {
        ...tree,
        children: [...tree.children, {
          id: "count-blank-node-identity-unavailable",
          name: "count-blank-node-identity-unavailable",
          attributes: {},
          children: [],
        }],
      };
    }
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
    // The candidate binds a particular relationship occurrence, not merely a
    // predicate IRI. Reverse and forward edges with identical IRIs are distinct,
    // and a breadcrumb may contain the same edge more than once.
    const relationshipName = valueRelationship?.direction === "reverse" ? "property-of" : "property";
    const requestedNodeId = valueRelationship?.nodeId;
    const matches = (node: FctQueryNode): boolean =>
      node.name === relationshipName && node.attributes.iri === propertyUri;

    // Without an explicit node ID, use the relationship in the active view's
    // *immediate* scope. If the relationship itself carries the view, use that
    // carrier instead. Never fall back to an arbitrary matching ancestor.
    const resolveInActiveScope = (
      nodes: FctQueryNode[],
      parent: FctQueryNode | null = null,
    ): FctQueryNode | null => {
      if (nodes.some((node) => (node.uiKey === "query-view" || node.id === "query-view"))) {
        return nodes.find(matches) ?? (parent && matches(parent) ? parent : null);
      }
      for (const node of nodes) {
        const found = resolveInActiveScope(node.children, node);
        if (found) return found;
      }
      return null;
    };
    const identified = requestedNodeId
      ? findQueryNode(tree.children, requestedNodeId)
      : resolveInActiveScope(tree.children);
    const targetId = identified && matches(identified) ? identified.id : null;
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
        attributes,
        children: existingValue ? node.children : [...node.children, valueNode],
      };
    };
    const attachToExactNode = (nodes: FctQueryNode[]): FctQueryNode[] =>
      nodes.map((node) => {
        if (targetId && (node.id === targetId || node.uiKey === targetId)) return attachValue(node);
        return { ...node, children: attachToExactNode(node.children) };
      });
    tree = { ...tree, children: attachToExactNode(tree.children) };
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
    nodes.map((node) => {
      if ((node.uiKey === "query-view" || node.id === "query-view")) {
        const attributes = { ...node.attributes };
        delete attributes.order;
        delete attributes["order-results"];
        delete attributes.sort;
        return {
          ...node,
          attributes: {
            ...attributes,
            type: viewType,
            limit: String(COUNT_QUERY_LIMIT),
            offset: "0",
          },
        };
      }
      return { ...node, children: setCountView(node.children) };
    });

  const attributes = { ...tree.attributes };
  delete attributes.order;
  delete attributes["order-results"];
  delete attributes.sort;

  return { ...tree, attributes, children: setCountView(tree.children) };
}


function updateQueryNode(
  nodes: FctQueryNode[],
  nodeId: string,
  update: (node: FctQueryNode) => FctQueryNode,
): FctQueryNode[] {
  return nodes.map((node) =>
    (node.id === nodeId || node.uiKey === nodeId)
      ? update(node)
      : { ...node, children: updateQueryNode(node.children, nodeId, update) },
  );
}

/** Return an isolated query variant with only the active view attributes changed. */
export function setQueryViewAttributes(
  sourceTree: FctQueryTree,
  attributes: Record<string, string>,
): FctQueryTree {
  const tree = fctQueryTreeApi.getDataTree(sourceTree);
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
  viewType: typeof FCT_VIEW_TYPES.PROPERTIES | typeof FCT_VIEW_TYPES.LIST,
  propertyUri?: string,
): FctQueryTree {
  const textNode: FctQueryNode = { id: "record-description-text", name: "text", attributes: {}, text: "", children: [] };
  const subjectNode: FctQueryNode = { id: "record-description-subject", name: "value", attributes: { datatype: "uri" }, text: `[${subjectUri}]`, children: [] };
  const viewNode: FctQueryNode = { id: "query-view", name: "view", attributes: { type: viewType, limit: viewType === FCT_VIEW_TYPES.PROPERTIES ? "1000" : "100", offset: "0" }, children: [] };
  const scopeNode: FctQueryNode[] = propertyUri
    ? [{ id: `record-description-property-${encodeURIComponent(propertyUri)}`, name: "property", attributes: { iri: propertyUri }, children: [viewNode] }]
    : [viewNode];
  return {
    name: "query",
    attributes: { xmlns: "http://openlinksw.com/services/facets/1.0", inference: "", "same-as": "" },
    children: [textNode, subjectNode, ...scopeNode],
  };
}

