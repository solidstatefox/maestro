"use client";

import { useSyncExternalStore } from "react";

export type FctNodeName = string;

export type FctUiResultSummary = {
  /** Display label of the first record returned by the active view. */
  label: string;
  /** Result-set count (ct) for that same view. */
  count: number | null;
  /**
   * Identity of the record the label came from. The next breadcrumb badge is
   * resolved from this record, so a whole badge chain describes one record path.
   */
  uri?: string;
  termType?: "uri" | "literal" | "bnode";
};

export type FctQueryNode = {
  id: string;
  name: FctNodeName;
  attributes: Record<string, string>;
  text?: string;
  children: FctQueryNode[];
  /**
   * Ephemeral presentation metadata only. It is attached as a non-enumerable
   * property by the UI and must never become part of query serialization,
   * snapshots, clones, or query notifications.
   */
  uiResultSummary?: FctUiResultSummary;
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
  /** Ephemeral, non-enumerable UI metadata; never part of the FCT query. */
  uiResultSummary?: FctUiResultSummary;
};

export type FctQueryState = {
  /** The one authoritative query tree. */
  tree: FctQueryTree;

  /** Incremented after every state update. */
  revision: number;
};

const QUERY_NAMESPACE = "http://openlinksw.com/services/facets/1.0";
const RDFS_LABEL_URI = "http://www.w3.org/2000/01/rdf-schema#label";

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
          attributes: { property: RDFS_LABEL_URI },
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

function addValue(id: string, value: FctValueInput, defaultDatatype?: string): FctQueryNode {
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
  // An empty search means browse without full-text matching. Virtuoso FCT treats
  // <text></text> as a search for the placeholder token (NULL), not as no filter.
  // Keep the empty text node in the client query tree, but omit it on the wire.
  if (node.name === "text" && !(node.text ?? "").trim() && node.children.length === 0) return "";

  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");

  if (node.name === "view") return `<view${attributes}/>`;

  // Serialize the value text as supplied by the query tree. XML escaping
  // protects the document syntax; it must not add SPARQL IRI delimiters.
  const textContent = node.text ?? "";
  const serializedText = textContent ? escapeXml(textContent) : "";
  // FCT query filters must precede <view>. If a filter is appended after the
  // view node (for example when a user checks a facet after initial browse),
  // emitting the tree's raw child order can cause the endpoint to stop reading
  // the query before it reaches that filter. Always serialize view last at each
  // scope, without changing the authoritative query tree itself.
  const content = [
    serializedText,
    ...node.children
      .filter((child) => child.name !== "view")
      .map(serializeNode),
    ...node.children
      .filter((child) => child.name === "view")
      .map(serializeNode),
  ].join("");

  return `<${node.name}${attributes}>${content}</${node.name}>`;
}

export function serializeFctQuery(tree: FctQueryTree): string {
  const attributes = Object.entries(tree.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<query${attributes}>` +
    tree.children
      .filter((child) => child.name !== "view")
      .map(serializeNode)
      .join("") +
    tree.children
      .filter((child) => child.name === "view")
      .map(serializeNode)
      .join("") +
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
  // This query enumerates facet values, not result records. A text view also
  // projects search excerpts, which can repeat the same RDF value when it
  // matches multiple text fields. The list view projects only the target RDF
  // term and lets SPARQL DISTINCT remove join multiplicity at the query level.
  const leafView: FctQueryNode = {
    ...view,
    attributes: { ...view.attributes, type: "list", offset: "0" },
    children: [],
  };
  const attach = (nodes: FctQueryNode[]): FctQueryNode[] => {
    const viewIndex = nodes.findIndex((node) => node.id === view.id || node.id === "query-view");
    if (viewIndex >= 0) {
      const withoutView = nodes.filter((node) => node.id !== view.id && node.id !== "query-view");
      const existing = withoutView.find((node) => node.name === relationship && node.attributes.iri === iri);
      if (existing) {
        return withoutView.map((node) => node.id === existing.id
          ? { ...node, children: [...node.children.filter((child) => child.id !== "query-view"), leafView] }
          : node);
      }
      return [...withoutView, {
        id: relationshipId,
        name: relationship,
        attributes: { iri },
        children: [leafView],
      }];
    }
    return nodes.map((node) => ({ ...node, children: attach(node.children) }));
  };
  return { ...sourceTree, attributes: { ...sourceTree.attributes }, children: attach(sourceTree.children) };
}

function cloneQueryTree(tree: FctQueryTree): FctQueryTree {
  const cloneNode = (node: FctQueryNode): FctQueryNode => {
    const queryNode = { ...node };
    delete queryNode.uiResultSummary;
    return {
      ...queryNode,
      attributes: { ...node.attributes },
      children: node.name === "view" ? [] : node.children.map(cloneNode),
    };
  };
  const queryTree = { ...tree };
  delete queryTree.uiResultSummary;
  return {
    ...queryTree,
    attributes: { ...tree.attributes },
    children: tree.children.map(cloneNode),
  };
}

function isValidQueryTree(tree: unknown): tree is FctQueryTree {
  if (!tree || typeof tree !== "object") return false;
  const candidate = tree as Partial<FctQueryTree>;
  return candidate.name === "query" &&
    !!candidate.attributes && typeof candidate.attributes === "object" &&
    Array.isArray(candidate.children);
}

function createQueryStore(initialTree?: FctQueryTree) {
  let state: FctQueryState = initialTree
    ? { tree: cloneQueryTree(initialTree), revision: 0 }
    : createInitialState();
  const listeners = new Set<Listener>();
  function cloneNodes(nodes: FctQueryNode[]): FctQueryNode[] {
    return nodes.map((node) => {
      const queryNode = { ...node };
      delete queryNode.uiResultSummary;
      return {
        ...queryNode,
        attributes: { ...node.attributes },
        children: node.name === "view" ? [] : cloneNodes(node.children),
      };
    });
  }


  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  function updateTree(
    update: (tree: FctQueryTree) => FctQueryTree,
  ) {
    const nextTree = update(state.tree);
    state = {
      ...state,
      tree: nextTree,
      revision: state.revision + 1,
    };
    notify();
  }

  /** Replace the authoritative query with a validated snapshot, e.g. one restored from a share URL. */
  function replaceTree(tree: FctQueryTree) {
    if (!isValidQueryTree(tree)) throw new TypeError("Invalid FCT query tree");
    const clonedTree = cloneQueryTree(tree);
    const rootUriValues = clonedTree.children.filter(
      (node) => node.name === "value" && node.attributes.datatype === "uri",
    );
    state = {
      tree: clonedTree,
      revision: state.revision + 1,
    };

    // Old shared URLs may contain duplicate or empty fixed-subject values.
    // Reconcile them through the same setValue API used by live edits.
    if (rootUriValues.length) {
      const selected = rootUriValues.find((node) => node.id === "query-uri-value" && node.text?.trim())
        ?? rootUriValues.find((node) => node.text?.trim());
      setValue(
        null,
        selected?.text?.trim() ? [{ text: selected.text, datatype: "uri" }] : [],
        { replaceExisting: true, idPrefix: "query-uri-value" },
      );
      return;
    }
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
      const target = findNodeInTree(tree, nodeId);
      if (!target || target.name === "value") return tree;
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
    updateTree((tree) => {
      const target = findNodeInTree(tree, nodeId);
      if (!target || target.name === "value") return tree;
      return { ...tree, children: updateNodeRecursively(tree.children, nodeId, (node) => ({ ...node, text })) };
    });
  }

  function insertNode(parentId: string | null, node: FctQueryNode, index?: number) {
    // Value nodes must be created through setValue so existence and scope are
    // resolved by one API instead of by each caller.
    if (node.name === "value") return;
    updateTree((tree) => {
      if (parentId && !findNodeInTree(tree, parentId)) return tree;
      const insert = (children: FctQueryNode[]) => {
        const next = [...children];
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

  /**
   * Set RDF value bindings in one exact scope. This is the only API operation
   * that creates value nodes; callers choose whether to replace the scope's
   * current bindings or merge distinct bindings into them.
   */
  function setValue(
    parentId: string | null,
    valuesInput: FctValueInput[],
    options: { replaceExisting?: boolean; idPrefix?: string } = {},
  ) {
    const idPrefix = options.idPrefix ?? "value";
    // A query-root value is the fixed subject, so the root scope can contain
    // at most one binding. For batch calls, the final value is the requested
    // state; property/property-of scopes may legitimately contain many values.
    const inputValues = parentId === null ? valuesInput.slice(-1) : valuesInput;
    const replaceExisting = parentId === null || options.replaceExisting === true;
    const uniqueValues = new Map<string, FctValueInput>();
    for (const value of inputValues) {
      const normalized = normalizeFctValue(value);
      if (!normalized.text.trim()) continue;
      uniqueValues.set(fctValueKey(value), value);
    }

    updateTree((tree) => {
      const parent = parentId === null ? null : findNodeInTree(tree, parentId);
      if (parentId !== null && !parent) return tree;
      const currentChildren = parent ? parent.children : tree.children;
      const existingValues = currentChildren.filter((node) => node.name === "value");
      const retainedValues = replaceExisting
        ? []
        : existingValues.filter((node) => {
            const key = fctValueKey({
              text: node.text ?? "",
              datatype: node.attributes.datatype,
              lang: node.attributes["xml:lang"],
              op: node.attributes.op,
              attributes: Object.fromEntries(Object.entries(node.attributes).filter(([name]) =>
                !["datatype", "xml:lang", "op"].includes(name))),
            });
            return !uniqueValues.has(key);
          });
      const nextValues = [
        ...retainedValues,
        ...[...uniqueValues.entries()]
          .filter(([key]) => replaceExisting || !existingValues.some((node) =>
            fctValueKey({
              text: node.text ?? "",
              datatype: node.attributes.datatype,
              lang: node.attributes["xml:lang"],
              op: node.attributes.op,
              attributes: Object.fromEntries(Object.entries(node.attributes).filter(([name]) =>
                !["datatype", "xml:lang", "op"].includes(name))),
            }) === key,
          ))
          .map(([key, value]) => addValue(
            (idPrefix === "query-uri-value" ? idPrefix : `${idPrefix}-${encodeURIComponent(key)}`),
            value,
            typeof value === "string" ? "uri" : undefined,
          )),
      ];
      const children = [
        ...currentChildren.filter((node) => node.name !== "value"),
        ...nextValues,
      ];
      if (parent) {
        return {
          ...tree,
          children: replaceNode(tree.children, parent.id, { ...parent, children }),
        };
      }
      return { ...tree, children };
    });
  }

  function replaceQueryNode(nodeId: string, replacement: FctQueryNode) {
    updateTree((tree) => {
      const target = findNodeInTree(tree, nodeId);
      if (!target || target.name === "value" || replacement.name === "value") return tree;
      const clone = (node: FctQueryNode): FctQueryNode => ({
        ...node,
        id: node.id,
        attributes: { ...node.attributes },
        children: node.name === "view" ? [] : node.children.map(clone),
      });
      const stableReplacement = clone({ ...replacement, id: nodeId });
      function replace(nodes: FctQueryNode[]): FctQueryNode[] {
        const target = nodes.find((node) => node.id === nodeId);
        if (target) {
          return nodes.map((node) => node.id === nodeId ? stableReplacement : node);
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
        attributes: { property: RDFS_LABEL_URI },
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

  function getActiveViewScopeParent(tree: FctQueryTree = state.tree): FctQueryNode | null {
    const parent = findParentOfNode(tree.children, "query-view");
    return parent?.parentId ? findNodeInTree(tree, parent.parentId) : null;
  }

  function getPropertiesAtNode(parentId: string | null = null): string[] {
    const parent = parentId ? findNodeInTree(state.tree, parentId) : getActiveViewScopeParent();
    const children = parent ? parent.children : state.tree.children;
    return [...new Set(children.filter((node) =>
      node.name === "property" && node.id.startsWith("property-filter-") && typeof node.attributes.iri === "string",
    ).map((node) => node.attributes.iri))];
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
   * properties wrap the active <view> at its current scope.
   */
  function addProperty(uri: string, kind: "filter" | "path", parentId: string | null = null): void {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    updateTree((tree) => {
      const viewParent = findParentOfNode(tree.children, "query-view");
      const scopeParentId = parentId ?? viewParent?.parentId ?? null;
      const scopeParent = scopeParentId ? findNodeInTree(tree, scopeParentId) : null;
      const scope = scopeParent ? scopeParent.children : tree.children;
      const view = findNodeInTree(tree, "query-view");
      if (!view) return tree;
      if (kind === "filter") {
        if (scope.some((node) => node.name === "property" && node.attributes.iri === normalizedUri)) return tree;
        const filter: FctQueryNode = {
          id: `property-filter-${encodeURIComponent(normalizedUri)}`,
          name: "property",
          attributes: { iri: normalizedUri },
          children: [],
        };
        return updateChildrenAtParent(tree, scopeParentId, (children) => [...children, filter]);
      }
      if (getPropertyPathFromTree(tree).some((item) => item.uri === normalizedUri)) return tree;
      const relationship: FctQueryNode = {
        id: `property-path-${Date.now()}-${encodeURIComponent(normalizedUri)}`,
        name: "property",
        attributes: { iri: normalizedUri },
        children: [{ ...view, children: [] }],
      };
      const withoutView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) =>
        node.id === "query-view" ? [] : [{ ...node, children: withoutView(node.children) }],
      );
      const base = { ...tree, children: withoutView(tree.children) };
      return updateChildrenAtParent(base, scopeParentId, (children) => [
        ...children.filter((node) => !(node.name === "property" && node.attributes.iri === normalizedUri)),
        relationship,
      ]);
    });
  }

  function addPropertyToNode(parentId: string | null, uri: string) {
    addProperty(uri, "filter", parentId);
  }

  /**
   * Resolve a property filter in the active view's scope. At the query root,
   * filters are siblings of <view>; inside a property path, they are children
   * of the path node that contains <view>.
   */
  function findScopedProperty(
    tree: FctQueryTree,
    parentId: string | null,
    uri: string,
  ): FctQueryNode | null {
    const parent = parentId
      ? findNodeInTree(tree, parentId)
      : getActiveViewScopeParent(tree);
    if (parentId && !parent) return null;
    const siblings = parent ? parent.children : tree.children;
    return siblings.find(
      (node) => node.name === "property" && node.attributes.iri === uri,
    ) ?? null;
  }

  function setPropertyValues(parentId: string | null, uri: string, valuesInput: FctValueInput[]) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;
    const property = findScopedProperty(state.tree, parentId, normalizedUri);
    if (!property) return;
    setValue(property.id, valuesInput, {
      replaceExisting: true,
      idPrefix: `property-value-${encodeURIComponent(normalizedUri)}`,
    });
  }

  function setPropertyValue(parentId: string | null, uri: string, value: FctValueInput, checked: boolean) {
    const normalizedUri = uri.trim();
    const normalizedValue = normalizeFctValue(value);
    if (!normalizedUri || !normalizedValue.text.trim()) return;
    const property = findScopedProperty(state.tree, parentId, normalizedUri);
    if (!property) return;

    const values: FctValueInput[] = property.children
      .filter((node) => node.name === "value" && Boolean(node.text))
      .map((node) => ({
        text: node.text ?? "",
        datatype: node.attributes.datatype ?? (node.attributes["xml:lang"] ? undefined : "string"),
        lang: node.attributes["xml:lang"],
        op: node.attributes.op,
        attributes: Object.fromEntries(Object.entries(node.attributes).filter(([name]) =>
          !["datatype", "xml:lang", "op"].includes(name))),
      }));
    const currentKey = fctValueKey(value);
    const existing = values.some((item) => fctValueKey(item) === currentKey);
    const nextValues = checked
      ? existing ? values : [...values, value]
      : values.filter((item) => fctValueKey(item) !== currentKey);
    setValue(property.id, nextValues, {
      replaceExisting: true,
      idPrefix: `property-value-${encodeURIComponent(normalizedUri)}`,
    });
  }

  function removePropertyFromNode(parentId: string | null, uri: string) {
    const normalizedUri = uri.trim();
    if (!normalizedUri) return;

    updateTree((tree) => {
      const parent = parentId ? findNodeInTree(tree, parentId) : getActiveViewScopeParent(tree);
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
    updateTree((tree) => {
      const view = findNodeInTree(tree, "query-view");
      if (!view) return tree;
      if (targetId === "query-root") {
        const removeView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) =>
          node.id === "query-view" ? [] : [{ ...node, children: removeView(node.children) }],
        );
        return { ...tree, children: [...removeView(tree.children), { ...view, children: [] }] };
      }
      let found = false;
      const removeView = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.flatMap((node) =>
        node.id === "query-view" ? [] : [{ ...node, children: removeView(node.children) }],
      );
      const base = { ...tree, children: removeView(tree.children) };
      const insert = (nodes: FctQueryNode[]): FctQueryNode[] => nodes.map((node) => {
        if (node.id === targetId && (node.name === "property" || node.name === "property-of")) {
          found = true;
          return { ...node, children: [...node.children, { ...view, children: [] }] };
        }
        return { ...node, children: insert(node.children) };
      });
      const children = insert(base.children);
      return found ? { ...base, children } : tree;
    });
  }

  /**
   * Move the active <view> to a relationship chosen from the breadcrumb's
   * sibling menu. The target is resolved only within the requested focus node's
   * scope: either a sibling at the same parent level, or a relationship exposed
   *
   * wrapper for navigation. Its children are lifted into the focus node's scope,
   * and the existing view node is attached to the selected relationship. Other
   * query nodes are preserved; all changes go through updateTree/listeners.
   */
  function moveViewToSibling(currentFocusId: string, targetId: string) {
    const focusMatch = findParentOfNode(state.tree.children, currentFocusId);
    const targetMatch = findParentOfNode(state.tree.children, targetId);
    if (!focusMatch || !targetMatch || focusMatch.parentId !== targetMatch.parentId) return;
    navigateToPropertyPath(targetId);
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

    function findViewParent(nodes: FctQueryNode[]): { parentId: string | null; children: FctQueryNode[] } | null {
      for (const node of nodes) {
        if (node.children.some((child) => child.id === "query-view")) return { parentId: node.id, children: node.children };
        const nested = findViewParent(node.children);
        if (nested) return nested;
      }
      if (nodes.some((node) => node.id === "query-view")) return { parentId: null, children: nodes };
      return null;
    }
    const tree = state.tree;
    const scope = findViewParent(tree.children);
    if (!scope) return;
    const target = scope.children.find((node) =>
      node.name === "property-of" && node.id.startsWith("role-filter-") &&
      node.attributes.iri === normalizedUri,
    );
    const findAncestorRole = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        const containsView = (candidate: FctQueryNode): boolean =>
          candidate.id === "query-view" || candidate.children.some(containsView);
        if (node.name === "property-of" && node.attributes.iri === normalizedUri && containsView(node)) return node;
        const nested = findAncestorRole(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const targetId = target?.id ?? findAncestorRole(tree.children)?.id;
    if (!targetId) return;
    const targetNode = findNodeInTree(tree, targetId);
    if (!targetNode) return;

    const values: FctValueInput[] = targetNode.children
      .filter((node) => node.name === "value" && Boolean(node.text))
      .map((node) => ({
        text: node.text ?? "",
        datatype: node.attributes.datatype,
        lang: node.attributes["xml:lang"],
        op: node.attributes.op,
        attributes: Object.fromEntries(Object.entries(node.attributes).filter(([name]) =>
          !["datatype", "xml:lang", "op"].includes(name))),
      }));
    const wantedKey = fctValueKey(value);
    const existing = values.some((item) => fctValueKey(item) === wantedKey);
    const nextValues = checked
      ? existing ? values : [...values, value]
      : values.filter((item) => fctValueKey(item) !== wantedKey);
    setValue(targetId, nextValues, {
      replaceExisting: true,
      idPrefix: `role-value-${encodeURIComponent(normalizedUri)}`,
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
    replaceTree,

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
    setValue,
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

/**
 * Tree-oriented facade over the same query manipulation engine used by the live
 * store. Each operation receives a tree and returns a new tree; the supplied
 * tree is cloned into an isolated store, so these operations never mutate the
 * live source of truth. Omitting the tree starts from the current live query.
 * An explicitly supplied empty query is valid and remains empty until edited.
 */
export const fctQueryTreeApi = {
  getTree(tree?: FctQueryTree): FctQueryTree {
    if (tree !== undefined) {
      if (!isValidQueryTree(tree)) throw new TypeError("Invalid FCT query tree");
      return cloneQueryTree(tree);
    }
    return cloneQueryTree(fctQueryStore.getSnapshot().tree);
  },

  setSearchText(tree: FctQueryTree | undefined, text: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setSearchText(text));
  },
  resetQuery(tree?: FctQueryTree): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.resetQuery());
  },
  setView(tree: FctQueryTree | undefined, type: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setView(type));
  },
  setQueryAttribute(tree: FctQueryTree | undefined, name: string, value: string | null): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setQueryAttribute(name, value));
  },
  setNodeAttribute(tree: FctQueryTree | undefined, nodeId: string, name: string, value: string | null): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setNodeAttribute(nodeId, name, value));
  },
  setNodeText(tree: FctQueryTree | undefined, nodeId: string, text: string | undefined): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setNodeText(nodeId, text));
  },
  setValue(tree: FctQueryTree | undefined, parentId: string | null, values: FctValueInput[], options?: { replaceExisting?: boolean; idPrefix?: string }): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setValue(parentId, values, options));
  },
  insertNode(tree: FctQueryTree | undefined, parentId: string | null, node: FctQueryNode, index?: number): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.insertNode(parentId, node, index));
  },
  replaceNode(tree: FctQueryTree | undefined, nodeId: string, replacement: FctQueryNode): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.replaceQueryNode(nodeId, replacement));
  },
  removeNode(tree: FctQueryTree | undefined, nodeId: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.removeQueryNode(nodeId));
  },
  addProperty(tree: FctQueryTree | undefined, uri: string, parentId: string | null = null): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.addProperty(parentId, uri));
  },
  removeProperty(tree: FctQueryTree | undefined, uri: string, parentId: string | null = null): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.removeProperty(parentId, uri));
  },
  setPropertyValues(tree: FctQueryTree | undefined, parentId: string | null, uri: string, values: FctValueInput[]): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setPropertyValues(parentId, uri, values));
  },
  setPropertyValue(tree: FctQueryTree | undefined, parentId: string | null, uri: string, value: FctValueInput, checked: boolean): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setPropertyValue(parentId, uri, value, checked));
  },
  setRoleValue(tree: FctQueryTree | undefined, uri: string, value: FctValueInput, checked: boolean): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setRoleValue(uri, value, checked));
  },
  addNestedProperty(tree: FctQueryTree | undefined, uri: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.addNestedProperty(uri));
  },
  addNestedPropertyOf(tree: FctQueryTree | undefined, uri: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.addNestedPropertyOf(uri));
  },
  addClass(tree: FctQueryTree | undefined, parentId: string | null, uri: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.addClass(parentId, uri));
  },
  removeClass(tree: FctQueryTree | undefined, parentId: string | null, uri: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.removeClass(parentId, uri));
  },
  setRoleFilter(tree: FctQueryTree | undefined, uri: string, checked: boolean): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setRoleFilter(uri, checked));
  },
  setResultsPage(tree: FctQueryTree | undefined, limit: number, offset: number): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.setResultsPage(limit, offset));
  },
  showClassResults(tree: FctQueryTree | undefined, uri: string, parentId: string | null = null): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.showClassResults(uri, parentId));
  },
  deleteNode(tree: FctQueryTree | undefined, nodeId: string): FctQueryTree {
    return applyTreeOperation(tree, (store) => store.deleteNode(nodeId));
  },
};

function applyTreeOperation(
  sourceTree: FctQueryTree | undefined,
  operation: (store: ReturnType<typeof createQueryStore>) => void,
): FctQueryTree {
  if (sourceTree !== undefined && !isValidQueryTree(sourceTree)) {
    throw new TypeError("Invalid FCT query tree");
  }
  // No tree argument means this is an ordinary live-query operation: mutate
  // the authoritative store and return its updated snapshot. A supplied tree,
  // including an intentionally empty one, is handled in an isolated store.
  if (sourceTree === undefined) {
    operation(fctQueryStore);
    return cloneQueryTree(fctQueryStore.getSnapshot().tree);
  }
  const isolatedStore = createQueryStore(sourceTree);
  operation(isolatedStore);
  return cloneQueryTree(isolatedStore.getSnapshot().tree);
}

export function useFctQuery() {
  const state = useSyncExternalStore(
    fctQueryStore.subscribe,
    fctQueryStore.getSnapshot,
    fctQueryStore.getSnapshot,
  );

  return {
    ...state,
    replaceTree: fctQueryStore.replaceTree,
    setSearchText: fctQueryStore.setSearchText,
    resetQuery: fctQueryStore.resetQuery,
    setView: fctQueryStore.setView,
    setQueryAttribute: fctQueryStore.setQueryAttribute,
    setNodeAttribute: fctQueryStore.setNodeAttribute,
    setNodeText: fctQueryStore.setNodeText,
    insertNode: fctQueryStore.insertNode,
    setValue: fctQueryStore.setValue,
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