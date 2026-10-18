"use client";

import { useSyncExternalStore } from "react";

export type FctNodeName = string;

export type FctQueryNode = {
  id: string;
  name: FctNodeName;
  attributes: Record<string, string>;
  text?: string;
  children: FctQueryNode[];
};

/** A value binding as represented by the FCT <value> element.
 * `text` is the lexical value; metadata is preserved rather than inferred.
 * `attributes` allows schema-supported FCT value attributes beyond the common
 * datatype, xml:lang, and op fields.
 */
export type FctValue = {
  text: string;
  datatype?: string;
  lang?: string;
  op?: string;
  attributes?: Record<string, string>;
};

export type FctValueInput = string | FctValue;

export type FctQueryTree = {
  name: "query";
  attributes: Record<string, string>;
  children: FctQueryNode[];
};

export type FctQueryState = {
  /** The one authoritative query tree. */
  tree: FctQueryTree;

  /** Incremented after every state update. */
  revision: number;
};

const QUERY_NAMESPACE = "http://openlinksw.com/services/facets/1.0";

function createInitialState(): FctQueryState {
  return {
    tree: {
      name: "query",
      attributes: {
        xmlns: QUERY_NAMESPACE,
        inference: "",
        "same-as": "",
      },
      children: [
        {
          id: "query-text",
          name: "text",
          attributes: {},
          text: "",
          children: [],
        },
        {
          id: "query-view",
          name: "view",
          attributes: {
            type: "text",
            limit: "30",
            offset: "0",
          },
          children: [],
        },
      ],
    },
    revision: 0,
  };
}






function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normalize a string or structured value into an FCT value node payload. */
function normalizeFctValue(value: FctValueInput): FctValue {
  return typeof value === "string" ? { text: value } : value;
}

function fctValueAttributes(value: FctValueInput, defaultDatatype?: string): Record<string, string> {
  const normalized = normalizeFctValue(value);
  const attributes = { ...(normalized.attributes ?? {}) };
  if (normalized.datatype !== undefined) attributes.datatype = normalized.datatype;
  else if (defaultDatatype !== undefined && attributes.datatype === undefined) attributes.datatype = defaultDatatype;
  if (normalized.lang !== undefined) attributes["xml:lang"] = normalized.lang;
  if (normalized.op !== undefined) attributes.op = normalized.op;
  return attributes;
}

function fctValueKey(value: FctValueInput): string {
  const normalized = normalizeFctValue(value);
  return JSON.stringify([
    normalized.text,
    normalized.datatype ?? normalized.attributes?.datatype ?? (typeof value === "string" ? "uri" : ""),
    normalized.lang ?? normalized.attributes?.["xml:lang"] ?? "",

    normalized.op ?? "",
    normalized.attributes ?? {},
  ]);
}

function createValueNode(id: string, value: FctValueInput, defaultDatatype?: string): FctQueryNode {
  const normalized = normalizeFctValue(value);
  return {
    id,
    name: "value",
    attributes: fctValueAttributes(value, defaultDatatype),
    text: normalized.text,
    children: [],
  };
}

function serializeNode(node: FctQueryNode): string {
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");

  const content = [
    node.text ? escapeXml(node.text) : "",
    ...node.children.map(serializeNode),
  ].join("");

  return `<${node.name}${attributes}>${content}</${node.name}>`;
}

export function serializeFctQuery(tree: FctQueryTree): string {
  const attributes = Object.entries(tree.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");

  // At the root scope, FCT query filters are siblings of <view>, not children
  // of <view><properties>. Keep the editor/store model scoped to the active
  // view, but serialize those active root filters in the query-level position
  // Virtuoso applies to the result set. When <view> is nested under a property
  // path, its filters stay nested with that scope.
  const rootView = tree.children.find((node) => node.id === "query-view");
  const properties = rootView?.children.find(
    (node) => node.name === "properties" || node.id === "query-view-properties",
  );
  const rootFilters = (properties?.children ?? []).filter(
    (node) =>
      node.name === "property" && node.id.startsWith("property-filter-"),
  );

  let children = tree.children;
  if (rootView && properties && rootFilters.length > 0) {
    const filterIds = new Set(rootFilters.map((node) => node.id));
    const serializedView: FctQueryNode = {
      ...rootView,
      children: rootView.children.map((child) =>
        child.id === properties.id
          ? {
              ...child,
              children: child.children.filter((node) => !filterIds.has(node.id)),
            }
          : child,
      ),
    };
    children = tree.children.flatMap((node) =>
      node.id === "query-view"
        ? [...rootFilters, serializedView]
        : [node],
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<query${attributes}>` +
    children.map(serializeNode).join("") +
    `</query>`
  );
}



type Listener = () => void;




/**
 * Attach a view to a relationship in a query snapshot without creating a
 * duplicate sibling relationship node. This is used by query-derived widgets
 * (such as Group by) that need an isolated query variant; lookup is restricted
 * to the exact sibling scope containing the view.
 */
export function attachViewToPropertyInQueryTree(
  sourceTree: FctQueryTree,
  iri: string,
  relationship: "property" | "property-of",
  view: FctQueryNode,
  relationshipId: string,
): FctQueryTree {
  const activeFilters: FctQueryNode[] = [];
  const propertiesId = "query-view-properties";
  const viewWithFiltersSeparated: FctQueryNode = {
    ...view,
    attributes: { ...view.attributes, type: "text", offset: "0" },
    children: view.children.flatMap((child) => {
      if (child.name !== "properties" && child.id !== propertiesId) return [child];
      activeFilters.push(...child.children.filter((item) => item.name === "property" && item.id.startsWith("property-filter-")));
      const remaining = child.children.filter((item) => !(item.name === "property" && item.id.startsWith("property-filter-")));
      return remaining.length ? [{ ...child, children: remaining }] : [];
    }),
  };
  const containsView = (node: FctQueryNode): boolean => node.id === view.id || node.id === "query-view" || node.children.some(containsView);
  const attach = (nodes: FctQueryNode[]): FctQueryNode[] => {
    // If the view is already wrapped by a relationship node, first normalize
    // duplicate sibling wrappers by moving that wrapper's non-view constraints
    // and view onto the existing same-IRI node in this exact parent scope.
    const wrappedIndex = nodes.findIndex((node) =>
      node.name === relationship && node.attributes.iri === iri && containsView(node),
    );
    if (wrappedIndex >= 0) {
      const wrapped = nodes[wrappedIndex];
      const existing = nodes.find((node, index) => index !== wrappedIndex &&
        node.name === relationship && node.attributes.iri === iri);
      if (existing) {
        const movedChildren = wrapped.children.filter((child) => child.id !== "query-view");
        const extractViewFrom = (node: FctQueryNode): FctQueryNode[] => node.id === "query-view" ? [] :
          [{ ...node, children: node.children.flatMap(extractViewFrom) }];
        const viewNode = (() => {
          const find = (node: FctQueryNode): FctQueryNode | undefined => node.id === "query-view" ? node : node.children.map(find).find(Boolean);
          return find(wrapped);
        })();
        const merged: FctQueryNode[] = nodes.flatMap((node, index) => {
          if (index === wrappedIndex) return [];
          if (index === nodes.indexOf(existing)) {
            return [{
              ...node,
              children: [
                ...node.children,
                ...movedChildren.filter((child) => child.id !== "query-view"),
                ...(viewNode ? [viewWithFiltersSeparated] : []),
              ],
            }];
          }
          return [node];
        });
        return merged;
      }
    }
    const viewIndex = nodes.findIndex((node) => node.id === view.id || node.id === "query-view");
    if (viewIndex >= 0) {
      const existing = nodes.find((node) =>
        node.name === relationship && node.attributes.iri === iri && node.id !== view.id && node.id !== "query-view",
      );
      const withoutView = nodes.filter((node) => node.id !== view.id && node.id !== "query-view");
      if (existing) {
        return withoutView.map((node) => node.id === existing.id
          ? { ...node, children: [...node.children.filter((child) => child.id !== view.id && child.id !== "query-view"), ...activeFilters, viewWithFiltersSeparated] }
          : node);
      }
      return [...withoutView, ...activeFilters, {
        id: relationshipId,
        name: relationship,
        attributes: { iri },
        children: [viewWithFiltersSeparated],
      }];
    }
    return nodes.map((node) => ({ ...node, children: attach(node.children) }));
  };
  return { ...sourceTree, attributes: { ...sourceTree.attributes }, children: attach(sourceTree.children) };
}

function createQueryStore() {
  let state = createInitialState();
  const listeners = new Set<Listener>();
  function cloneNodes(nodes: FctQueryNode[]): FctQueryNode[] {
    return nodes.map((node) => ({
      ...node,
      attributes: { ...node.attributes },
      children: cloneNodes(node.children),
    }));
  }

  /** Keep at most one <value> child per parent; the last value wins. */
  function normalizeValueChildren(nodes: FctQueryNode[]): FctQueryNode[] {
    let lastValueIndex = -1;
    nodes.forEach((node, index) => {
      if (node.name === "value") lastValueIndex = index;
    });
    return nodes
      .filter((node, index) => node.name !== "value" || index === lastValueIndex)
      .map((node) => ({ ...node, children: normalizeValueChildren(node.children) }));
  }

  function normalizeTreeValues(tree: FctQueryTree): FctQueryTree {
    return { ...tree, children: normalizeValueChildren(tree.children) };
  }

  function propertiesGroup(tree: FctQueryTree): FctQueryNode | undefined {
    return findNodeInTree(tree, "query-view")?.children.find(
      (node) => node.id === "query-view-properties" || node.name === "properties",
    );
  }

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  function updateTree(
    update: (tree: FctQueryTree) => FctQueryTree,
  ) {
    const nextTree = normalizeTreeValues(update(state.tree));
    state = {
      ...state,
      tree: nextTree,
      revision: state.revision + 1,
    };
    notify();
  }

  /** Set/remove any query-root attribute without narrowing the XML schema. */
  function setQueryAttribute(name: string, value: string | null) {
    if (!name.trim()) return;
    updateTree((tree) => {
      const attributes = { ...tree.attributes };
      if (value === null) delete attributes[name];
      else attributes[name] = value;
      return { ...tree, attributes };
    });
  }

  /** Generic source-of-truth tree mutations for schema-supported FCT nodes. */
  function setNodeAttribute(nodeId: string, name: string, value: string | null) {
    if (!name.trim()) return;
    updateTree((tree) => {
      if (!findNodeInTree(tree, nodeId)) return tree;
      return {
        ...tree,
        children: updateNodeRecursively(tree.children, nodeId, (node) => {
          const attributes = { ...node.attributes };
          if (value === null) delete attributes[name];
          else attributes[name] = value;
          return { ...node, attributes };
        }),
      };
    });
  }

  function setNodeText(nodeId: string, text: string | undefined) {
    updateTree((tree) => findNodeInTree(tree, nodeId)
      ? { ...tree, children: updateNodeRecursively(tree.children, nodeId, (node) => ({ ...node, text })) }
      : tree);
  }

  function insertNode(parentId: string | null, node: FctQueryNode, index?: number) {
    updateTree((tree) => {
      if (parentId && !findNodeInTree(tree, parentId)) return tree;
      const insert = (children: FctQueryNode[]) => {
        const next = node.name === "value"
          ? children.filter((child) => child.name !== "value")
          : [...children];
        const at = index === undefined ? next.length : Math.max(0, Math.min(next.length, Math.floor(index)));
        const clone = (item: FctQueryNode): FctQueryNode => ({
          ...item,
          attributes: { ...item.attributes },
          children: item.children.map(clone),
        });
        next.splice(at, 0, clone(node));
        return next;
      };
      return updateChildrenAtParent(tree, parentId, insert);
    });
  }

  function replaceQueryNode(nodeId: string, replacement: FctQueryNode) {
    updateTree((tree) => {
      if (!findNodeInTree(tree, nodeId)) return tree;
      const clone = (node: FctQueryNode): FctQueryNode => ({
        ...node,
        id: node.id,
        attributes: { ...node.attributes },
        children: node.children.map(clone),
      });
      const stableReplacement = clone({ ...replacement, id: nodeId });
      function replace(nodes: FctQueryNode[]): FctQueryNode[] {
        const target = nodes.find((node) => node.id === nodeId);
        if (target) {
          const siblings = stableReplacement.name === "value"
            ? nodes.filter((node) => node.name !== "value" || node.id === nodeId)
            : nodes;
          return siblings.map((node) => node.id === nodeId ? stableReplacement : node);
        }
        return nodes.map((node) => ({ ...node, children: replace(node.children) }));
      }
      return { ...tree, children: replace(tree.children) };
    });
  }

  function removeQueryNode(nodeId: string) {
    updateTree((tree) => {
      if (nodeId === "query-view" || nodeId === "query-text") return tree;
      const target = findNodeInTree(tree, nodeId);
      if (!target) return tree;
      // Never let a generic structural edit orphan the active view. If the
      // selected wrapper contains it, relocate the view to the wrapper's slot.
      const findView = (node: FctQueryNode): FctQueryNode | null =>
        node.id === "query-view" ? node : node.children.map(findView).find(Boolean) ?? null;
      const preservedView = findView(target);
      let inserted = false;
      const remove = (nodes: FctQueryNode[]): FctQueryNode[] => {
        const output: FctQueryNode[] = [];
        for (const node of nodes) {
          if (node.id === nodeId) {
            if (preservedView && !inserted) {
              output.push(preservedView);
              inserted = true;
            }
            continue;
          }
          output.push({ ...node, children: remove(node.children) });
        }
        return output;
      };
      return { ...tree, children: remove(tree.children) };
    });
  }

  function setSearchText(text: string) {
    updateTree((tree) => ({
      ...tree,
      children: tree.children.map((node) =>
        node.name === "text" && node.id === "query-text"
          ? { ...node, text }
          : node,
      ),
    }));
  }

  /** Clear all facet/path constraints while preserving root settings and view configuration. */
  function resetQuery() {
    updateTree((tree) => {
      const textNode: FctQueryNode = {
        id: "query-text",
        name: "text",
        attributes: {},
        text: "",
        children: [],
      };
      const existingView = findNodeInTree(tree, "query-view");
      const viewNode: FctQueryNode = existingView
        ? { ...existingView, children: [], attributes: { ...existingView.attributes, offset: "0" } }
        : {
            id: "query-view",
            name: "view",
            attributes: { type: "text", limit: "30", offset: "0" },
            children: [],
          };
      return { ...tree, children: [textNode, viewNode] };
    });
  }

  function setView(type: string) {
    updateTree((tree) => ({
      ...tree,
      children: updateNodeRecursively(tree.children, "query-view", (node) => ({
        ...node,
        attributes: { ...node.attributes, type },
      })),
    }));
  }

  function updateNodeRecursively(
    nodes: FctQueryNode[],
    nodeId: string,
    update: (node: FctQueryNode) => FctQueryNode,
  ): FctQueryNode[] {
    return nodes.map((node) => node.id === nodeId
      ? update(node)
      : { ...node, children: updateNodeRecursively(node.children, nodeId, update) });
  }

  function replaceNode(
    nodes: FctQueryNode[],
    nodeId: string,
    replacement: FctQueryNode,
  ): FctQueryNode[] {
    return nodes.map((node) =>
      node.id === nodeId
        ? replacement
        : { ...node, children: replaceNode(node.children, nodeId, replacement) },
    );
  }

function findNode(node: FctQueryNode, nodeId: string): FctQueryNode | null {
    if (node.id === nodeId) return node;
    for (const child of node.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
    return null;
  }

  function updateChildrenAtParent(
    tree: FctQueryTree,
    parentId: string | null,
    update: (children: FctQueryNode[]) => FctQueryNode[],
  ): FctQueryTree {
    if (parentId === null || parentId === "query-root") {
      return { ...tree, children: update(tree.children) };
    }
    function visit(node: FctQueryNode): FctQueryNode {
      if (node.id === parentId) return { ...node, children: update(node.children) };
      return { ...node, children: node.children.map(visit) };
    }
    return { ...tree, children: tree.children.map(visit) };
  }

  function findNodeInTree(tree: FctQueryTree, nodeId: string): FctQueryNode | null {
    for (const child of tree.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
    return null;
  }

  function getViewNode(tree: FctQueryTree = state.tree): FctQueryNode | null {
    return findNodeInTree(tree, "query-view");
  }

  function ensurePropertiesParent(tree: FctQueryTree): FctQueryTree {
    const view = getViewNode(tree);
    if (!view || view.children.some((node) => node.id === "query-view-properties")) {
      return tree;
    }
    const propertiesNode: FctQueryNode = {
      id: "query-view-properties",
      name: "properties",
      attributes: {},
      children: [],
    };
    return {
      ...tree,
      children: updateNodeRecursively(tree.children, "query-view", (node) => ({
        ...node,
        children: [...node.children, propertiesNode],
      })),
    };
  }

  function getPropertyPath(): { id: string; uri: string; name: string }[] {
    const path: FctQueryNode[] = [];
    function findPath(nodes: FctQueryNode[], ancestors: FctQueryNode[]): boolean {
      for (const node of nodes) {
        const nextAncestors = [...ancestors, node];
        if (node.id === "query-view") {
          // The breadcrumb is the structural path to the active <view>, not
          // the generated ID prefix of each relationship. A relationship that
          // was originally a property filter can become the focus when the view
          // is moved into it; its ID may remain property-filter-* even though
          // it now defines the active path. Derive focus from ancestry so those
          // moves keep the breadcrumb trail in sync with the source-of-truth tree.
          path.push(...nextAncestors.filter((item) =>
            (item.name === "property" || item.name === "property-of") &&
            typeof item.attributes.iri === "string" &&
            item.attributes.iri.length > 0,
          ));
          return true;
        }
        if (findPath(node.children, nextAncestors)) return true;
      }
      return false;
    }
    findPath(state.tree.children, []);
    return path.map((node) => ({ id: node.id, uri: node.attributes.iri ?? "", name: node.name }));
  }

  function getPropertiesParent(tree: FctQueryTree = state.tree): FctQueryNode | null {
    const view = getViewNode(tree);
    return view?.children.find((node) => node.id === "query-view-properties") ?? null;
  }

  function getPropertiesAtNode(parentId: string | null = null): string[] {
    // The checkbox selection represents only sibling filter nodes in the
    // <view><properties> group; nested drill-down path nodes are separate.
    const parent = parentId ? findNodeInTree(state.tree, parentId) : getPropertiesParent();
    const local = (parent?.children ?? []).filter(
      (node) => node.name === "property" && node.id.startsWith("property-filter-") && typeof node.attributes.iri === "string",
    );
    return [...new Set(local.map((node) => node.attributes.iri))];
  }

  function getClassesAtNode(parentId: string | null = null): string[] {
    const parent = parentId ? findNodeInTree(state.tree, parentId) : null;
    const children = parent ? parent.children : state.tree.children;
    return children
      .filter((node) => node.name === "class" && typeof node.attributes.iri === "string")
      .map((node) => node.attributes.iri);
  }

  /**
   * The only method allowed to insert a <property> node into the query tree.
   * It always checks the current authoritative tree by IRI before insertion.
   * Filter properties belong to the active view's <properties> group; path
   * properties wrap the active <view> at its current scope.
   */
  function addProperty(
    uri: string,
    kind: "filter" | "path",
    parentId: string | null = null,
  ): void {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;

    updateTree((originalTree) => {
      if (kind === "filter") {
        // A property already used as a drill-down path cannot also be added
        // as an active-view filter. The API is the enforcement boundary for
        // this invariant; callers must not have to remember to check it.
        if (getPropertyPathFromTree(originalTree).some((item) => item.uri === normalizedUri)) {
          return originalTree;
        }

        const tree = ensurePropertiesParent(originalTree);
        const parent = parentId ? findNodeInTree(tree, parentId) : getPropertiesParent(tree);
        if (!parent) return tree;
        // The active view's <properties> wrapper is the authoritative filter
        // scope even when callers identify that scope by its path-node ID.
        // Search it before insertion so a filter is reused rather than copied
        // into a second location under the path node.
        const activeViewProperties = getPropertiesParent(tree);
        const alreadyInActiveView = (activeViewProperties?.children ?? []).some(
          (node) => node.name === "property" && node.attributes.iri === normalizedUri,
        );
        // Also check the requested scope and legacy root-level property nodes.
        const alreadyInScope = parent.children.some(
          (node) => node.name === "property" && node.attributes.iri === normalizedUri,
        );
        const legacyRootFilter = parentId == null && tree.children.some(
          (node) => node.name === "property" && node.attributes.iri === normalizedUri,
        );
        if (alreadyInActiveView || alreadyInScope || legacyRootFilter) return tree;

        const property: FctQueryNode = {
          id: `property-filter-${encodeURIComponent(normalizedUri)}`,
          name: "property",
          attributes: { iri: normalizedUri },
          children: [],
        };
        const targetParent = parent;
        function insertFilter(nodes: FctQueryNode[]): FctQueryNode[] {
          return nodes.map((node) => node.id === targetParent.id
            ? { ...node, children: [...node.children, property] }
            : { ...node, children: insertFilter(node.children) });
        }
        return { ...tree, children: insertFilter(tree.children) };
      }

      const originalView = findNodeInTree(originalTree, "query-view");
      if (!originalView) return originalTree;
      const currentPath = getPropertyPathFromTree(originalTree);
      const pathAlreadyExists = currentPath.some((item) => item.uri === normalizedUri);

      // If this predicate is used as the drill-down path, its active filter
      // would serialize as a second <property iri="..."> inside the path's
      // <view>. Convert it to the path representation by removing only the
      // matching active-view filter before wrapping. Preserve all other
      // filters and value bindings.
      const isPropertiesGroup = (node: FctQueryNode) =>
        node.name === "properties" || node.id === "query-view-properties";
      const isMatchingFilter = (node: FctQueryNode) =>
        node.name === "property" && node.attributes.iri === normalizedUri;
      const filterWasRemoved = originalView.children.some(
        (child) => isPropertiesGroup(child) && child.children.some(isMatchingFilter),
      );
      const viewWithoutDuplicateFilter: FctQueryNode = {
        ...originalView,
        // Remove the <properties> container too if its last filter was removed.
        // Empty containers are not meaningful query state and should not be serialized.
        children: originalView.children.flatMap((child) => {
          if (!isPropertiesGroup(child)) return [child];
          const remainingFilters = child.children.filter(
            (filter) => !isMatchingFilter(filter),
          );
          return remainingFilters.length > 0
            ? [{ ...child, children: remainingFilters }]
            : [];
        }),
      };
      const treeWithoutDuplicateFilter = filterWasRemoved
        ? {
            ...originalTree,
            children: replaceNode(originalTree.children, "query-view", viewWithoutDuplicateFilter),
          }
        : originalTree;

      // When entering a path from the query root, filters attached to the root
      // view are root-scope constraints, not filters for the destination path.
      // Move every remaining property-filter out of the root view's <properties>
      // wrapper before moving the view under the selected path. Otherwise an
      // unrelated root checkbox (e.g. dct:issued) accidentally becomes a filter
      // inside the newly visited dct:creator scope.
      let treeForPath = treeWithoutDuplicateFilter;
      const rootView = treeForPath.children.find((node) => node.id === "query-view");
      if (rootView) {
        const rootProperties = rootView.children.find(isPropertiesGroup);
        const rootFilters = (rootProperties?.children ?? []).filter(
          (node) => node.name === "property" && node.id.startsWith("property-filter-"),
        );
        if (rootFilters.length > 0 && rootProperties) {
          const filterIds = new Set(rootFilters.map((node) => node.id));
          const viewWithoutRootFilters: FctQueryNode = {
            ...rootView,
            children: rootView.children.flatMap((child) => {
              if (child.id !== rootProperties.id) return [child];
              const remaining = child.children.filter((node) => !filterIds.has(node.id));
              return remaining.length > 0 ? [{ ...child, children: remaining }] : [];
            }),
          };
          treeForPath = {
            ...treeForPath,
            children: [
              ...treeForPath.children.filter((node) => node.id !== "query-view"),
              ...rootFilters,
              viewWithoutRootFilters,
            ],
          };
        }
      }

      // Repeated Goto clicks for an existing path are idempotent. Remove a
      // matching legacy root-level filter if an older UI version left it beside
      // the existing path, otherwise XML can contain duplicate predicates.
      if (pathAlreadyExists) {
        const rootHasPath = treeForPath.children.some((node) =>
          node.name === "property" && node.id.startsWith("property-path-") &&
          node.attributes.iri === normalizedUri,
        );
        if (!rootHasPath) return treeForPath;
        return {
          ...treeForPath,
          children: treeForPath.children.filter((node) => !(
            node.name === "property" && node.id.startsWith("property-filter-") &&
            node.attributes.iri === normalizedUri
          )),
        };
      }

      const viewParent = findParentOfNode(treeForPath.children, "query-view");
      if (!viewParent) return treeForPath;
      const parentNode = viewParent.parentId
        ? findNodeInTree(treeForPath, viewParent.parentId)
        : null;
      const siblings = parentNode ? parentNode.children : treeForPath.children;
      if (
        siblings.some(
          (node) =>
            node.name === "property" &&
            node.id.startsWith("property-path-") &&
            node.attributes.iri === normalizedUri,
        )
      ) {
        return treeForPath;
      }

      const view = findNodeInTree(treeForPath, "query-view");
      if (!view) return treeForPath;

      // Reuse a matching property node already present beside the active view
      // in this scope. In particular, legacy root-level property-filter nodes
      // must be promoted into the path instead of leaving a duplicate behind.
      const existingScopedProperty = siblings.find((node) =>
        node.name === "property" && node.attributes.iri === normalizedUri,
      );
      const propertyNode: FctQueryNode = {
        id: `property-path-${Date.now()}-${encodeURIComponent(normalizedUri)}`,
        name: "property",
        attributes: { iri: normalizedUri },
        children: [view],
      };
      function wrapView(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.flatMap((node) => {
          if (node.id === "query-view") return existingScopedProperty ? [] : [propertyNode];
          if (existingScopedProperty && node.id === existingScopedProperty.id) return [propertyNode];
          if (existingScopedProperty && node.name === "property" && node.attributes.iri === normalizedUri) return [];
          return [{ ...node, children: wrapView(node.children) }];
        });
      }
      return { ...treeForPath, children: wrapView(treeForPath.children) };
    });
  }

  function addPropertyToNode(parentId: string | null, uri: string) {
    addProperty(uri, "filter", parentId);
  }

  function setPropertyValues(parentId: string | null, uri: string, valuesInput: FctValueInput[]) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    const uniqueValues = new Map<string, FctValueInput>();
    for (const value of valuesInput) {
      const normalized = normalizeFctValue(value);
      if (!normalized.text.trim()) continue;
      uniqueValues.set(fctValueKey(value), value);
    }
    updateTree((tree) => {
      const parent = parentId ? findNodeInTree(tree, parentId) : getPropertiesParent(tree);
      const scopedProperty = (parent?.children ?? []).find(
        (node) => node.name === "property" && node.attributes.iri === normalizedUri,
      );
      const rootPathProperty = !parentId && tree.children.some((node) => node.id === "query-view")
        ? tree.children.find(
            (node) => node.name === "property" && node.id.startsWith("property-path-") && node.attributes.iri === normalizedUri,
          )
        : undefined;
      const target = scopedProperty ?? rootPathProperty;
      if (!target) return tree;
      const values = [...uniqueValues.values()];
      const value = values[values.length - 1];
      const valueNodes = value ? [createValueNode(
        `property-value-${encodeURIComponent(normalizedUri)}-${encodeURIComponent(fctValueKey(value))}`,
        value,
        typeof value === "string" ? "uri" : undefined,
      )] : [];
      return { ...tree, children: replaceNode(tree.children, target.id, {
        ...target,
        children: [...target.children.filter((node) => node.name !== "value"), ...valueNodes],
      }) };
    });
  }

  function setPropertyValue(parentId: string | null, uri: string, value: FctValueInput, checked: boolean) {
    const normalizedUri = uri.trim();
    const normalizedValue = normalizeFctValue(value);
    if (!normalizedUri || !normalizedValue.text.trim()) return;
    const tree = state.tree;
    const parent = parentId ? findNodeInTree(tree, parentId) : getPropertiesParent(tree);
    const scopedProperty = (parent?.children ?? []).find(
      (node) => node.name === "property" && node.attributes.iri === normalizedUri,
    );
    const rootPathProperty = !parentId && tree.children.some((node) => node.id === "query-view")
      ? tree.children.find(
          (node) => node.name === "property" && node.id.startsWith("property-path-") && node.attributes.iri === normalizedUri,
        )
      : undefined;
    const property = scopedProperty ?? rootPathProperty;
    const values = (property?.children ?? [])
      .filter((node) => node.name === "value")
      .map((node) => ({
        text: node.text ?? "",
        datatype: node.attributes.datatype,
        lang: node.attributes["xml:lang"],
        op: node.attributes.op,
        attributes: Object.fromEntries(Object.entries(node.attributes).filter(([name]) =>
          !["datatype", "xml:lang", "op"].includes(name))),
      }))
      .filter((item) => item.text);
    const currentKey = fctValueKey(value);
    const existing = values.some((item) => fctValueKey(item) === currentKey);
    const nextValues = checked
      ? existing ? values : [...values, value]
      : values.filter((item) => fctValueKey(item) !== currentKey);
    setPropertyValues(parentId, normalizedUri, nextValues);
  }

  function removePropertyFromNode(parentId: string | null, uri: string) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;

    updateTree((tree) => {
      const parent = parentId ? findNodeInTree(tree, parentId) : getPropertiesParent(tree);
      const hasLocalFilter = Boolean(
        parent?.children.some(
          (child) =>
            child.name === "property" &&
            child.id.startsWith("property-filter-") &&
            child.attributes.iri === normalizedUri,
        ),
      );

      if (hasLocalFilter && parent) {
        // Remove the active scope's filter from its authoritative location.
        // Use the ID prefix as well as the IRI so a path node with the same
        // predicate can never be deleted accidentally.
        const targetParentId = parent.id;
        function removeAtParent(nodes: FctQueryNode[]): FctQueryNode[] {
          return nodes.map((node) =>
            node.id === targetParentId
              ? {
                  ...node,
                  children: node.children.filter(
                    (child) =>
                      !(
                        child.name === "property" &&
                        child.id.startsWith("property-filter-") &&
                        child.attributes.iri === normalizedUri
                      ),
                  ),
                }
              : { ...node, children: removeAtParent(node.children) },
          );
        }
        return { ...tree, children: removeAtParent(tree.children) };
      }

      // Compatibility with legacy/root-level filter nodes. The serializer
      // emits view-owned filters as query-level <property> siblings, and older
      // trees may store those siblings directly instead of under <properties>.
      if (!parentId && tree.children.some((node) => node.id === "query-view")) {
        return {
          ...tree,
          children: tree.children.filter(
            (node) =>
              !(
                node.name === "property" &&
                node.id.startsWith("property-filter-") &&
                node.attributes.iri === normalizedUri
              ),
          ),
        };
      }

      return tree;
    });
  }

  function navigateToPropertyPath(targetId: string) {
    updateTree((originalTree) => {
      const view = findNodeInTree(originalTree, "query-view");
      if (!view) return originalTree;
      // Capture the narrowed node with an explicit non-null type before using it
      // inside nested tree-walking callbacks (TypeScript otherwise widens it).
      const activeView: FctQueryNode = view;

      if (targetId === "query-root") {
        function removeView(nodes: FctQueryNode[]): FctQueryNode[] {
          return nodes
            .filter((node) => node.id !== "query-view")
            .map((node) => ({ ...node, children: removeView(node.children) }));
        }
        return { ...originalTree, children: [...removeView(originalTree.children), view] };
      }

      const properties = view.children.find(
        (node) => node.id === "query-view-properties" || node.name === "properties",
      );
      const selectedFilter = properties?.children.find(
        (node) => node.id === targetId && node.name === "property" &&
          node.id.startsWith("property-filter-") && typeof node.attributes.iri === "string",
      );

      // A filter selected as a breadcrumb destination must become a path node,
      // not remain a property-filter hidden inside <view><properties>. Move all
      // filters for the old scope beside the new path, promote the selected
      // relationship to a path node, and attach a filter-free view beneath it.
      // This keeps the tree structurally faithful to the FCT XML and avoids
      // same-IRI filter/path nodes competing to represent one relationship.
      if (selectedFilter && properties) {
        const activeFilters = properties.children.filter(
          (node) => node.name === "property" && node.id.startsWith("property-filter-"),
        );
        const viewWithoutFilters: FctQueryNode = {
          ...view,
          children: view.children.flatMap((child) => {
            if (child.id !== properties.id) return [child];
            const remaining = child.children.filter(
              (node) => !(node.name === "property" && node.id.startsWith("property-filter-")),
            );
            return remaining.length ? [{ ...child, children: remaining }] : [];
          }),
        };
        const pathNode: FctQueryNode = {
          ...selectedFilter,
          id: `property-path-${Date.now()}-${encodeURIComponent(selectedFilter.attributes.iri)}`,
          children: [...selectedFilter.children.filter((child) => child.name === "value"), viewWithoutFilters],
        };

        const viewParent = findParentOfNode(originalTree.children, "query-view");
        if (!viewParent) return originalTree;
        const removeViewAndSelectedFilter = (nodes: FctQueryNode[]): FctQueryNode[] =>
          nodes.flatMap((node) => {
            if (node.id === "query-view") return [];
            if (node.id === properties.id) {
              const remaining = node.children.filter((child) => child.id !== targetId);
              return remaining.length ? [{ ...node, children: remaining }] : [];
            }
            return [{ ...node, children: removeViewAndSelectedFilter(node.children) }];
          });
        const withoutView = removeViewAndSelectedFilter(originalTree.children);
        const scopeParentId = viewParent.parentId;
        const additions = [...activeFilters.filter((node) => node.id !== targetId), pathNode];
        if (scopeParentId === null) {
          return { ...originalTree, children: [...withoutView, ...additions] };
        }
        const insertAtScope = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) =>
          node.id === scopeParentId
            ? { ...node, children: [...node.children, ...additions] }
            : { ...node, children: insertAtScope(node.children) },
        );
        return { ...originalTree, children: insertAtScope(withoutView) };
      }

      // Existing navigation-path nodes are resolved by their actual tree ID.
      // The view is moved to that node without treating arbitrary same-IRI nodes
      // as interchangeable.
      function removeView(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes
          .filter((node) => node.id !== "query-view")
          .map((node) => ({ ...node, children: removeView(node.children) }));
      }
      const withoutView = removeView(originalTree.children);
      let targetFound = false;
      function insertView(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.map((node): FctQueryNode => {
          if (node.id === targetId && (node.name === "property" || node.name === "property-of")) {
            targetFound = true;
            return { ...node, children: [...node.children, activeView] };
          }
          return { ...node, children: insertView(node.children) };
        });
      }
      const children = insertView(withoutView);
      return targetFound ? { ...originalTree, children } : originalTree;
    });
  }

  /**
   * Move the active <view> to a relationship chosen from the breadcrumb's
   * sibling menu. The target is resolved only within the requested focus node's
   * scope: either a sibling at the same parent level, or a relationship exposed
   * by the focus node's own <view>/<properties> group.
   *
   * When the target lives inside the focused view, <properties> is a transparent
   * wrapper for navigation. Its children are lifted into the focus node's scope,
   * and the existing view node is attached to the selected relationship. Other
   * query nodes are preserved; all changes go through updateTree/listeners.
   */
  function moveViewToSibling(currentFocusId: string, targetId: string) {
    const findNodeAndParent = (
      nodes: FctQueryNode[],
      target: string,
      parent: FctQueryNode | FctQueryTree | null = null,
    ): { node: FctQueryNode; parent: FctQueryNode | FctQueryTree | null } | null => {
      for (const node of nodes) {
        if (node.id === target) return { node, parent };
        const found = findNodeAndParent(node.children, target, node);
        if (found) return found;
      }
      return null;
    };

    const focusMatch = findNodeAndParent(state.tree.children, currentFocusId, state.tree);
    if (!focusMatch) return;
    const focus = focusMatch.node;
    const view = focus.children.find((node) => node.id === "query-view" || node.name === "view");
    const isRelationship = (node: FctQueryNode) =>
      node.name === "property" || node.name === "property-of";

    // Case 1: the menu is showing relationships inside this focus node's own
    // view. Do not search elsewhere in the tree for the target.
    if (view) {
      const exposedChildren = view.children.flatMap((child) =>
        child.name === "properties" || child.id === "query-view-properties"
          ? child.children
          : [child],
      );
      const targetIsInFocusScope = exposedChildren.some(
        (node) => node.id === targetId && isRelationship(node),
      );
      if (targetIsInFocusScope) {
        updateTree((tree) => {
          let moved = false;
          const transformFocus = (nodes: FctQueryNode[]): FctQueryNode[] =>
            nodes.map((node) => {
              if (node.id !== currentFocusId) {
                return { ...node, children: transformFocus(node.children) };
              }

              const activeView = node.children.find(
                (child) => child.id === "query-view" || child.name === "view",
              );
              if (!activeView) return node;
              const liftedChildren = activeView.children.flatMap((child) =>
                child.name === "properties" || child.id === "query-view-properties"
                  ? child.children
                  : [child],
              );
              if (!liftedChildren.some((child) => child.id === targetId && isRelationship(child))) {
                return node;
              }

              const siblings = node.children.flatMap((child) =>
                child.id === activeView.id ? liftedChildren : [child],
              );
              const withViewMoved = siblings.map((child) => {
                if (child.id !== targetId) return child;
                moved = true;
                return { ...child, children: [...child.children, activeView] };
              });
              return { ...node, children: withViewMoved };
            });

          const children = transformFocus(tree.children);
          return moved ? { ...tree, children } : tree;
        });
        return;
      }
    }

    // Case 2: the target is a relationship sibling of the breadcrumb node.
    // Reuse the established navigation operation, but only if both nodes share
    // the same immediate parent; this prevents accidental cross-scope matches.
    const targetMatch = findNodeAndParent(state.tree.children, targetId, state.tree);
    if (
      targetMatch &&
      focusMatch.parent &&
      targetMatch.parent &&
      focusMatch.parent === targetMatch.parent &&
      isRelationship(focusMatch.node) &&
      isRelationship(targetMatch.node)
    ) {
      navigateToPropertyPath(targetId);
    }
  }

  function findParentOfNode(nodes: FctQueryNode[], targetId: string, parentId: string | null = null): { parentId: string | null } | null {
    for (const node of nodes) {
      if (node.id === targetId) return { parentId };
      const found = findParentOfNode(node.children, targetId, node.id);
      if (found) return found;
    }
    return null;
  }

  function addNestedProperty(uri: string) {
    addProperty(uri, "path");
  }

  /**
   * Enter a reverse relationship (<property-of>) using the same path semantics
   * as addNestedProperty. A role filter already in the tree is promoted into
   * the path instead of being duplicated.
   */
  function addNestedPropertyOf(uri: string) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;

    updateTree((originalTree) => {
      const view = findNodeInTree(originalTree, "query-view");
      if (!view) return originalTree;

      // Existing reverse paths are idempotent. The UI normally navigates to
      // these before calling this method, but keep the query API defensive.
      const viewAncestors = (() => {
        function find(nodes: FctQueryNode[], ancestors: FctQueryNode[] = []): FctQueryNode[] | null {
          for (const node of nodes) {
            if (node.id === "query-view") return ancestors;
            const result = find(node.children, [...ancestors, node]);
            if (result) return result;
          }
          return null;
        }
        return find(originalTree.children) ?? [];
      })();
      if (viewAncestors.some((node) =>
        node.name === "property-of" && node.id.startsWith("role-filter-") &&
        node.attributes.iri === normalizedUri,
      )) return originalTree;

      const existingRole = (() => {
        function findScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
          for (const node of nodes) {
            if (node.children.some((child) => child.id === "query-view")) return node.children;
            const result = findScope(node.children);
            if (result) return result;
          }
          return nodes.some((node) => node.id === "query-view") ? nodes : null;
        }
        return (findScope(originalTree.children) ?? []).find(
          (node) => node.name === "property-of" && node.id.startsWith("role-filter-") &&
            node.children.length === 0 && node.attributes.iri === normalizedUri,
        ) ?? null;
      })();

      // Remove only the active scope's role filter before promoting it to a
      // path, so filters in sibling scopes remain independent.
      function removeExistingRole(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes
          .filter((node) => node.id !== existingRole?.id)
          .map((node) => ({ ...node, children: removeExistingRole(node.children) }));
      }
      const baseTree = existingRole
        ? { ...originalTree, children: removeExistingRole(originalTree.children) }
        : originalTree;
      const rolePath: FctQueryNode = {
        id: existingRole?.id ?? `role-filter-${encodeURIComponent(normalizedUri)}`,
        name: "property-of",
        attributes: { iri: normalizedUri },
        children: [...(existingRole?.children ?? []), view],
      };

      function wrapView(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.flatMap((node) => {
          if (node.id === "query-view") return [rolePath];
          return [{ ...node, children: wrapView(node.children) }];
        });
      }
      return { ...baseTree, children: wrapView(baseTree.children) };
    });
  }

  function getPropertyPathFromTree(tree: FctQueryTree): { id: string; uri: string; name: string }[] {
    const path: FctQueryNode[] = [];
    function findPath(nodes: FctQueryNode[], ancestors: FctQueryNode[]): boolean {
      for (const node of nodes) {
        const nextAncestors = [...ancestors, node];
        if (node.id === "query-view") {
          // Keep pure tree operations consistent with getPropertyPath(): any
          // property/property-of ancestor of the active view is a focus-path
          // node, regardless of whether it started life as a filter node.
          path.push(...nextAncestors.filter((item) =>
            (item.name === "property" || item.name === "property-of") &&
            typeof item.attributes.iri === "string" &&
            item.attributes.iri.length > 0,
          ));
          return true;
        }
        if (findPath(node.children, nextAncestors)) return true;
      }
      return false;
    }
    findPath(tree.children, []);
    return path.map((node) => ({ id: node.id, uri: node.attributes.iri ?? "", name: node.name }));
  }

  function insertClassAtScope(
    tree: FctQueryTree,
    parentId: string | null,
    classNode: FctQueryNode,
  ): FctQueryTree {
    // A scope is either the query root or a property-path node. Keep the
    // class constraint alongside that scope's view, before <view> in XML.
    if (parentId) {
      function appendAtScope(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.map((node) => {
          if (node.id !== parentId) {
            return { ...node, children: appendAtScope(node.children) };
          }
          const children = [...node.children];
          const viewIndex = children.findIndex((child) => child.id === "query-view");
          children.splice(viewIndex < 0 ? children.length : viewIndex, 0, classNode);
          return { ...node, children };
        });
      }
      return { ...tree, children: appendAtScope(tree.children) };
    }

    const children = [...tree.children];
    const viewIndex = children.findIndex((child) => child.id === "query-view");
    children.splice(viewIndex < 0 ? children.length : viewIndex, 0, classNode);
    return { ...tree, children };
  }

  function addClassToNode(parentId: string | null, uri: string) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    updateTree((tree) => {
      const parent = parentId ? findNodeInTree(tree, parentId) : null;
      const scopeChildren = parent ? parent.children : tree.children;
      if (scopeChildren.some((child) => child.name === "class" && child.attributes.iri === normalizedUri)) {
        return tree;
      }
      const node: FctQueryNode = {
        id: `class-${parentId ? `${encodeURIComponent(parentId)}-` : "root-"}${encodeURIComponent(normalizedUri)}`,
        name: "class",
        attributes: { iri: normalizedUri },
        children: [],
      };
      return insertClassAtScope(tree, parentId, node);
    });
  }

  function removeClassFromNode(parentId: string | null, uri: string) {
    const normalizedUri = uri.trim();
    updateTree((tree) => {
      if (parentId) {
        function remove(nodes: FctQueryNode[]): FctQueryNode[] {
          return nodes.map((node) => node.id === parentId
            ? { ...node, children: node.children.filter((child) => !(child.name === "class" && child.attributes.iri === normalizedUri)) }
            : { ...node, children: remove(node.children) });
        }
        return { ...tree, children: remove(tree.children) };
      }
      return { ...tree, children: tree.children.filter((node) => !(node.name === "class" && node.attributes.iri === normalizedUri)) };
    });
  }

  /** Force subscribed queries/facets to reload after an external endpoint change. */
  function refresh() {
    updateTree((tree) => ({ ...tree, children: [...tree.children] }));
  }

  /** Add/remove a reverse-property filter in the active view's scope. */
  function setRoleFilter(uri: string, checked: boolean) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    updateTree((tree) => {
      // Locate the parent that directly contains the active view. Role filters
      // are siblings of that view, just as forward filters are attached to its
      // <properties> group. This prevents a selection in one breadcrumb scope
      // from leaking into every other scope.
      function findViewParent(nodes: FctQueryNode[]): { parentId: string | null; children: FctQueryNode[] } | null {
        for (const node of nodes) {
          if (node.children.some((child) => child.id === "query-view")) {
            return { parentId: node.id, children: node.children };
          }
          const nested = findViewParent(node.children);
          if (nested) return nested;
        }
        if (nodes.some((node) => node.id === "query-view")) {
          return { parentId: null, children: nodes };
        }
        return null;
      }
      const scope = findViewParent(tree.children);
      if (!scope) return tree;
      const scopedRole = scope.children.find(
        (node) => node.name === "property-of" && node.id.startsWith("role-filter-") &&
          node.attributes.iri === normalizedUri,
      );
      let nextChildren = scope.children.filter((node) => node.id !== scopedRole?.id);
      if (checked && !scopedRole) {
        const roleNode: FctQueryNode = {
          id: `role-filter-${scope.parentId ? `${encodeURIComponent(scope.parentId)}-` : "root-"}${encodeURIComponent(normalizedUri)}`,
          name: "property-of",
          attributes: { iri: normalizedUri },
          children: [],
        };
        const viewIndex = nextChildren.findIndex((node) => node.id === "query-view");
        nextChildren = [...nextChildren];
        nextChildren.splice(viewIndex < 0 ? nextChildren.length : viewIndex, 0, roleNode);
      } else if (checked) {
        return tree;
      }
      const scopeParentId = scope.parentId;
      if (scopeParentId === null) return { ...tree, children: nextChildren };
      function replaceScope(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.map((node) => node.id === scopeParentId
          ? { ...node, children: nextChildren }
          : { ...node, children: replaceScope(node.children) });
      }
      return { ...tree, children: replaceScope(tree.children) };
    });
  }

  /** Bind/unbind a typed value on the active scope's reverse-property filter. */
  function setRoleValue(uri: string, value: FctValueInput, checked: boolean) {
    const normalizedUri = uri.trim();
    const normalizedValue = normalizeFctValue(value);
    if (!normalizedUri || !normalizedValue.text.trim()) return;
    updateTree((tree) => {
      function findViewParent(nodes: FctQueryNode[]): { parentId: string | null; children: FctQueryNode[] } | null {
        for (const node of nodes) {
          if (node.children.some((child) => child.id === "query-view")) return { parentId: node.id, children: node.children };
          const nested = findViewParent(node.children);
          if (nested) return nested;
        }
        if (nodes.some((node) => node.id === "query-view")) return { parentId: null, children: nodes };
        return null;
      }
      const scope = findViewParent(tree.children);
      if (!scope) return tree;
      const target = scope.children.find((node) => node.name === "property-of" && node.id.startsWith("role-filter-") && node.attributes.iri === normalizedUri);
      let targetId = target?.id;
      if (!targetId) {
        function findAncestorRole(nodes: FctQueryNode[]): FctQueryNode | undefined {
          for (const node of nodes) {
            const containsView = (candidate: FctQueryNode): boolean => candidate.id === "query-view" || candidate.children.some(containsView);
            if (node.name === "property-of" && node.attributes.iri === normalizedUri && containsView(node)) return node;
            const nested = findAncestorRole(node.children);
            if (nested) return nested;
          }
          return undefined;
        }
        targetId = findAncestorRole(tree.children)?.id;
      }
      if (!targetId) return tree;
      function updateTarget(nodes: FctQueryNode[]): FctQueryNode[] {
        return nodes.map((node) => {
          if (node.id !== targetId) return { ...node, children: updateTarget(node.children) };
          const existingValues = node.children.filter((child) => child.name === "value");
          const keyForNode = (child: FctQueryNode) => fctValueKey({
            text: child.text ?? "",
            datatype: child.attributes.datatype,
            lang: child.attributes["xml:lang"],
            op: child.attributes.op,
            attributes: Object.fromEntries(Object.entries(child.attributes).filter(([name]) =>
              !["datatype", "xml:lang", "op"].includes(name))),
          });
          const wantedKey = fctValueKey(value);
          const nextValues = checked
            ? existingValues.some((child) => keyForNode(child) === wantedKey)
              ? existingValues
              : [...existingValues, createValueNode(
                  `role-value-${encodeURIComponent(normalizedUri)}-${encodeURIComponent(wantedKey)}`,
                  value,
                  typeof value === "string" ? "uri" : undefined,
                )]
            : existingValues.filter((child) => keyForNode(child) !== wantedKey);
          return { ...node, children: [...node.children.filter((child) => child.name !== "value"), ...nextValues] };
        });
      }
      return { ...tree, children: updateTarget(tree.children) };
    });
  }

  /** Change result pagination through the query API, never through a UI tree edit. */
  function setResultsPage(limit: number, offset: number) {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    updateTree((tree) => ({
      ...tree,
      children: updateNodeRecursively(tree.children, "query-view", (node) => ({
        ...node,
        attributes: {
          ...node.attributes,
          limit: String(safeLimit),
          offset: String(safeOffset),
        },
      })),
    }));
  }

  /** Add a class constraint at the supplied scope and switch the active view to results. */
  function showClassResults(uri: string, parentId: string | null = null) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    updateTree((tree) => {
      const parent = parentId ? findNodeInTree(tree, parentId) : null;
      const scopeChildren = parent ? parent.children : tree.children;
      const alreadyPresent = scopeChildren.some(
        (node) => node.name === "class" && node.attributes.iri === normalizedUri,
      );
      let nextTree = tree;
      if (!alreadyPresent) {
        const classNode: FctQueryNode = {
          id: `class-${parentId ? `${encodeURIComponent(parentId)}-` : "root-"}${encodeURIComponent(normalizedUri)}`,
          name: "class",
          attributes: { iri: normalizedUri },
          children: [],
        };
        nextTree = insertClassAtScope(nextTree, parentId, classNode);
      }
      return {
        ...nextTree,
        children: updateNodeRecursively(nextTree.children, "query-view", (node) => ({
          ...node,
          attributes: {
            ...node.attributes,
            type: "text",
            limit: "30",
            offset: "0",
          },
        })),
      };
    });
  }

  function deleteNode(nodeId: string) {
    updateTree((tree) => {
      const target = findNodeInTree(tree, nodeId);
      if (!target || nodeId === "query-view" || nodeId === "query-text") return tree;

      // Delete exactly the selected node. Removing a <value> clears only that
      // binding; its parent <property> filter remains in the authoritative tree.
      const removalId = nodeId;
      const removalTarget = findNodeInTree(tree, removalId);
      if (!removalTarget) return tree;
      const containsView = Boolean(findNode(removalTarget, "query-view"));
      const preservedView = containsView ? findNode(removalTarget, "query-view") : null;
      let insertedView = false;

      function removeAndRelocate(nodes: FctQueryNode[]): FctQueryNode[] {
        const output: FctQueryNode[] = [];
        for (const node of nodes) {
          if (node.id === removalId) {
            if (preservedView && !insertedView) {
              output.push(preservedView);
              insertedView = true;
            }
            continue;
          }
          output.push({ ...node, children: removeAndRelocate(node.children) });
        }
        return output;
      }
      return { ...tree, children: removeAndRelocate(tree.children) };
    });
  }


  return {
    getSnapshot: () => state,

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setSearchText,
    resetQuery,
    setView,
    setQueryAttribute,
    setNodeAttribute,
    setNodeText,
    insertNode,
    replaceQueryNode,
    removeQueryNode,
    getPropertiesAtNode,
    getClassesAtNode,
    getPropertyPath,
    addProperty: addPropertyToNode,
    removeProperty: removePropertyFromNode,
    setPropertyValues,
    setPropertyValue,
    setRoleValue,
    addNestedProperty,
    addNestedPropertyOf,
    navigateToPropertyPath,
    moveViewToSibling,
    addClass: addClassToNode,
    removeClass: removeClassFromNode,
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh,
    deleteNode,
  };
}



// Keep one store instance across imports and Next.js hot reloads.
// Components subscribe to this same store instead of maintaining separate copies.
const globalForFctQuery = globalThis as typeof globalThis & {
  __fctQueryStoreV7?: ReturnType<typeof createQueryStore>;
};

const fctQueryStore =
  globalForFctQuery.__fctQueryStoreV7 ??
  (globalForFctQuery.__fctQueryStoreV7 = createQueryStore());

export function useFctQuery() {
  const state = useSyncExternalStore(
    fctQueryStore.subscribe,
    fctQueryStore.getSnapshot,
    fctQueryStore.getSnapshot,
  );

  return {
    ...state,
    setSearchText: fctQueryStore.setSearchText,
    resetQuery: fctQueryStore.resetQuery,
    setView: fctQueryStore.setView,
    setQueryAttribute: fctQueryStore.setQueryAttribute,
    setNodeAttribute: fctQueryStore.setNodeAttribute,
    setNodeText: fctQueryStore.setNodeText,
    insertNode: fctQueryStore.insertNode,
    replaceNode: fctQueryStore.replaceQueryNode,
    removeNode: fctQueryStore.removeQueryNode,
    getPropertiesAtNode: fctQueryStore.getPropertiesAtNode,
    getClassesAtNode: fctQueryStore.getClassesAtNode,
    getPropertyPath: fctQueryStore.getPropertyPath,
    addProperty: fctQueryStore.addProperty,
    removeProperty: fctQueryStore.removeProperty,
    setPropertyValues: fctQueryStore.setPropertyValues,
    setPropertyValue: fctQueryStore.setPropertyValue,
    setRoleValue: fctQueryStore.setRoleValue,
    addNestedProperty: fctQueryStore.addNestedProperty,
    addNestedPropertyOf: fctQueryStore.addNestedPropertyOf,
    navigateToPropertyPath: fctQueryStore.navigateToPropertyPath,
    moveViewToSibling: fctQueryStore.moveViewToSibling,
    addClass: fctQueryStore.addClass,
    removeClass: fctQueryStore.removeClass,
    deleteNode: fctQueryStore.deleteNode,
    setRoleFilter: fctQueryStore.setRoleFilter,
    setResultsPage: fctQueryStore.setResultsPage,
    showClassResults: fctQueryStore.showClassResults,
    refresh: fctQueryStore.refresh,
  };
}