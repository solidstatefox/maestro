"use client";

import { useEffect, useRef, useState } from "react";
import { rememberShortforms, toLabel } from "@/lib/uri-labels";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { Label } from "@/components/ui/label";
import { Code2, Network, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import xmlFormat from "xml-formatter";
import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";
import { useFctQuery, serializeFctQuery, attachViewToPropertyInQueryTree } from "@/lib/fct-query-api";
import type { FctQueryNode, FctQueryTree } from "@/lib/fct-query-api";

hljs.registerLanguage("xml", xmlLanguage);
// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.
hljs.registerLanguage("sparql", sqlLanguage);

/*
const sampleResults = [
  { uri: "https://example.org/alice", title: "Alice Smith" },
  { uri: "https://example.org/bob", title: "Bob Jones" },
  { uri: "https://example.org/carol", title: "Carol White" },
  { uri: "https://example.org/company", title: "Example Organization" },
];

const sampleRecords: Record<string, { property: string; value: string }[]> = {
  "https://example.org/alice": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Alice Smith" },
    { property: "foaf:mbox", value: "alice@example.org" },
  ],
  "https://example.org/bob": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Bob Jones" },
  ],
  "https://example.org/carol": [
    { property: "rdf:type", value: "Person" },
    { property: "foaf:name", value: "Carol White" },
  ],
  "https://example.org/company": [
    { property: "rdf:type", value: "Organization" },
    { property: "foaf:name", value: "Example Organization" },
  ],
};
*/

const facets = {
  Properties: [],
  Classes: [],
  Roles: [],
  Graphs: [],
};

const DEFAULT_RESULTS_PAGE_SIZE = 30;
const RESULTS_PAGE_SIZE_STORAGE_KEY = "maestro-results-page-size";
const RESULTS_PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;
const RESULTS_BATCH_SIZE_OPTIONS = [30, 100, 250, 500, 1000] as const;

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function readFctTotalCount(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const response = data as Record<string, unknown>;
  const candidates: unknown[] = [response.totalCount, response.total_count, response.count, response.processed];
  if (Array.isArray(response.results) && response.results.length > 0) {
    const first = response.results[0];
    if (first && typeof first === "object") {
      const row = first as Record<string, unknown>;
      candidates.push(row.count, row.total, row.totalCount, row.value, row.title, row.uri);
    }
  }
  for (const candidate of candidates) {
    const parsed = typeof candidate === "number" ? candidate
      : typeof candidate === "string" && candidate.trim() !== "" ? Number(candidate) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

type FacetItem = {
  uri: string;
  label: string;
  count: number;
};

type FacetName = string;

type EnrichedTerm = {
  value: string;
  type?: string;
  datatype?: string;
  lang?: string;
};

type ScopeValue = {
  property: string;
  label: string;
  direction: RelationshipDirection;
  values: EnrichedTerm[];
};

type FctResponseColumn = {
  value: string;
  name?: string;
  shortform?: string;
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
  attributes: Record<string, string>;
  raw: Record<string, unknown>;
};

type FctMatch = {
  excerpt: string;
  columns?: FctResponseColumn[];
  graph?: string;
  score?: FctResponseColumn;
  rank?: FctResponseColumn;
};

type FctResult = {
  uri: string;
  title: string;
  label?: string;
  shortform?: string;
  graph?: string;
  score?: FctResponseColumn;
  rank?: FctResponseColumn;
  columns?: FctResponseColumn[];
  matches: FctMatch[];
  scopeValues?: ScopeValue[];
  termType?: "uri" | "literal" | "bnode";
  datatype?: string;
  lang?: string;
};

function groupValueKey(value: FctResult): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

function fctTermKey(text: string, datatype?: string, lang?: string): string {
  return JSON.stringify([text, datatype ?? "uri", lang ?? ""]);
}

function facetValueKey(value: FctResult): string {
  const binding = groupValueBinding(value);
  return fctTermKey(binding.text, binding.datatype, binding.lang);
}

function groupValueBinding(value: FctResult): { text: string; datatype?: string; lang?: string } {
  const isUri = value.termType === "uri";
  return {
    text: value.uri,
    // FCT uses datatype="uri" for resources. Literal values should carry
    // their actual RDF datatype; plain strings use the documented "string"
    // shorthand, while language-tagged values are identified by xml:lang.
    ...(isUri ? { datatype: "uri" } : value.datatype
      ? { datatype: value.datatype }
      : value.lang ? {} : { datatype: "http://www.openlinksw.com/schemas/facets/dtp/plainstring" }),
    ...(value.lang ? { lang: value.lang } : {}),
  };
}

type PersonalWidget = {
  uri: string;
  label: string;
  values: FctResult[];
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};

type RelationshipDirection = "forward" | "reverse";
type ScopeRelationship = { uri: string; direction: RelationshipDirection };
type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean };
type GroupMembersState = { results: FctResult[]; loading: boolean; error: string };

function treeNodeContainsId(nodes: FctQueryNode[], ancestorId: string, targetId: string): boolean {
  const contains = (node: FctQueryNode): boolean => node.id === targetId || node.children.some(contains);
  const find = (node: FctQueryNode): boolean => node.id === ancestorId
    ? contains(node)
    : node.children.some(find);
  return nodes.some(find);
}

function createPropertyWidgetQuery(
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
function createGroupMemberQuery(
  sourceTree: FctQueryTree,
  option: GroupByOption,
  groupValue: FctResult,
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

const COUNT_QUERY_LIMIT = 1000;
type DistinctCountKind = "property" | "class" | "role" | "value";

function cloneQueryNode(node: FctQueryNode): FctQueryNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.children.map(cloneQueryNode),
  };
}

function collectPropertyIris(tree: FctQueryTree): string[] {
  const iris = new Set<string>();
  function visit(nodes: FctQueryNode[]) {
    for (const node of nodes) {
      if (node.name === "property" && typeof node.attributes.iri === "string") {
        iris.add(node.attributes.iri);
      }
      visit(node.children);
    }
  }
  visit(tree.children);
  return [...iris];
}

function queryContainsIri(
  tree: FctQueryTree,
  name: string,
  iri: string,
): boolean {
  const visit = (nodes: FctQueryNode[]): boolean =>
    nodes.some(
      (node) =>
        (node.name === name && node.attributes.iri === iri) ||
        visit(node.children),
    );
  return visit(tree.children);
}

/** Build an isolated list-count query for one visible facet/value item. */
function createDistinctCountQuery(
  sourceTree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: FctResult,
  viewType: "list-count" | "text" = "list-count",
): FctQueryTree {
  let tree: FctQueryTree = {
    ...sourceTree,
    attributes: { ...sourceTree.attributes },
    children: sourceTree.children.map(cloneQueryNode),
  };

  // Virtuoso's FCT documentation states that when the entire <text> element is
  // absent, it does not add a bif:contains pattern. Apply this to every isolated
  // item-count query (Properties, Roles, Categories/classes, and bespoke widget
  // values): an empty <text/> can make FCT emit the placeholder
  // bif:contains '(NULL)' expression. Preserve non-empty text so real full-text
  // searches remain scoped for all count types.
  const hasSearchText = tree.children.some(
    (node) => node.name === "text" && Boolean(node.text?.trim()),
  );
  if (!hasSearchText) {
    tree = {
      ...tree,
      children: tree.children.filter((node) => node.name !== "text"),
    };
  }

  if (kind === "property") {
    const wrapView = (nodes: FctQueryNode[]): FctQueryNode[] =>
      nodes.flatMap((node) => {
        if (node.id === "query-view") {
          return [
            {
              id: `count-property-${encodeURIComponent(uri)}`,
              name: "property",
              attributes: { iri: uri },
              children: [node],
            },
          ];
        }
        return [{ ...node, children: wrapView(node.children) }];
      });
    tree = { ...tree, children: wrapView(tree.children) };
  } else if (kind === "role") {
    const wrapView = (nodes: FctQueryNode[]): FctQueryNode[] =>
      nodes.flatMap((node) => {
        if (node.id === "query-view") {
          return [
            {
              id: `count-role-${encodeURIComponent(uri)}`,
              name: "property-of",
              attributes: { iri: uri },
              children: [node],
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

/** Hover-only query inspector for any widget backed by an FCT or SPARQL request. */
function QueryInspectorButton({
  query,
  language = "xml",
  filename,
  label = "View query",
  countQuery,
  countFilename,
}: {
  query: string;
  language?: "xml" | "sparql";
  filename: string;
  label?: string;
  countQuery?: string;
  countFilename?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"widget" | "count">("widget");
  const [countSparql, setCountSparql] = useState("");
  const [countSparqlLoading, setCountSparqlLoading] = useState(false);
  const [countSparqlError, setCountSparqlError] = useState("");

  useEffect(() => {
    if (!open || activeTab !== "count" || !countQuery?.trim()) return;
    const controller = new AbortController();
    let cancelled = false;
    setCountSparql("");
    setCountSparqlError("");
    setCountSparqlLoading(true);

    async function loadCountSparql() {
      try {
        const fctResponse = await fetch("/api/fct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryXml: countQuery, countOnly: true }),
          signal: controller.signal,
        });
        const fctData = await fctResponse.json();
        if (!fctResponse.ok) throw new Error(fctData.error ?? "Could not generate the count query.");
        if (typeof fctData.sparql !== "string" || !fctData.sparql.trim()) {
          throw new Error("FCT did not return SPARQL for this count query.");
        }
        const sparqlResponse = await fetch("/api/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facetValueCount: { sparql: fctData.sparql } }),
          signal: controller.signal,
        });
        const sparqlData = await sparqlResponse.json();
        if (!sparqlResponse.ok) throw new Error(sparqlData.error ?? "Could not generate the scalar count SPARQL.");
        if (typeof sparqlData.query !== "string" || !sparqlData.query.trim()) {
          throw new Error("The count endpoint did not return its generated SPARQL query.");
        }
        if (!cancelled) setCountSparql(sparqlData.query);
      } catch (requestError) {
        if (cancelled || (requestError instanceof Error && requestError.name === "AbortError")) return;
        if (!cancelled) setCountSparqlError(requestError instanceof Error ? requestError.message : "Could not load count SPARQL.");
      } finally {
        if (!cancelled) setCountSparqlLoading(false);
      }
    }

    void loadCountSparql();
    return () => { cancelled = true; controller.abort(); };
  }, [open, activeTab, countQuery]);

  if (!query.trim()) return null;
  const showingCount = Boolean(countQuery?.trim()) && activeTab === "count";
  const displayedCode = showingCount ? (countSparql || countQuery!) : query;
  const displayedFilename = showingCount ? (countFilename ?? "first-item-count.sparql").replace(/\.xml$/i, ".sparql") : filename;
  const displayedLanguage = showingCount ? "sparql" : language;
  return (
    <>
      <button
        type="button"
        onClick={() => { setActiveTab("widget"); setOpen(true); }}
        aria-label={`${label}: ${filename}`}
        title={label}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100"
      >
        <Code2 className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label={`${label}: ${filename}`} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border bg-background p-3 shadow-xl">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Query inspector</h2>
                <p className="text-xs text-muted-foreground">Inspect the request used to populate this widget.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent" aria-label="Close query viewer"><X className="size-4" /></button>
            </header>
            {countQuery?.trim() && (
              <div role="tablist" aria-label="Widget queries" className="mb-3 flex gap-1 border-b">
                <button type="button" role="tab" aria-selected={activeTab === "widget"} onClick={() => setActiveTab("widget")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "widget" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>FCT result list</button>
                <button type="button" role="tab" aria-selected={activeTab === "count"} onClick={() => setActiveTab("count")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "count" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>Count source query</button>
              </div>
            )}
            <p className="mb-2 text-xs text-muted-foreground">{displayedFilename} · {displayedLanguage.toUpperCase()}</p>
            {showingCount && countSparqlLoading ? (
              <p className="mb-2 text-xs text-muted-foreground" role="status">Generating count SPARQL…</p>
            ) : showingCount && countSparqlError ? (
              <p className="mb-2 text-xs text-destructive" role="alert">{countSparqlError}</p>
            ) : null}
            <CodeBlock className="min-h-0 flex-1" code={displayedCode} language={displayedLanguage} filename={displayedFilename} />
          </section>
        </div>
      )}
    </>
  );
}

/** Each visible item requests its own distinct-row count through the same-origin FCT proxy. */
function DistinctCount({
  tree,
  kind,
  uri,
  propertyUri,
  candidateValue,
}: {
  tree: FctQueryTree;
  kind: DistinctCountKind;
  uri: string;
  propertyUri?: string;
  candidateValue?: FctResult;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const sourceXml = serializeFctQuery(tree);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setCount(null);
    setError("");

    async function loadCount() {
      try {
        // Ask FCT for the scope-correct source query, then have /api/sparql
        // execute a scalar aggregate. The SPARQL projection is only ?ct; the
        // endpoint must not return the matching resources to the browser.
        const countTree = createDistinctCountQuery(
          tree,
          kind,
          uri,
          propertyUri,
          candidateValue,
          "text",
        );
        const pagedTree = updateViewNode(countTree, (node) => ({
          ...node,
          attributes: { ...node.attributes, limit: String(COUNT_QUERY_LIMIT), offset: "0" },
        }));
        const response = await fetch("/api/fct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryXml: serializeFctQuery(pagedTree),
            countOnly: true,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Failed to load distinct count.");

        if (typeof data.sparql !== "string" || !data.sparql.trim()) {
          throw new Error("FCT did not return the SPARQL for this item count.");
        }
        const sparqlResponse = await fetch("/api/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facetValueCount: { sparql: data.sparql } }),
          signal: controller.signal,
        });
        const sparqlData = await sparqlResponse.json();
        if (!sparqlResponse.ok) {
          throw new Error(sparqlData.error ?? "Failed to execute the item count against SPARQL.");
        }
        const parsedCount = Number(sparqlData.count);
        if (!Number.isFinite(parsedCount) || parsedCount < 0) {
          throw new Error("The SPARQL endpoint returned an invalid item count.");
        }
        if (!cancelled) setCount(parsedCount);
      } catch (requestError) {
        if (
          cancelled ||
          (requestError instanceof Error && requestError.name === "AbortError")
        )
          return;
        setError(requestError instanceof Error ? requestError.message : "Could not load distinct count.");
      }
    }

    void loadCount();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // sourceXml is the serialized identity of the current query tree.
  }, [sourceXml, tree, kind, uri, propertyUri, candidateValue?.termType, candidateValue?.datatype, candidateValue?.lang, candidateValue?.uri]);

  return (
    <span
      className={`shrink-0 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
      title={
        error
          ? `Could not load distinct count: ${error}`
          : kind === "property"
            ? "Distinct property values"
            : kind === "role"
              ? "Distinct role values"
              : "Distinct results"
      }
    >
      {error
        ? "!"
        : count === null
          ? "…"
          : count.toLocaleString()}
    </span>
  );
}

/** Return only filter nodes owned by the active view's <properties> group.
 * Relationship/path nodes are structural scope, not filters. Filters are never
 * deduplicated by IRI: the tree mutation API must keep each filter in its one
 * authoritative scope, and consumers must not guess which same-IRI node wins.
 */
function getActiveViewPropertyFilters(tree: FctQueryTree): FctQueryNode[] {
  const view = findQueryNode(tree.children, "query-view");
  const properties = view?.children.find(
    (node) => node.name === "properties" || node.id === "query-view-properties",
  );
  return (properties?.children ?? []).filter(
    (node) =>
      node.name === "property" &&
      node.id.startsWith("property-filter-") &&
      typeof node.attributes.iri === "string",
  );
}

/** Return reverse-property filters attached to the active view's scope only.
 * Ancestor <property-of> nodes are navigation breadcrumbs, not filters for the
 * current result set; leaf role-filter nodes are the scope-local selections.
 */
function getActiveViewRoleFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewScope(nodes: FctQueryNode[]): FctQueryNode[] | null {
    for (const node of nodes) {
      if (node.children.some((child) => child.id === "query-view")) {
        return node.children;
      }
      const nested = findViewScope(node.children);
      if (nested) return nested;
    }
    // The active view can be at the root.
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    return null;
  }
  return (findViewScope(tree.children) ?? []).filter(
    (node) => node.name === "property-of" && node.id.startsWith("role-filter-") &&
      typeof node.attributes.iri === "string",
  );
}

function treeHasPropertyFilter(
  tree: FctQueryTree,
  propertyUri: string,
): boolean {
  return getActiveViewPropertyFilters(tree).some(
    (node) => node.attributes.iri === propertyUri,
  );
}

/** Each widget owns a real subscription to the authoritative query store. */
function PersonalWidgetQueryListener({
  propertyUri,
  setPersonalWidgets,
}: {
  propertyUri: string;
  setPersonalWidgets: Dispatch<SetStateAction<PersonalWidget[]>>;
}) {
  const { tree } = useFctQuery();
  const queryXml = serializeFctQuery(tree);

  useEffect(() => {
    // Reconcile every mounted widget against the active <view> scope. A widget
    // whose filter belongs to another breadcrumb scope must not retain stale
    // values while the parent pane catches up with the new query revision.
    if (!treeHasPropertyFilter(tree, propertyUri)) {
      setPersonalWidgets((current) =>
        current.filter((widget) => widget.uri !== propertyUri),
      );
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPersonalWidgets((current) =>
      current.map((widget) =>
        widget.uri === propertyUri
          ? { ...widget, loading: true, error: "" }
          : widget,
      ),
    );

    async function refreshWidget() {
      try {
        const ephemeralTree = createPropertyWidgetQuery(tree, propertyUri);
        const response = await fetch("/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryXml: serializeFctQuery(ephemeralTree),
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${propertyUri}.`);
        const fetchedValues: FctResult[] = Array.isArray(data.results)
          ? data.results
          : [];
        // Once this property has an active value binding, show only the selected
        // value(s) in its own widget. Other facets continue to be recomputed from
        // the filtered query, while this widget reflects its current selection.
        const activeFilter = getActiveViewPropertyFilters(tree).find(
          (node) => node.attributes.iri === propertyUri,
        );
        const selectedTerms = (activeFilter?.children ?? [])
          .filter((child) => child.name === "value")
          .map((child) => fctTermKey(
            child.text ?? "",
            child.attributes.datatype,
            child.attributes["xml:lang"],
          ));
        const values = selectedTerms.length
          ? fetchedValues.filter((value) => selectedTerms.includes(facetValueKey(value)))
          : fetchedValues;
        if (cancelled) return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  values,
                  loading: false,
                  error: "",
                  page: Math.min(
                    widget.page,
                    Math.max(0, Math.ceil(values.length / 10) - 1),
                  ),
                }
              : widget,
          ),
        );
      } catch (error) {
        if (
          cancelled ||
          (error instanceof Error && error.name === "AbortError")
        )
          return;
        setPersonalWidgets((current) =>
          current.map((widget) =>
            widget.uri === propertyUri
              ? {
                  ...widget,
                  loading: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to load property values.",
                }
              : widget,
          ),
        );
      }
    }

    void refreshWidget();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tree, queryXml, propertyUri, setPersonalWidgets]);

  return null;
}

function findQueryNode(
  nodes: FctQueryNode[],
  nodeId: string,
): FctQueryNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const found = findQueryNode(node.children, nodeId);
    if (found) return found;
  }
  return undefined;
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

function updateViewNode(
  tree: FctQueryTree,
  update: (node: FctQueryNode) => FctQueryNode,
): FctQueryTree {
  return {
    ...tree,
    children: updateQueryNode(tree.children, "query-view", update),
  };
}

type EndpointStatus = {
  id: string;
  status: number | null;
  state: "ok" | "server-error" | "http-error" | "timeout" | "unreachable";
  testedUrl?: string;
  attempts?: Array<{ url: string; status: number | null; state: string }>;
};
type EndpointOption = { id: string; label: string; url: string; group: string };

type FacetAddCounts = {
  property: Record<string, number>;
  "property-in": Record<string, number>;
};

type FacetAutofillCandidates = {
  property: string[];
  "property-in": string[];
};

const FACET_ADD_COUNTS_STORAGE_KEY = "maestro:facet-add-counts:v1";
const FACET_AUTOFILL_STORAGE_KEY = "maestro:facet-autofill:v1";

function readFacetAddCounts(): FacetAddCounts {
  const empty: FacetAddCounts = { property: {}, "property-in": {} };
  try {
    const raw = window.localStorage.getItem(FACET_ADD_COUNTS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAddCounts>;
    return {
      property: parsed.property && typeof parsed.property === "object" ? parsed.property : {},
      "property-in": parsed["property-in"] && typeof parsed["property-in"] === "object" ? parsed["property-in"] : {},
    };
  } catch {
    return empty;
  }
}

function recordFacetAddition(kind: "property" | "property-in", uri: string) {
  try {
    const counts = readFacetAddCounts();
    counts[kind][uri] = (counts[kind][uri] ?? 0) + 1;
    window.localStorage.setItem(FACET_ADD_COUNTS_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
  }
}

function readFacetAutofillCandidates(): FacetAutofillCandidates {
  const empty: FacetAutofillCandidates = { property: [], "property-in": [] };
  try {
    const raw = window.localStorage.getItem(FACET_AUTOFILL_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetAutofillCandidates>;
    return {
      property: Array.isArray(parsed.property) ? parsed.property.filter((uri): uri is string => typeof uri === "string") : [],
      "property-in": Array.isArray(parsed["property-in"]) ? parsed["property-in"].filter((uri): uri is string => typeof uri === "string") : [],
    };
  } catch {
    return empty;
  }
}

function replaceFacetAutofillCandidates(kind: "property" | "property-in", uris: string[]) {
  try {
    const candidates = readFacetAutofillCandidates();
    // Recompute this facet kind from the latest widget load; do not retain
    // candidates that no longer appear in the current facet results.
    candidates[kind] = Array.from(new Set(uris));
    window.localStorage.setItem(FACET_AUTOFILL_STORAGE_KEY, JSON.stringify(candidates));
    return candidates[kind];
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
    return Array.from(new Set(uris));
  }
}

export default function Home() {
  const [selectedUri, setSelectedUri] = useState("");
  const [fctEndpoints, setFctEndpoints] = useState<EndpointOption[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const [endpointStatuses, setEndpointStatuses] = useState<
    Record<string, EndpointStatus>
  >({});
  const [isCheckingEndpoints, setIsCheckingEndpoints] = useState(false);
  const [endpointChecksCompleted, setEndpointChecksCompleted] = useState(0);
  const [endpointChecksTotal, setEndpointChecksTotal] = useState(0);
  const [endpointMenuError, setEndpointMenuError] = useState("");
  const [selectedFacet, setSelectedFacet] = useState<FacetName>("Properties");
  const [propertiesPage, setPropertiesPage] = useState(0);
  const [classesPage, setClassesPage] = useState(0);
  const [graphsPage, setGraphsPage] = useState(0);
  const [graphText, setGraphText] = useState("");
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  const [centralTab, setCentralTab] = useState<"results" | "groups" | "query-tree" | "view-query">("results");
  const [querySourceFormat, setQuerySourceFormat] = useState<"xml" | "sparql">("xml");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [isRdfLoaderOpen, setIsRdfLoaderOpen] = useState(false);
  const [rdfSourceUrl, setRdfSourceUrl] = useState("");
  const [rdfTargetGraph, setRdfTargetGraph] = useState(
    "http://example.org/graph/imported",
  );
  const [isRdfLoading, setIsRdfLoading] = useState(false);
  const [rdfLoadMessage, setRdfLoadMessage] = useState("");
  const [rdfLoadError, setRdfLoadError] = useState(false);
  /*
  const [activeTab, setActiveTab] = useState<
    "default" | "personal" | "community"
  >("default");
*/
  // Inner tabs for the left pane in Default view.
const [defaultLeftTab, setDefaultLeftTab] = useState<"facets" | "personal" | "community">("personal");
  const [focusListOrder, setFocusListOrder] = useState<"Properties" | "Roles">("Properties");


  const [personalWidgets, setPersonalWidgets] = useState<PersonalWidget[]>([]);
  const [groupByPropertyUri, setGroupByPropertyUri] = useState("");
  const [resultsUiPage, setResultsUiPage] = useState(0);
  const [groupUiPage, setGroupUiPage] = useState(0);
  const [groupBatchSize, setGroupBatchSize] = useState<number>(100);
  const [groupBatchOffset, setGroupBatchOffset] = useState(0);
  const [groupHasMoreBatches, setGroupHasMoreBatches] = useState(false);
  const FACET_PAGE_SIZE = 10;
  const [propertyFacets, setPropertyFacets] = useState<FacetItem[]>([]);
  const [classFacets, setClassFacets] = useState<FacetItem[]>([]);
  const [roleFacets, setRoleFacets] = useState<FacetItem[]>([]);
  const [graphFacets, setGraphFacets] = useState<FacetItem[]>([]);
  const [propertyFacetSparql, setPropertyFacetSparql] = useState("");
  const [roleFacetSparql, setRoleFacetSparql] = useState("");
  const [facetAutofillCandidates, setFacetAutofillCandidates] = useState<FacetAutofillCandidates>({ property: [], "property-in": [] });
  // localStorage mutations do not trigger React renders. This revision makes
  // facet additions observable to the Auto-configure candidate effects.
  const [facetUsageRevision, setFacetUsageRevision] = useState(0);
  const [autoResetMessage, setAutoResetMessage] = useState("");
  const [rolesPage, setRolesPage] = useState(0);

  // Facet results can shrink after a query or endpoint change. Never leave a
  // facet widget on a page index that no longer exists (which looks like an
  // empty list even though the header still reports a nonzero count).
  useEffect(() => {
    setPropertiesPage(0);
  }, [propertyFacets.length]);
  useEffect(() => {
    setClassesPage(0);
  }, [classFacets.length]);
  useEffect(() => {
    setRolesPage(0);
  }, [roleFacets.length]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [roleFacetError, setRoleFacetError] = useState("");

  const {
    tree: queryTree,
    getPropertiesAtNode,
    getClassesAtNode,
    getPropertyPath,
    addProperty,
    removeProperty,
    setPropertyValues,
    setPropertyValue,
    setRoleValue,
    addNestedProperty,
    addNestedPropertyOf,
    navigateToPropertyPath,
    moveViewToSibling,
    addClass,
    removeClass,
    setSearchText: setSearch,
    resetQuery,
    setQueryAttribute,
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh: refreshQuery,
    deleteNode,
  } = useFctQuery();

  useEffect(() => {
    setGraphsPage(0);
  }, [graphFacets.length, queryTree.attributes.graph]);

  const search =
    queryTree.children.find(
      (node) => node.name === "text" && node.id === "query-text",
    )?.text ?? "";

  useEffect(() => {
    let cancelled = false;
    async function loadEndpointMenu() {
      setIsCheckingEndpoints(true);
      setEndpointChecksCompleted(0);
      try {
        // Load every configured endpoint first, so the menu appears before health checks finish.
        const response = await fetch("/api/fct", { cache: "no-store" });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? "Could not load FCT endpoints.");
        if (cancelled) return;
        const endpoints = Array.isArray(data.endpoints)
          ? (data.endpoints as EndpointOption[])
          : [];
        const savedSelection =
          typeof data.selectedId === "string" ? data.selectedId : "";
        setFctEndpoints(endpoints);
        setSelectedEndpointId(savedSelection);
        setEndpointStatuses({});
        setEndpointChecksTotal(endpoints.length);
        setEndpointMenuError("");
        await runEndpointChecks(
          endpoints,
          !savedSelection,
          savedSelection,
          () => cancelled,
        );
      } catch (error) {
        if (!cancelled)
          setEndpointMenuError(
            error instanceof Error
              ? error.message
              : "Could not load FCT endpoints.",
          );
      } finally {
        if (!cancelled) setIsCheckingEndpoints(false);
      }
    }
    void loadEndpointMenu();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runEndpointChecks(
    endpoints: EndpointOption[],
    autoSelectFirstReachable: boolean,
    existingSelection: string,
    isCancelled: () => boolean = () => false,
  ) {
    setIsCheckingEndpoints(true);
    setEndpointChecksCompleted(0);
    setEndpointChecksTotal(endpoints.length);
    const results: Record<string, EndpointStatus> = {};
    let completed = 0;

    // Each endpoint reports independently; the menu updates as each AJAX request returns.
    await Promise.all(
      endpoints.map(async (endpoint) => {
        let status: EndpointStatus;
        try {
          const response = await fetch(
            `/api/fct?health=1&endpointId=${encodeURIComponent(endpoint.id)}`,
            { cache: "no-store" },
          );
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok || !data.check)
            throw new Error(data.error ?? "Health check failed.");
          status = data.check as EndpointStatus;
        } catch {
          status = {
            id: endpoint.id,
            status: null,
            state: "unreachable",
            testedUrl: endpoint.url,
          };
        }
        results[endpoint.id] = status;
        completed += 1;
        if (!isCancelled()) {
          setEndpointStatuses((current) => ({
            ...current,
            [endpoint.id]: status,
          }));
          setEndpointChecksCompleted(completed);
        }
      }),
    );

    if (isCancelled()) return;

    // Keep an existing session choice. On a fresh session, choose the first reachable
    // endpoint in configured order, not whichever health request happens to finish first.
    if (autoSelectFirstReachable && !existingSelection) {
      const firstReachable = endpoints.find(
        (endpoint) =>
          results[endpoint.id]?.status != null &&
          results[endpoint.id].status! < 400,
      );
      if (firstReachable) {
        try {
          const response = await fetch("/api/fct", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selectEndpointId: firstReachable.id,
            }),
          });
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok)
            throw new Error(
              data.error ?? "Could not select the first reachable FCT endpoint.",
            );
          if (!isCancelled()) {
            setSelectedEndpointId(firstReachable.id);
            refreshQuery();
          }
        } catch (error) {
          if (!isCancelled())
            setEndpointMenuError(
              error instanceof Error
                ? error.message
                : "Could not select the first reachable FCT endpoint.",
            );
        }
      }
    }
  }

  async function checkFctEndpoints() {
    setEndpointMenuError("");
    await runEndpointChecks(fctEndpoints, false, selectedEndpointId);
    setIsCheckingEndpoints(false);
  }

  async function chooseFctEndpoint(endpointId: string) {
    if (!endpointId || endpointId === selectedEndpointId) return;
    setEndpointMenuError("");
    try {
      const response = await fetch("/api/fct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectEndpointId: endpointId }),
      });
      const data = await response.json();
        rememberShortforms(data?.shortforms);
      if (!response.ok)
        throw new Error(data.error ?? "Could not select FCT endpoint.");
      setSelectedEndpointId(endpointId);
      // Trigger the existing query and facet effects to reload against the newly selected server.
      refreshQuery();
    } catch (error) {
      setEndpointMenuError(
        error instanceof Error
          ? error.message
          : "Could not select FCT endpoint.",
      );
    }
  }

  // Personal View widgets subscribe to the authoritative query tree. A widget
  // exists while its property-filter node exists in <query>. Binding selection is
  // reconciled from that node, so deleting a <value> clears only that checkbox
  // while leaving the property filter and its widget intact.
  useEffect(() => {
    // Keep the Filters pane scoped to the properties directly attached to the
    // current <view>, which moves as the user navigates the breadcrumbs.
    const propertyNodes = getActiveViewPropertyFilters(queryTree);
    setPersonalWidgets((current) => {
      const existingByUri = new Map(
        current.map((widget) => [widget.uri, widget]),
      );
      const next = propertyNodes.map((node) => {
        const uri = node.attributes.iri;
        const boundValues = node.children
          .filter((child) => child.name === "value" && Boolean(child.text))
          .map((child) => fctTermKey(child.text ?? "", child.attributes.datatype, child.attributes["xml:lang"]));
        const existing = existingByUri.get(uri);
        if (existing) {
          return existing.selectedValues.length === boundValues.length &&
            existing.selectedValues.every(
              (value, index) => value === boundValues[index],
            )
            ? existing
            : { ...existing, selectedValues: boundValues };
        }
        const facet = propertyFacets.find((item) => item.uri === uri);
        return {
          uri,
          label: facet?.label || compactIri(uri),
          values: [],
          selectedValues: boundValues,
          page: 0,
          loading: true,
          error: "",
        };
      });
      if (
        next.length === current.length &&
        next.every(
          (widget, index) =>
            widget.uri === current[index]?.uri &&
            widget.selectedValues.length ===
              current[index]?.selectedValues.length &&
            widget.selectedValues.every(
              (value, valueIndex) =>
                value === current[index]?.selectedValues[valueIndex],
            ),
        )
      )
        return current;
      return next;
    });
  }, [queryTree, propertyFacets]);

  const viewNode = findQueryNode(queryTree.children, "query-view");
  // Server batches and visible UI pages are independent. The active query view's
  // limit/offset are the main Results batch profile; the Group by query has its
  // own limit/offset below. The page-size preference is shared across both views.
  const resultsBatchSize = Math.max(
    1,
    Math.floor(Number(viewNode?.attributes.limit ?? 100) || 100),
  );
  const resultsOffset = Math.max(0, Number(viewNode?.attributes.offset ?? "0") || 0);
  const [resultsPageSize, setResultsPageSize] = useState<number>(DEFAULT_RESULTS_PAGE_SIZE);
  const resultsPageSizeStorageInitialized = useRef(false);

  useEffect(() => {
    if (resultsPageSizeStorageInitialized.current) return;
    resultsPageSizeStorageInitialized.current = true;
    try {
      const storedValue = window.localStorage.getItem(RESULTS_PAGE_SIZE_STORAGE_KEY);
      const storedSize = storedValue === null ? NaN : Number(storedValue);
      const validStoredSize = RESULTS_PAGE_SIZE_OPTIONS.find((size) => size === storedSize);
      if (validStoredSize !== undefined) setResultsPageSize(validStoredSize);
      else window.localStorage.setItem(RESULTS_PAGE_SIZE_STORAGE_KEY, String(DEFAULT_RESULTS_PAGE_SIZE));
    } catch {
      // Storage can be disabled by browser privacy settings; paging still works.
    }
  }, []);

  const queryXml = serializeFctQuery(queryTree);
  // The main Results request must use the active view's server-side limit and offset.
  const queryResultsXml = queryXml;
  const prettyQueryXml = xmlFormat(queryXml, { indentation: "  " });
  const groupByOptions: GroupByOption[] = [
    { key: "", uri: "", direction: "forward", label: "none", nodeId: "" },
    ...getActiveViewPropertyFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri) return [];
      const facet = propertyFacets.find((item) => item.uri === uri);
      return [{ key: `forward:${uri}`, uri, direction: "forward" as const, label: facet?.label || compactIri(uri), nodeId: node.id }];
    }),
    // Only reverse-role nodes explicitly selected in Focus belong in Group By.
    // A <property-of> ancestor that merely contains the active <view> is a
    // navigation/scope breadcrumb, not a checked relationship selection.
    ...getActiveViewRoleFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri) return [];
      const facet = roleFacets.find((item) => item.uri === uri);
      return [{ key: `reverse:${uri}`, uri, direction: "reverse" as const, label: `${facet?.label || compactIri(uri)} of`, nodeId: node.id }];
    }).filter((option, index, all) => all.findIndex((candidate) => candidate.key === option.key) === index),
  ];
  const selectedGroupByOption = groupByOptions.find((option) => option.key !== "" && option.key === groupByPropertyUri) ?? null;
  useEffect(() => {
    if (groupByPropertyUri && !groupByOptions.some((option) => option.key === groupByPropertyUri)) {
      setGroupByPropertyUri("");
      setCentralTab((current) => current === "groups" ? "results" : current);
    }
  }, [groupByPropertyUri, groupByOptions.map((option) => option.key).join("|")]);
  const [groupValues, setGroupValues] = useState<FctResult[]>([]);
  const visibleGroupValues = groupValues.slice(groupUiPage * resultsPageSize, (groupUiPage + 1) * resultsPageSize);
  const [groupValuesLoading, setGroupValuesLoading] = useState(false);
  const [groupValuesError, setGroupValuesError] = useState("");
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMembersState>>({});
  const sourceSparql = sparqlQuery || "# SPARQL will appear after the endpoint returns a query.";
  const queryWithoutPagingXml = serializeFctQuery(
    updateViewNode(queryTree, (node) => ({
      ...node,
      attributes: { ...node.attributes, offset: "0" },
    })),
  );
  // Ask FCT for the total independently of the current results page. The
  // count view uses the same active scope and filters, but never the page offset.
  const queryCountXml = serializeFctQuery(
    updateViewNode(queryTree, (node) => ({
      ...node,
      attributes: { ...node.attributes, type: "text", limit: "1000", offset: "0" },
    })),
  );

  const [results, setResults] = useState<FctResult[]>([]);
  const resultsBatchRequestPending = useRef(false);
  const lastCountQueryRef = useRef("");
  useEffect(() => {
    if (lastCountQueryRef.current && lastCountQueryRef.current !== queryCountXml) {
      setResultsUiPage(0);
      setResults([]);
      setGroupUiPage(0);
      setGroupBatchOffset(0);
      setGroupValues([]);
      if (resultsOffset !== 0) setResultsPage(resultsBatchSize, 0);
    }
    lastCountQueryRef.current = queryCountXml;
  }, [queryCountXml, resultsOffset, resultsBatchSize, setResultsPage]);
  const [resultsTotalCount, setResultsTotalCount] = useState<number | null>(null);
  const [resultsPageMatchCount, setResultsPageMatchCount] = useState(0);
  // Some FCT queries report a zero count while still returning rows when a graph
  // binding is active. Never display fewer total results than rows already loaded.
  const effectiveResultsTotalCount = resultsTotalCount === 0 && (results.length > 0 || resultsPageMatchCount > 0)
    ? Math.max(results.length, resultsPageMatchCount)
    : resultsTotalCount;
  const [describedRecord, setDescribedRecord] = useState<{ property: string; value: string }[]>([]);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isCountingResults, setIsCountingResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchPipelineRun, setSearchPipelineRun] = useState(0);
  const [initialBrowseTriggered, setInitialBrowseTriggered] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(0);

  useEffect(() => {
    const endpointReady = Boolean(
      selectedEndpointId &&
      endpointStatuses[selectedEndpointId]?.status != null &&
      endpointStatuses[selectedEndpointId].status! < 400
    );
    if (!endpointReady) {
      setResultsTotalCount(null);
      setIsCountingResults(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setResultsTotalCount(null);
    setIsCountingResults(true);

    async function loadTotalCount() {
      try {
        let total = 0;
        let offset = 0;
        while (true) {
          const pagedCountXml = serializeFctQuery(updateViewNode(queryTree, (node) => ({
            ...node,
            attributes: { ...node.attributes, type: "text", limit: "1000", offset: String(offset) },
          })));
          const response = await fetch("/api/fct", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queryXml: pagedCountXml, countOnly: true }),
            signal: controller.signal,
          });
          const data = await response.json();
          rememberShortforms(data?.shortforms);
          if (!response.ok) throw new Error(data.error ?? "Virtuoso count query failed.");
          const pageCount = readFctTotalCount(data) ?? 0;
          total += pageCount;
          if (data.complete === true || data.complete === "yes" || (typeof data.rowCount === "number" ? data.rowCount : pageCount) < 1000) break;
          offset += 1000;
        }
        if (cancelled) return;
        setResultsTotalCount(total);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        console.warn("FCT result count query failed:", error);
        setResultsTotalCount(null);
      } finally {
        if (!cancelled) setIsCountingResults(false);
      }
    }

    void loadTotalCount();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryCountXml, selectedEndpointId, endpointStatuses]);

  // FCT query timeout is expressed in milliseconds in the XML. Keep the slider
  // in seconds for the UI, and sync it if the authoritative query tree changes.
  useEffect(() => {
    const timeoutMs = Number(queryTree.attributes.timeout ?? "0");
    setTimeoutSeconds(Number.isFinite(timeoutMs)
      ? Math.max(0, Math.min(60, Math.round(timeoutMs / 1000)))
      : 0);
  }, [queryTree.attributes.timeout]);

  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [propertyFacetError, setPropertyFacetError] = useState("");
  const [classFacetError, setClassFacetError] = useState("");
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());

  useEffect(() => {
    const endpointReady = Boolean(
      selectedEndpointId &&
      endpointStatuses[selectedEndpointId]?.status != null &&
      endpointStatuses[selectedEndpointId].status! < 400
    );
    if (!endpointReady || initialBrowseTriggered) return;

    // Kick the same query-tree/search pipeline used by the search box, with an empty string.
    // The run token guarantees a request even though the initial search text is already empty.
    setSearch("");
    setInitialBrowseTriggered(true);
    setSearchPipelineRun((current) => current + 1);
  }, [selectedEndpointId, endpointStatuses, initialBrowseTriggered, setSearch]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;

    // Empty text is a valid initial browse query once an endpoint has passed its health check.
    const endpointReady = Boolean(selectedEndpointId && endpointStatuses[selectedEndpointId]?.status != null && endpointStatuses[selectedEndpointId].status! < 400);
    if (!query && !endpointReady) return;
    setSearchError("");

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError("");

      try {
        const response = await fetch("/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ queryXml: queryResultsXml }),
        });

        const data = await response.json();
        rememberShortforms(data?.shortforms);
        console.log("FCT API response:", data);

        if (!response.ok) {
          throw new Error(data.error ?? "Virtuoso search failed.");
        }

        if (cancelled) return;

        let nextResults: FctResult[] = Array.isArray(data.results)
          ? data.results
          : [];

        // Enrich only the resources returned by the authoritative FCT query,
        // using only checked properties/roles attached to the active view scope.
        // The API constructs a bounded VALUES query from these inputs, so a
        // breadcrumb's unrelated filters and the rest of the store are excluded.
        const selectedForward = getActiveViewPropertyFilters(queryTree)
          .map((node) => node.attributes.iri)
          .filter((iri): iri is string => typeof iri === "string" && Boolean(iri));
        const selectedReverse = getActiveViewRoleFilters(queryTree)
          .map((node) => node.attributes.iri)
          .filter((iri): iri is string => typeof iri === "string" && Boolean(iri));
        const resourceUris = [...new Set(nextResults.map((item) => item.uri).filter(Boolean))];
        const relationships: ScopeValue[] = [
          ...[...new Set(selectedForward)].map((property) => ({
            property,
            label: propertyFacets.find((facet) => facet.uri === property)?.label || compactIri(property),
            direction: "forward" as const,
            values: [{ value: "-" }],
          })),
          ...[...new Set(selectedReverse)].map((property) => ({
            property,
            label: roleFacets.find((facet) => facet.uri === property)?.label || compactIri(property),
            direction: "reverse" as const,
            values: [{ value: "-" }],
          })),
        ];
        // Render the selected relationship labels immediately, even when the
        // SPARQL protocol endpoint is unavailable. Missing values use a dash.
        nextResults = nextResults.map((item) => ({
          ...item,
          scopeValues: relationships.map((relationship) => ({
            ...relationship,
            values: relationship.values.map((value) => ({ ...value })),
          })),
        }));

        try {
          if (resourceUris.length && (selectedForward.length || selectedReverse.length)) {
            const enrichmentResponse = await fetch("/api/sparql", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                resources: resourceUris,
                properties: [...new Set(selectedForward)],
                roles: [...new Set(selectedReverse)],
              }),
              signal: AbortSignal.timeout(20000),
            });
            const enrichmentData = await enrichmentResponse.json();
            if (!enrichmentResponse.ok) {
              throw new Error(enrichmentData.error ?? "Could not enrich Results items.");
            }

            const facetLabel = (iri: string, direction: RelationshipDirection) =>
              (direction === "forward" ? propertyFacets : roleFacets)
                .find((facet) => facet.uri === iri)?.label || compactIri(iri);
            const grouped = new Map<string, Map<string, ScopeValue>>();
            for (const item of nextResults) {
              const resourceGroups = new Map<string, ScopeValue>();
              for (const relationship of relationships) {
                const key = `${item.uri}\u0000${relationship.direction}\u0000${relationship.property}`;
                resourceGroups.set(key, {
                  ...relationship,
                  values: [{ value: "-" }],
                });
              }
              grouped.set(item.uri, resourceGroups);
            }
            const bindings = Array.isArray(enrichmentData.results?.bindings)
              ? enrichmentData.results.bindings
              : [];
            for (const binding of bindings) {
              const resource = binding.resource?.value;
              const property = binding.property?.value;
              const direction = binding.direction?.value === "reverse" ? "reverse" : "forward";
              const term = binding.value;
              if (typeof resource !== "string" || typeof property !== "string" ||
                  !term || typeof term.value !== "string") continue;
              const key = `${resource}\u0000${direction}\u0000${property}`;
              let resourceGroups = grouped.get(resource);
              if (!resourceGroups) {
                resourceGroups = new Map<string, ScopeValue>();
                grouped.set(resource, resourceGroups);
              }
              let scopeValue = resourceGroups.get(key);
              if (!scopeValue) {
                scopeValue = { property, label: facetLabel(property, direction), direction, values: [] };
                resourceGroups.set(key, scopeValue);
              }
              const nextTerm: EnrichedTerm = {
                value: term.value,
                ...(typeof term.type === "string" ? { type: term.type } : {}),
                ...(typeof term.datatype === "string" ? { datatype: term.datatype } : {}),
                ...(typeof term["xml:lang"] === "string" ? { lang: term["xml:lang"] } : {}),
              };
              if (scopeValue.values.length === 1 && scopeValue.values[0].value === "-") {
                scopeValue.values = [nextTerm];
              } else if (!scopeValue.values.some((item) => item.value === nextTerm.value &&
                  item.type === nextTerm.type && item.datatype === nextTerm.datatype && item.lang === nextTerm.lang)) {
                scopeValue.values.push(nextTerm);
              }
            }
            nextResults = nextResults.map((item) => ({
              ...item,
              scopeValues: [...(grouped.get(item.uri)?.values() ?? [])],
            }));
          }
        } catch (enrichmentRequestError) {
          // A missing/unavailable SPARQL protocol endpoint must not discard the
          // authoritative FCT search results. Log the failure for diagnostics;
          // selected relationship labels remain visible with dash placeholders.
          const message = enrichmentRequestError instanceof Error
            ? enrichmentRequestError.message
            : "Could not enrich Results items.";
          const selectedEndpoint = fctEndpoints.find(
            (endpoint) => endpoint.id === selectedEndpointId,
          );
          const resultTitles = nextResults.map((item) => item.title || item.uri);
          console.warn("Results enrichment failed:", {
            message,
            endpointTitle: selectedEndpoint?.label ?? selectedEndpointId ?? "Unknown endpoint",
            endpointUrl: selectedEndpoint?.url ?? "Unknown endpoint URL",
            resultTitles,
            error: enrichmentRequestError,
          });
        }

        setSparqlQuery(typeof data.sparql === "string" ? data.sparql : "");
        setResultsPageMatchCount(Number.isFinite(Number(data.matchCount)) ? Number(data.matchCount) : nextResults.length);
        setResults((current) => {
          if (resultsOffset === 0) return nextResults;
          const merged = new Map(current.map((item) => [item.uri, item]));
          for (const item of nextResults) {
            const prior = merged.get(item.uri);
            merged.set(item.uri, prior ? { ...prior, ...item, matches: [...prior.matches, ...item.matches] } : item);
          }
          return Array.from(merged.values());
        });

        setSelectedUri((current) => current || nextResults[0]?.uri || "");
      } catch (error) {
        if (cancelled) return;

        setResults([]);
        setResultsPageMatchCount(0);
        setSelectedUri("");
        setSearchError(
          error instanceof Error ? error.message : "Search failed.",
        );
      } finally {
        resultsBatchRequestPending.current = false;
        if (!cancelled) setIsSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, queryResultsXml, resultsOffset, selectedEndpointId, endpointStatuses, searchPipelineRun]);

  useEffect(() => {
    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupMembers({});
    setGroupValuesError("");
  }, [queryCountXml, selectedGroupByOption?.key]);

  // Load group values through FCT itself. This query is a clone of the current
  // tree with the selected relationship used to enumerate its values.
  useEffect(() => {
    let cancelled = false;
    if (!selectedGroupByOption) {
      setGroupValues([]);
      setGroupValuesLoading(false);
      setGroupValuesError("");
      return;
    }
    const controller = new AbortController();
    setGroupValuesLoading(true);
    setGroupValuesError("");
    (async () => {
      try {
        const groupTreeBase = createPropertyWidgetQuery(queryTree, selectedGroupByOption.uri, selectedGroupByOption.direction, selectedGroupByOption.nodeId);
        const groupTree = updateViewNode(groupTreeBase, (node) => ({
          ...node,
          // Group headings enumerate the selected relationship's distinct
          // values (including RDF literals), not text-search result resources.
          attributes: { ...node.attributes, type: "list", limit: String(groupBatchSize), offset: String(groupBatchOffset) },
        }));
        const response = await fetch("/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryXml: serializeFctQuery(groupTree) }),
          signal: controller.signal,
        });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? "Failed to load group values.");
        if (!cancelled) {
          const nextGroupValues: FctResult[] = Array.isArray(data.results) ? data.results : [];
          setGroupHasMoreBatches(nextGroupValues.length >= groupBatchSize && data.complete !== true);
          setGroupValues((current) => {
            if (groupBatchOffset === 0) return nextGroupValues;
            const merged = new Map(current.map((item) => [groupValueKey(item), item]));
            for (const item of nextGroupValues) merged.set(groupValueKey(item), item);
            return Array.from(merged.values());
          });
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setGroupValues([]);
        setGroupValuesError(error instanceof Error ? error.message : "Failed to load group values.");
      } finally {
        if (!cancelled) setGroupValuesLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [search, queryCountXml, groupByPropertyUri, selectedGroupByOption?.key, groupBatchSize, groupBatchOffset]);

  // Each group member list is another FCT request: clone the complete source
  // query, bind only this group's value to the selected relationship, and keep
  // the view and all other filters exactly as they are.
  useEffect(() => {
    if (!selectedGroupByOption || groupValues.length === 0) {
      setGroupMembers({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const activeKeys = new Set(groupValues.map((value) => `${selectedGroupByOption.key}::${groupValueKey(value)}`));
    setGroupMembers((current) => Object.fromEntries(Object.entries(current).filter(([key]) => activeKeys.has(key))));
    for (const groupValue of groupValues) {
      const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
      setGroupMembers((current) => ({ ...current, [key]: { results: current[key]?.results ?? [], loading: true, error: "" } }));
      void (async () => {
        try {
          const memberTree = createGroupMemberQuery(queryTree, selectedGroupByOption, groupValue);
          const response = await fetch("/api/fct", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queryXml: serializeFctQuery(memberTree) }),
            signal: controller.signal,
          });
          const data = await response.json();
        rememberShortforms(data?.shortforms);
          if (!response.ok) throw new Error(data.error ?? `Failed to load items for ${groupValue.title || groupValue.uri}.`);
          if (!cancelled) setGroupMembers((current) => ({ ...current, [key]: { results: Array.isArray(data.results) ? data.results : [], loading: false, error: "" } }));
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setGroupMembers((current) => ({ ...current, [key]: { results: [], loading: false, error: error instanceof Error ? error.message : "Failed to load group items." } }));
        }
      })();
    }
    return () => { cancelled = true; controller.abort(); };
  }, [search, queryXml, selectedGroupByOption?.key, groupValues.map(groupValueKey).join("|")]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;

    const endpointReady = Boolean(selectedEndpointId && endpointStatuses[selectedEndpointId]?.status != null && endpointStatuses[selectedEndpointId].status! < 400);
    if (!query && !endpointReady) {
      setPropertyFacets([]);
      setClassFacets([]);
      setRoleFacets([]);
      setGraphFacets([]);
      setPropertyFacetSparql("");
      setRoleFacetSparql("");
      replaceFacetAutofillCandidates("property", []);
      replaceFacetAutofillCandidates("property-in", []);
      setFacetAutofillCandidates({ property: [], "property-in": [] });
      setPropertyFacetError("");
      setClassFacetError("");
      setIsLoadingProperties(false);
      setIsLoadingClasses(false);
      setIsLoadingRoles(false);
      return;
    }

    // Every query/endpoint change invalidates the previous query-specific graph list.
    // The replacement is loaded from the active query's full result set below.
    setGraphFacets([]);

    // A new source query means the previous scope's Autofill intersection is stale.
    // Clear it immediately; each facet kind repopulates its own list after its query loads.
    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoadingProperties(true);
      setIsLoadingClasses(true);
      setIsLoadingRoles(true);
      setPropertyFacetError("");
      setClassFacetError("");
      setRoleFacetError("");

      async function loadFacet(view: "properties" | "classes" | "roles") {
        // Incoming predicates are the inverse-property (Roles) facet.
        // Virtuoso exposes these with view type="properties-in".
        const response = await fetch("/api/fct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryXml: queryWithoutPagingXml,
            view: view === "roles" ? "properties-in" : view,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${view} facets.`);
        return {
          items: view === "classes"
            ? data.classes
            : view === "roles"
              ? data.roles
              : data.properties,
          sparql: typeof data.sparql === "string" ? data.sparql : "",
        };
      }

      const [propertiesResult, classesResult, rolesResult, graphResult] =
        await Promise.allSettled([
          loadFacet("properties"),
          loadFacet("classes"),
          loadFacet("roles"),
          (async () => {
            const allGraphs = new Set<string>();
            let offset = 0;
            while (true) {
              const graphQueryXml = serializeFctQuery(updateViewNode(queryTree, (node) => ({
                ...node,
                attributes: { ...node.attributes, type: "text", limit: "1000", offset: String(offset) },
              })));
              const response = await fetch("/api/fct", {
                method: "POST", cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queryXml: graphQueryXml, graphOnly: true }),
                signal: controller.signal,
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error ?? "Failed to load datasites for the current query.");
              for (const graph of Array.isArray(data.graphs) ? data.graphs : []) allGraphs.add(graph);
              if (data.complete === true || data.complete === "yes" || (typeof data.rowCount === "number" && data.rowCount < 1000)) break;
              offset += 1000;
            }
            return Array.from(allGraphs);
          })(),
        ]);

      if (cancelled) return;

      if (propertiesResult.status === "fulfilled") {
        setPropertyFacets(
          Array.isArray(propertiesResult.value.items) ? propertiesResult.value.items : [],
        );
        setPropertyFacetSparql(propertiesResult.value.sparql);
      } else {
        setPropertyFacets([]);
        setPropertyFacetSparql("");
        setPropertyFacetError(
          propertiesResult.reason instanceof Error
            ? propertiesResult.reason.message
            : "Failed to load property facets.",
        );
      }

      if (classesResult.status === "fulfilled") {
        setClassFacets(
          Array.isArray(classesResult.value.items) ? classesResult.value.items : [],
        );
      } else {
        setClassFacets([]);
        setClassFacetError(
          classesResult.reason instanceof Error
            ? classesResult.reason.message
            : "Failed to load class facets.",
        );
      }

      if (rolesResult.status === "fulfilled") {
        setRoleFacets(
          Array.isArray(rolesResult.value.items) ? rolesResult.value.items : [],
        );
        setRoleFacetSparql(rolesResult.value.sparql);
      } else {
        setRoleFacets([]);
        setRoleFacetSparql("");
        setRoleFacetError(
          rolesResult.reason instanceof Error
            ? rolesResult.reason.message
            : "Failed to load role facets.",
        );
      }
      if (graphResult.status === "fulfilled") {
        setGraphFacets(graphResult.value.map((uri: string) => ({ uri, label: uri, count: 0 })));
      } else {
        setGraphFacets([]);
      }

      setIsLoadingProperties(false);
      setIsLoadingClasses(false);
      setIsLoadingRoles(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, queryWithoutPagingXml, queryCountXml, selectedEndpointId, endpointStatuses]);




  // Defensively merge duplicate resource rows by URI. The API normally groups
  // these already, but this also protects the UI if the endpoint returns repeats.
  const visibleResults = Array.from(
    results.reduce((grouped, item) => {
      const existing = grouped.get(item.uri);
      if (existing) {
        const seenExcerpts = new Set(
          existing.matches.map((match) => match.excerpt),
        );
        for (const match of item.matches) {
          if (!seenExcerpts.has(match.excerpt)) {
            existing.matches.push(match);
            seenExcerpts.add(match.excerpt);
          }
        }
        if ((!existing.title || existing.title === existing.uri) && item.title) {
          existing.title = item.title;
        }
      } else {
        grouped.set(item.uri, {
          ...item,
          matches: [...item.matches],
        });
      }
      return grouped;
    }, new Map<string, FctResult>()),
  ).map(([, item]) => item);
  const allLoadedResults = visibleResults;
  const visibleResultsPage = allLoadedResults.slice(resultsUiPage * resultsPageSize, (resultsUiPage + 1) * resultsPageSize);
  useEffect(() => {
    if (visibleResultsPage.length > 0 && !visibleResultsPage.some((item) => item.uri === selectedUri)) {
      setSelectedUri(visibleResultsPage[0].uri);
    }
  }, [resultsOffset, resultsPageSize, resultsUiPage, visibleResultsPage, selectedUri]);

  const selectedResult = visibleResultsPage.find((item) => item.uri === selectedUri);

  // Virtuoso FCT supports a native describe view. Query the selected URI as the
  // fixed subject so the right pane shows its RDF properties, not just its excerpt.
  useEffect(() => {
    if (!selectedUri || !selectedEndpointId) {
      setDescribedRecord([]);
      setIsDescribing(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setDescribedRecord([]);
    setIsDescribing(true);
    const queryRoot = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as=""><text></text><value datatype="uri">[${escapeXmlText(selectedUri)}]</value>`;

    async function postFctQuery(queryXml: string) {
      const response = await fetch("/api/fct", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryXml }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Virtuoso record query failed.");
      return data as { properties?: { uri: string; label: string; count: number }[]; results?: { uri: string; title: string }[] };
    }

    async function loadDescription() {
      try {
        // A fixed subject cannot be described with FCT's `describe` view alone:
        // the documented query requires a property/class view or a relationship.
        // Fetch its predicates first, then fetch each predicate's values.
        const propertyData = await postFctQuery(`${queryRoot}<view type="properties" limit="1000" offset="0"/></query>`);
        const properties = Array.isArray(propertyData.properties) ? propertyData.properties : [];
        const rows = await Promise.all(properties.map(async (property) => {
          const predicate = property.uri || property.label;
          if (!predicate) return [] as { property: string; value: string }[];
          const valueData = await postFctQuery(`${queryRoot}<property iri="${escapeXmlText(predicate)}"><view type="list" limit="100" offset="0"/></property></query>`);
          const values = Array.isArray(valueData.results) ? valueData.results : [];
          return values.map((item) => ({
            property: property.label || predicate,
            value: item.title || item.uri,
          })).filter((item) => item.value);
        }));
        if (!cancelled) setDescribedRecord(rows.flat());
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("FCT record description failed:", error);
          setDescribedRecord([]);
        }
      } finally {
        if (!cancelled) setIsDescribing(false);
      }
    }

    void loadDescription();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedUri, selectedEndpointId]);

  // The active scope is the property-path node that currently contains the
  // authoritative <view>; at the root, scope is represented by null.
  const activePropertyPath = getPropertyPath();
  const activeLeafId: string | null =
    activePropertyPath.length > 0
      ? activePropertyPath[activePropertyPath.length - 1].id
      : null;
  // Derive checked state from the authoritative query tree, including path
  // properties left at the root when a breadcrumb moves the view elsewhere.
  const activePropertyFilters = getActiveViewPropertyFilters(queryTree);
  const activeRoleFilters = getActiveViewRoleFilters(queryTree);
  // Checkbox state is local to the active view's scope. Filters selected in
  // another query-tree branch must not appear checked when navigating here.
  const selectedProperties = new Set(
    activePropertyFilters
      .map((node) => node.attributes.iri)
      .filter((iri): iri is string => typeof iri === "string"),
  );
  const selectedRoles = new Set(
    activeRoleFilters
      .map((node) => node.attributes.iri)
      .filter((iri): iri is string => typeof iri === "string"),
  );
  const selectedClasses = new Set(getClassesAtNode(activeLeafId));
  const autoConfigureFacetCount =
    facetAutofillCandidates.property.filter((uri) => !selectedProperties.has(uri)).length +
    facetAutofillCandidates["property-in"].filter((uri) => !selectedRoles.has(uri)).length;
  const selectedPropertyKey = Array.from(selectedProperties).sort().join("|");
  const selectedRoleKey = Array.from(selectedRoles).sort().join("|");

  // Auto-configure candidates are the intersection of frequently added facets
  // and the current FCT facet results. The FCT response already represents the
  // active query scope, so a second SPARQL request is unnecessary and can fail
  // on endpoints that expose FCT but restrict their SPARQL service.
  useEffect(() => {
    if (typeof window === "undefined" || isLoadingProperties) return;
    const counts = readFacetAddCounts();
    const highFrequency = new Set(
      Object.entries(counts.property)
        .filter(([, count]) => count >= 3)
        .map(([uri]) => uri),
    );
    const applicable = propertyFacets
      .map((facet) => facet.uri)
      .filter((uri) => highFrequency.has(uri) && !selectedProperties.has(uri));
    const candidates = replaceFacetAutofillCandidates("property", applicable);
    setFacetAutofillCandidates((current) => ({ ...current, property: candidates }));
  }, [isLoadingProperties, propertyFacets, facetUsageRevision, selectedPropertyKey]);

  useEffect(() => {
    if (typeof window === "undefined" || isLoadingRoles) return;
    const counts = readFacetAddCounts();
    const highFrequency = new Set(
      Object.entries(counts["property-in"])
        .filter(([, count]) => count >= 3)
        .map(([uri]) => uri),
    );
    const applicable = roleFacets
      .map((facet) => facet.uri)
      .filter((uri) => highFrequency.has(uri) && !selectedRoles.has(uri));
    const candidates = replaceFacetAutofillCandidates("property-in", applicable);
    setFacetAutofillCandidates((current) => ({ ...current, "property-in": candidates }));
  }, [isLoadingRoles, roleFacets, facetUsageRevision, selectedRoleKey]);
  // Shared lookup for relationship paths. Direction selects the RDF edge tag;
  // the ID prefix distinguishes a path node from an ordinary filter node.
  function findRelationshipPathNode(
    uri: string,
    direction: RelationshipDirection,
  ): FctQueryNode | null {
    const tag = direction === "forward" ? "property" : "property-of";
    const idPrefix = direction === "forward" ? "property-path-" : "role-filter-";
    function visit(nodes: FctQueryNode[]): FctQueryNode | null {
      for (const node of nodes) {
        if (node.name === tag && node.id.startsWith(idPrefix) && node.attributes.iri === uri) return node;
        const nested = visit(node.children);
        if (nested) return nested;
      }
      return null;
    }
    return visit(queryTree.children);
  }

  function findPropertyPathNode(uri: string): FctQueryNode | null {
    return findRelationshipPathNode(uri, "forward");
  }

  // Single source of truth for both checkbox changes and property-label clicks.
  function handlePropertyCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (checked) {
      if (trackUsage && !selectedProperties.has(uri)) {
        recordFacetAddition("property", uri);
        setFacetUsageRevision((revision) => revision + 1);
      }
      addProperty(activeLeafId, uri);
      const facet = propertyFacets.find((item) => item.uri === uri);
      setPersonalWidgets((current) =>
        current.some((widget) => widget.uri === uri)
          ? current
          : [
              ...current,
              {
                uri,
                label: facet?.label || compactIri(uri),
                values: [],
                selectedValues: [],
                page: 0,
                loading: true,
                error: "",
              },
            ],
      );
    } else {
      const pathNode = findPropertyPathNode(uri);
      if (pathNode) {
        // The API relocates the view safely if this path currently contains it.
        deleteNode(pathNode.id);
      } else {
        removeProperty(activeLeafId, uri);
      }
      setPersonalWidgets((current) =>
        current.filter((widget) => widget.uri !== uri),
      );
    }
  }

  function toggleClass(uri: string, checked: boolean) {
    if (checked) addClass(activeLeafId, uri);
    else removeClass(activeLeafId, uri);
  }

  // Graph selection is a query-wide binding, independent of the text-search node.
  // Keep the toolbar's Graph field synchronized with the query graph attribute.
  useEffect(() => {
    setGraphText(queryTree.attributes.graph ?? "");
  }, [queryTree.attributes.graph]);

  function bindGraph(uri: string) {
    setGraphText(uri);
    setQueryAttribute("graph", uri);
  }

  function applyGraphText() {
    const graph = graphText.trim();
    setQueryAttribute("graph", graph || null);
  }

  function clearGraph() {
    setGraphText("");
    setQueryAttribute("graph", null);
  }

  function handleRoleCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (checked && trackUsage && !selectedRoles.has(uri)) {
      recordFacetAddition("property-in", uri);
      setFacetUsageRevision((revision) => revision + 1);
    }
    setRoleFilter(uri, checked);
  }

  function navigateIntoRelationship(uri: string, direction: RelationshipDirection) {
    const existingPath = findRelationshipPathNode(uri, direction);
    if (existingPath) {
      navigateToPropertyPath(existingPath.id);
      return;
    }

    if (direction === "forward") {
      // Preserve Properties behavior: ensure its filter is selected before the
      // query API promotes it into a forward path.
      if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true);
      addNestedProperty(uri);
    } else {
      // The query API promotes an existing role filter, or creates the reverse
      // path directly, and places the active view inside the <property-of>.
      addNestedPropertyOf(uri);
    }
  }

  function changeResultsPage(delta: number) {
    const nextPage = Math.max(0, resultsUiPage + delta);
    const totalPages = effectiveResultsTotalCount === null ? 1 : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize));
    if (nextPage >= totalPages || nextPage === resultsUiPage) return;
    setResultsUiPage(nextPage);
    const requiredResultCount = (nextPage + 1) * resultsPageSize;
    if (requiredResultCount > results.length && results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) && !isSearching) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + Math.max(1, resultsPageMatchCount));
    }
  }


  useEffect(() => {
    const requiredResultCount = (resultsUiPage + 1) * resultsPageSize;
    if (
      centralTab === "results" &&
      !isSearching &&
      !resultsBatchRequestPending.current &&
      results.length > 0 &&
      results.length < requiredResultCount &&
      results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) &&
      resultsPageMatchCount > 0
    ) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + resultsPageMatchCount);
    }
  }, [centralTab, resultsUiPage, resultsPageSize, isSearching, results.length, effectiveResultsTotalCount, resultsPageMatchCount, resultsBatchSize, resultsOffset, setResultsPage]);

  function compactIri(value: string): string {
    return toLabel(value);
  }

  function classBreadcrumbLabels(parentId: string | null): string[] {
    return getClassesAtNode(parentId).map((iri) => {
      const facet = classFacets.find((item) => item.uri === iri);
      return facet?.label || compactIri(iri);
    });
  }

  function getBreadcrumbSiblings(targetId: string): FctQueryNode[] {
    const isRelationship = (node: FctQueryNode) =>
      node.name === "property" || node.name === "property-of";

    let target: FctQueryNode | undefined;
    let targetParent: FctQueryNode | FctQueryTree | undefined;

    const visit = (
      nodes: FctQueryNode[],
      parent: FctQueryNode | FctQueryTree,
    ): boolean => {
      for (const node of nodes) {
        if (node.id === targetId) {
          target = node;
          targetParent = parent;
          return true;
        }
        if (visit(node.children, node)) return true;
      }
      return false;
    };
    visit(queryTree.children, queryTree);
    if (!target || !targetParent) return [];

    const flattenPropertiesWrappers = (nodes: FctQueryNode[]) =>
      nodes.flatMap((node) =>
        node.name === "properties" || node.id === "query-view-properties"
          ? node.children
          : [node],
      );

    // First look for alternatives alongside this relationship. A <properties>
    // wrapper is transparent, so its relationship children share one sibling set.
    const parentChildren = "children" in targetParent ? targetParent.children : [];
    const parentSiblings = flattenPropertiesWrappers(parentChildren).filter(
      (node, index, all) =>
        isRelationship(node) &&
        node.id !== targetId &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    if (parentSiblings.length > 0) return parentSiblings;

    // If the focused relationship is the only relationship at its parent level,
    // its nested <view> may contain a <properties> wrapper with the alternatives
    // for that focus. This is common when the view is carried by a single root
    // relationship, e.g. creator -> view -> properties -> issued / identifier.
    const nestedView = target.children.find((node) => node.name === "view" || node.id === "query-view");
    if (!nestedView) return [];
    const viewRelationships = flattenPropertiesWrappers(nestedView.children).filter(
      (node, index, all) =>
        isRelationship(node) &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    return viewRelationships;
  }

  function breadcrumbSiblingLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri ?? node.attributes.property ?? node.attributes.role;
    const facet = iri
      ? (node.name === "property-of" ? roleFacets : propertyFacets).find((item) => item.uri === iri)
      : undefined;
    const label = facet?.label || (iri ? compactIri(iri) : queryNodeLabel(node));
    return label + (node.name === "property-of" ? " of" : "");
  }

  function queryNodeLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri;
    if (node.id === "query-text")
      return `Search text${node.text ? `: ${node.text}` : " (empty)"}`;
    if (node.id === "query-view") {
      return `Results view · limit ${node.attributes.limit ?? "30"} · offset ${node.attributes.offset ?? "0"}`;
    }
    if (node.name === "properties") return "Filters";
    if (node.name === "value")
      return node.text ? `Value: ${node.text}` : "Value";
    if (node.name === "property-of") {
      // Depending on the source XML, reverse relationships may expose their
      // predicate through iri, property, role, or text. Prefer the Roles facet
      // label, but never fall back to the generic XML tag name.
      const roleIri = iri ?? node.attributes.property ?? node.attributes.role;
      const role = roleIri
        ? roleFacets.find((item) => item.uri === roleIri)
        : undefined;
      const roleText = typeof node.text === "string" ? node.text.trim() : "";
      return role?.label || (roleIri ? compactIri(roleIri) : "") || roleText || "Role";
    }
    if (node.name === "property") {
      // Keep the full IRI in the query tree; use a concise label only for display.
      // Literal bindings are not wired into the UI yet, but display them if present
      // in the query model/XML (e.g. iri="...date" literal="5/23/92").
      const facet = iri
        ? propertyFacets.find((item) => item.uri === iri)
        : undefined;
      const propertyLabel = facet?.label || (iri ? compactIri(iri) : "Property");
      const literal = node.attributes.literal ?? node.attributes.value;
      return literal !== undefined && literal !== ""
        ? `${propertyLabel} = ${literal}`
        : propertyLabel;
    }
    if (node.name === "class" && iri) {
      const facet = classFacets.find((item) => item.uri === iri);
      return `Class: ${facet?.label || compactIri(iri)}`;
    }
    return node.name;
  }


  const renderQueryNode = (
    node: FctQueryNode,
    depth = 0,
  ): ReactNode => {
    const protectedNode =
      node.id === "query-text" || node.id === "query-view";
    return (
      <li key={node.id} className="min-w-0">
        <div
          className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
          style={{ marginLeft: depth * 14 }}
        >
          <span
            className="mt-0.5 select-none text-muted-foreground"
            aria-hidden="true"
          >
            {node.children.length ? "▾" : "·"}
          </span>
          {node.name === "property" || node.name === "property-of" ? (
            <button
              type="button"
              className="min-w-0 flex-1 break-words text-left text-sm underline-offset-2 hover:underline cursor-pointer"
              title={`Navigate to ${node.name === "property-of" ? "reverse-role" : "property"} scope: ${node.attributes.iri ?? queryNodeLabel(node)}`}
              onClick={() => navigateToPropertyPath(node.id)}
            >
              {queryNodeLabel(node)}{node.name === "property-of" ? " of" : ""}
            </button>
          ) : (
            <span
              className="min-w-0 flex-1 break-words text-sm"
              title={node.attributes.iri ?? node.name}
            >
              {queryNodeLabel(node)}
            </span>
          )}
          <button
            type="button"
            aria-label={
              protectedNode
                ? `${queryNodeLabel(node)} is required`
                : `Remove ${queryNodeLabel(node)} and its children`
            }
            title={
              protectedNode
                ? "Required query node"
                : "Remove this node and all descendants"
            }
            disabled={protectedNode}
            onClick={() => deleteNode(node.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-base leading-none text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-25"
          >
            −
          </button>
        </div>
        {node.children.length > 0 && (
          <ul
            className="border-l border-border/70"
            style={{ marginLeft: depth * 14 + 18 }}
          >
            {node.children.map((child) => renderQueryNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  // Shared widget renderer. The left-pane version stacks widgets vertically;
  // the full Personal View keeps the original responsive grid.
  function renderPersonalWidgetCards(layout: "column" | "grid"): ReactNode {
    return (
      <div
        className={
          layout === "column"
            ? "flex flex-col gap-3"
            : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {personalWidgets.map((widget) => (
          <article
  key={widget.uri}
  className="flex min-w-0 flex-col"
>
            <header className="group/header flex items-start justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    className="break-words text-left text-sm font-semibold text-inherit underline-offset-2 hover:underline cursor-pointer"
                    title={`Navigate to ${widget.label} scope`}
                    onClick={() => {
                      const existingPath = findPropertyPathNode(widget.uri);
                      if (existingPath) navigateToPropertyPath(existingPath.id);
                      else navigateIntoRelationship(widget.uri, "forward");
                    }}
                  >
                    {widget.label}
                  </button>
                  {widget.loading && (
                    <span
                      className="text-xs text-sky-100/80 dark:text-sky-200/80"
                      aria-live="polite"
                    >
                      Updating…
                    </span>
                  )}
                  {widget.error && (
                    <span
                      className="text-xs text-destructive"
                      title={widget.error}
                    >
                      Update failed
                    </span>
                  )}
                </div>
                <p
                  className="mt-1 break-all text-xs text-muted-foreground"
                  title={widget.uri}
                >
                  {widget.uri}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <QueryInspectorButton
                  query={serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri))}
                  filename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`}
                  countQuery={widget.values[0] ? serializeFctQuery(createDistinctCountQuery(queryTree, "value", widget.values[0].uri, widget.uri, widget.values[0])) : undefined}
                  countFilename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}-first-item-count.xml`}
                />
                <button
                type="button"
                onClick={() => {
                  // If this property is represented by a relationship path in
                  // the query tree, remove that actual node. Removing only from
                  // activeLeafId can leave the original filter in another scope.
                  const pathNode = findPropertyPathNode(widget.uri);
                  if (pathNode) deleteNode(pathNode.id);
                  else removeProperty(activeLeafId, widget.uri);
                  setPersonalWidgets((current) =>
                    current.filter((item) => item.uri !== widget.uri),
                  );
                }}
                className="shrink-0 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${widget.label} widget`}
              >
                Remove
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!widget.loading &&
                !widget.error &&
                widget.values.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No values found for this property.
                  </p>
                )}
              {!widget.loading &&
                !widget.error &&
                widget.values.length > 0 &&
                (() => {
                  const pageCount = Math.max(
                    1,
                    Math.ceil(widget.values.length / FACET_PAGE_SIZE),
                  );
                  const page = Math.min(widget.page, pageCount - 1);
                  const pageValues = widget.values.slice(
                    page * FACET_PAGE_SIZE,
                    (page + 1) * FACET_PAGE_SIZE,
                  );
                  return (
                    <>
                      {widget.values.length > FACET_PAGE_SIZE && (
                        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
                          <button
                            type="button"
                            className="rounded px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() =>
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? { ...item, page: Math.max(0, page - 1) }
                                    : item,
                                ),
                              )
                            }
                            disabled={page === 0}
                          >
                            Previous
                          </button>
                          <span className="text-muted-foreground">
                            {page + 1}/{pageCount}
                          </span>
                          <button
                            type="button"
                            className="rounded px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() =>
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? {
                                        ...item,
                                        page: Math.min(pageCount - 1, page + 1),
                                      }
                                    : item,
                                ),
                              )
                            }
                            disabled={page >= pageCount - 1}
                          >
                            Next
                          </button>
                        </div>
                      )}
                      <div className="space-y-1">
                        {pageValues.map((value) => (
                          <label
                            key={value.uri}
                            className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                          >
                            <input
                              type="checkbox"
                              name={`property-value-${widget.uri}`}
                              value={value.uri}
                              checked={widget.selectedValues.includes(facetValueKey(value))}
                              onChange={(event) => {
                                const binding = groupValueBinding(value);
                                setPropertyValue(
                                  activeLeafId,
                                  widget.uri,
                                  { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) },
                                  event.currentTarget.checked,
                                );
                              }}
                              aria-label={`Bind ${widget.label} to ${value.title || value.uri}`}
                              className="mt-0.5 size-4 shrink-0 accent-current"
                            />
                            <span className="min-w-0 flex-1 break-words">
                              {value.title || value.uri}
                            </span>
                            <DistinctCount
                              tree={queryTree}
                              kind="value"
                              uri={value.uri}
                              propertyUri={widget.uri}
                              candidateValue={value}
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  );
                })()}
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <main className="flex h-dvh min-h-[500px] flex-col bg-background text-foreground">
      {isCheckingEndpoints && (
        <div className="fixed inset-x-0 top-0 z-[100] h-1.5 bg-muted" role="status" aria-label="Checking FCT endpoints">
          <Progress className="h-full rounded-none bg-muted" value={endpointChecksTotal > 0 ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint check progress" />
        </div>
      )}
      {personalWidgets.map((widget) => (
        <PersonalWidgetQueryListener
          key={widget.uri}
          propertyUri={widget.uri}
          setPersonalWidgets={setPersonalWidgets}
        />
      ))}

      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor="maestro-graph-input" className="shrink-0 text-sm font-medium">Datasite:</label>
          <div className="flex min-w-0 max-w-3xl flex-1 items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              id="maestro-graph-input"
              value={graphText}
              onChange={(event) => setGraphText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
              placeholder="Site URI"
              aria-label="Site URI"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <Toggle
              type="button"
              pressed={findEndpointsEnabled}
              onPressedChange={setFindEndpointsEnabled}
              title="find endpoints"
              aria-label="find endpoints"
              className="shrink-0 rounded-none border-l border-input px-3 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 data-[state=on]:hover:bg-green-200 dark:data-[state=on]:bg-green-950 dark:data-[state=on]:text-green-300 dark:data-[state=on]:hover:bg-green-900"
            ><Network aria-hidden="true" /></Toggle>
          </div>
          <button
            type="button"
            onClick={clearGraph}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            title="Clear graph field and query graph"
          >Clear</button>
          <button
            type="button"
            onClick={applyGraphText}
            className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >Go</button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.removeItem(FACET_ADD_COUNTS_STORAGE_KEY);
                window.localStorage.removeItem(FACET_AUTOFILL_STORAGE_KEY);
                setFacetAutofillCandidates({ property: [], "property-in": [] });
                setFacetUsageRevision((revision) => revision + 1);
                setAutoResetMessage("Auto-configure was reset.");
              } catch {
                setAutoResetMessage("Auto-configure could not be reset because browser storage is unavailable.");
              }
            }}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent cursor-pointer"
            title="Reset Auto-configure learning history and saved candidates"
          >
            Reset Auto
          </button>
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" title="FCT query execution timeout">
            <label htmlFor="fct-query-timeout" className="whitespace-nowrap text-xs text-muted-foreground">Timeout</label>
            <div className="w-24">
              <Slider
                id="fct-query-timeout"
                aria-label="Query timeout in seconds"
                min={0}
                max={60}
                step={1}
                value={[timeoutSeconds]}
                onValueChange={(values) => setTimeoutSeconds(values[0] ?? 0)}
                onValueCommit={(values) => setQueryAttribute("timeout", String((values[0] ?? 0) * 1000))}
              />
            </div>
            <output htmlFor="fct-query-timeout" className="w-8 text-right text-xs tabular-nums">{timeoutSeconds}s</output>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <label htmlFor="fct-query-same-as" className="whitespace-nowrap text-xs text-muted-foreground">Aliases</label>
            <Switch
              id="fct-query-same-as"
              checked={queryTree.attributes["same-as"] === "yes"}
              onCheckedChange={(checked) => setQueryAttribute("same-as", checked ? "yes" : "no")}
              aria-label="Include owl:sameAs relationships"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setIsRdfLoaderOpen(true);
              setRdfLoadMessage("");
              setRdfLoadError(false);
            }}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent cursor-pointer"
          >
            RDF Loader
          </button>
          <div className="flex items-center gap-2">
            <Label htmlFor="fct-endpoint" className="whitespace-nowrap text-xs text-muted-foreground">
              Data server:
            </Label>
            <select
              id="fct-endpoint"
              value={selectedEndpointId}
              onChange={(event) =>
                void chooseFctEndpoint(event.currentTarget.value)
              }
              className="max-w-[280px] rounded-md border bg-background px-2.5 py-1.5 text-xs"
              title="Choose which FCT endpoint receives queries"
            >
              {fctEndpoints.length === 0 && (
                <option value="">
                  {isCheckingEndpoints
                    ? "Loading endpoints and checking servers…"
                    : "No endpoints configured"}
                </option>
              )}
              {[...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                <optgroup key={group} label={group}>
                  {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                    const status = endpointStatuses[endpoint.id];
                    const mark =
                      status?.status === 200
                        ? "🟢 "
                        : status?.state === "server-error"
                          ? "🔴 "
                          : status && ["unreachable", "timeout"].includes(status.state)
                            ? "🟠 "
                            : "";
                    const statusText =
                      status?.status != null
                        ? ` (${new URL(endpoint.url).protocol.replace(":", "").toUpperCase()} ${status.status})`
                        : status
                          ? ` (${status.state})`
                          : "";
                    return (
                      <option key={endpoint.id} value={endpoint.id}>
                        {mark}{endpoint.label}{statusText}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
            {isCheckingEndpoints && (
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <span className="sr-only">{fctEndpoints.length === 0 ? "Loading FCT servers" : "Updating FCT servers"}</span>
                <Progress className="h-2 w-24" value={endpointChecksTotal ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint checks" />
                {fctEndpoints.length === 0 ? "Loading FCT servers…" : `Updating… ${endpointChecksCompleted}/${endpointChecksTotal}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => void checkFctEndpoints()}
              disabled={isCheckingEndpoints || fctEndpoints.length === 0}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 cursor-pointer"
              title="Check each server with a small FCT query"
            >
              {isCheckingEndpoints ? "Checking…" : "Check servers"}
            </button>
          </div>
        </div>
      </header>

      {autoResetMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-reset-dialog-title"
            className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-xl"
          >
            <h2 id="auto-reset-dialog-title" className="text-base font-semibold">
              Auto-configure
            </h2>
            <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">
              {autoResetMessage}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setAutoResetMessage("")}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {isRdfLoaderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rdf-loader-title"
        >
          <section className="w-full max-w-xl rounded-xl border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="rdf-loader-title" className="text-lg font-semibold">
                  RDF Loader
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Load RDF from a direct HTTP(S) URL into your local Virtuoso
                  database.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRdfLoaderOpen(false)}
                disabled={isRdfLoading}
                className="rounded-md border px-2 py-1 text-sm disabled:opacity-50 cursor-pointer"
              >
                Close
              </button>
            </div>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setIsRdfLoading(true);
                setRdfLoadMessage("");
                setRdfLoadError(false);
                try {
                  const response = await fetch("/api/rdf-loader", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      sourceUrl: rdfSourceUrl.trim(),
                      targetGraph: rdfTargetGraph.trim(),
                    }),
                  });
                  const data = await response.json();
        rememberShortforms(data?.shortforms);
                  if (!response.ok)
                    throw new Error(data.error || "RDF load failed.");
                  setRdfLoadMessage(data.message || "RDF load completed.");
                } catch (error) {
                  setRdfLoadError(true);
                  setRdfLoadMessage(
                    error instanceof Error ? error.message : "RDF load failed.",
                  );
                } finally {
                  setIsRdfLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="rdf-source-url"
                  className="mb-1 block text-sm font-medium"
                >
                  RDF source URL
                </label>
                <input
                  id="rdf-source-url"
                  type="url"
                  required
                  value={rdfSourceUrl}
                  onChange={(event) =>
                    setRdfSourceUrl(event.currentTarget.value)
                  }
                  placeholder="https://example.org/data.ttl"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use a direct link to an RDF document, not a dataset landing
                  page. Start with a small Turtle, RDF/XML, or N-Triples file.
                </p>
              </div>
              <div>
                <label
                  htmlFor="rdf-target-graph"
                  className="mb-1 block text-sm font-medium"
                >
                  Target graph IRI
                </label>
                <input
                  id="rdf-target-graph"
                  type="url"
                  required
                  value={rdfTargetGraph}
                  onChange={(event) =>
                    setRdfTargetGraph(event.currentTarget.value)
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Loaded triples will be placed in this named graph.
                </p>
              </div>
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                This first version runs Virtuoso&apos;s <code>LOAD</code>{" "}
                command on the local server. It does not show byte-level
                progress and is not intended for multi-gigabyte dumps.
              </div>
              {rdfLoadMessage && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`rounded-md border p-3 text-sm ${rdfLoadError ? "border-destructive text-destructive" : "border-emerald-600 text-emerald-700 dark:text-emerald-400"}`}
                >
                  {rdfLoadMessage}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRdfLoaderOpen(false)}
                  disabled={isRdfLoading}
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isRdfLoading ||
                    !rdfSourceUrl.trim() ||
                    !rdfTargetGraph.trim()
                  }
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRdfLoading ? "Loading RDF…" : "Load RDF"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {endpointMenuError && (
        <p role="alert" className="border-b px-4 py-1.5 text-xs text-destructive">
          {endpointMenuError}
        </p>
      )}

      <div className="shrink-0">
        <div role="tablist" aria-label="Navigation pane" className="flex shrink-0 gap-1 border-b px-2 pt-2">
          <button type="button" role="tab" aria-selected="true" className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground">Navigation</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Build</button>
          <button type="button" role="tab" aria-selected="false" disabled aria-disabled="true" title="Coming soon" className="-mb-px cursor-not-allowed px-3 py-2 text-sm font-medium text-muted-foreground opacity-50">Publish</button>
        </div>
        <nav aria-label="Navigation breadcrumbs" className="flex min-h-14 flex-wrap items-center gap-2 bg-background px-4 py-2">
        <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigateToPropertyPath("query-root")}
          className={`relative cursor-pointer rounded-md border px-2.5 pb-1.5 pt-4 text-sm ${getPropertyPath().length === 0 ? "border-primary bg-accent font-medium" : "bg-background hover:bg-accent"}`}
          title={`Return to the top-level query view${classBreadcrumbLabels(null).length ? ` · Classes: ${classBreadcrumbLabels(null).join(", ")}` : ""}`}
        >
          {classBreadcrumbLabels(null).length > 0 && (
            <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${classBreadcrumbLabels(null).join(", ")}`}>
              {classBreadcrumbLabels(null).join(", ")}
            </span>
          )}
          {search ? `"${search}"` : "query"}
        </button>

        </span>
        {getPropertyPath().map((crumb, index) => {
          const breadcrumbClasses = classBreadcrumbLabels(crumb.id);
          const breadcrumbLabel = (
            roleFacets.find((item) => item.uri === crumb.uri)?.label ??
            propertyFacets.find((item) => item.uri === crumb.uri)?.label ??
            compactIri(crumb.uri)
          ) + ((crumb.name === "property-of" || crumb.id.startsWith("role-filter-")) ? " of" : "");
          const breadcrumbSiblings = getBreadcrumbSiblings(crumb.id);
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <ButtonGroup aria-label={`Controls for ${breadcrumbLabel}`} className="[&>*+*]:!border-l-0">
                <button
                  type="button"
                  onClick={() => navigateToPropertyPath(crumb.id)}
                  className={`relative cursor-pointer rounded-none border-0 px-2.5 pb-1.5 pt-4 text-sm hover:bg-accent ${index === getPropertyPath().length - 1 ? "bg-accent font-medium" : "bg-background"}`}
                  title={`Navigate to ${crumb.uri}${breadcrumbClasses.length ? ` · Classes: ${breadcrumbClasses.join(", ")}` : ""}`}
                  aria-current={
                    index === getPropertyPath().length - 1 ? "location" : undefined
                  }
                >
                  {breadcrumbClasses.length > 0 && (
                    <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${breadcrumbClasses.join(", ")}`}>
                      {breadcrumbClasses.join(", ")}
                    </span>
                  )}
                  {breadcrumbLabel}
                </button>
                <button
                  type="button"
                  onClick={() => deleteNode(crumb.id)}
                  className="flex h-auto min-h-full w-7 shrink-0 self-stretch items-center justify-center rounded-none border-0 py-0 text-base leading-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${breadcrumbLabel}`}
                  title={`Remove ${breadcrumbLabel} and its descendants`}
                >
                  −
                </button>
                {breadcrumbSiblings.length > 0 && (
                  <>
                    <span aria-hidden="true" className="my-1 w-px shrink-0 self-stretch bg-border" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Choose a sibling for ${compactIri(crumb.uri)}`}
                          title="Choose a sibling relationship"
                          className="flex h-auto min-h-10 w-8 shrink-0 self-stretch items-center justify-center rounded-none border-0 bg-background p-0 text-foreground outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent"
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 6 4 4 4-4" /></svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        {breadcrumbSiblings.map((sibling) => (
                          <DropdownMenuItem
                            key={sibling.id}
                            onSelect={() => moveViewToSibling(crumb.id, sibling.id)}
                          >
                            {breadcrumbSiblingLabel(sibling)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </ButtonGroup>
            </span>
          );
        })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize={25} minSize={16} className="min-w-0">
            {/* Left pane navigation uses count links while retaining the existing panes. */}
            <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
                {defaultLeftTab === "facets" ? (
                  <>
                    <ButtonGroup aria-label="Return to facets">
                    <button type="button" onClick={() => setDefaultLeftTab("personal")} className="px-2 text-xs font-medium hover:bg-accent">Return to Facets</button>
                    <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                    <button
                      type="button"
                      onClick={() => setDefaultLeftTab("personal")}
                      className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                      aria-label={`Show Filters, ${personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)} facets`}
                      title="Show Filters"
                    >
                      {personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)}
                    </button>
                    </ButtonGroup>
                  </>
                ) : (
                  <>
                    {propertyFacets.length > 0 && (
                      <ButtonGroup aria-label="Configure properties">
                        <button type="button" onClick={() => { setFocusListOrder("Properties"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="px-2 text-xs font-medium hover:bg-accent">Configure Properties</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Properties");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus properties, ${propertyFacets.length} properties`}
                          title="Show Focus properties first"
                        >
                          {propertyFacets.length}
                        </button>
                      </ButtonGroup>
                    )}
                    {roleFacets.length > 0 && (
                      <ButtonGroup aria-label="Configure roles">
                        <button type="button" onClick={() => { setFocusListOrder("Roles"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="px-2 text-xs font-medium hover:bg-accent">Configure Roles</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Roles");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus roles, ${roleFacets.length} roles`}
                          title="Show Focus roles first"
                        >
                          {roleFacets.length}
                        </button>
                      </ButtonGroup>
                    )}
                    {autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <button
                          type="button"
                          onClick={() => {
                            for (const uri of facetAutofillCandidates.property) {
                              if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true, false);
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) handleRoleCheckboxChange(uri, true, false);
                            }
                          }}
                          className="px-2 text-xs font-medium hover:bg-accent"
                          title="Add high-frequency Properties and Roles that apply to the current query scope"
                        >Auto-configure</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <button
                          type="button"
                          onClick={() => {
                            for (const uri of facetAutofillCandidates.property) {
                              if (!selectedProperties.has(uri)) handlePropertyCheckboxChange(uri, true, false);
                            }
                            for (const uri of facetAutofillCandidates["property-in"]) {
                              if (!selectedRoles.has(uri)) handleRoleCheckboxChange(uri, true, false);
                            }
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Auto-configure ${autoConfigureFacetCount} facets`}
                          title={`${autoConfigureFacetCount} facets will be added`}
                        >{autoConfigureFacetCount}</button>
                      </ButtonGroup>
                    )}
                  </>
                )}
              </div>

              <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${defaultLeftTab === "facets" ? "bg-sky-50/70 dark:bg-sky-950/20" : "bg-background"}`}>
                {defaultLeftTab === "facets" && (
                  <>
                    {((Object.keys(facets) as FacetName[]).filter((group) => group !== "Classes" && group !== "Graphs") as FacetName[]).sort((a, b) => {
                      const order = focusListOrder === "Properties" ? ["Properties", "Roles", "Graphs"] : ["Roles", "Properties", "Graphs"];
                      return order.indexOf(a) - order.indexOf(b);
                    }).filter((group) =>
                      group === "Properties" ? propertyFacets.length > 0 :
                      group === "Roles" ? roleFacets.length > 0 : true
                    ).map((group) => {
                      const items: { key: string; label: string; count: number | null }[] =
                        group === "Properties"
                          ? propertyFacets.map((item) => ({
                              key: item.uri,
                              label: toLabel(item.uri),
                              count: item.count,
                            }))
                          : group === "Classes"
                            ? classFacets.map((item) => ({
                                key: item.uri,
                                label: `${toLabel(item.uri)}s`,
                                count: item.count,
                              }))
                            : group === "Roles"
                              ? roleFacets.map((item) => ({
                                  key: item.uri,
                                  label: toLabel(item.uri),
                                  count: item.count,
                                }))
                              : group === "Graphs"
                                ? graphFacets.map((item) => ({ key: item.uri, label: item.uri, count: item.count }))
                                : [];

                      const currentPage =
                        group === "Properties"
                          ? propertiesPage
                          : group === "Classes"
                            ? classesPage
                            : group === "Graphs"
                              ? graphsPage
                              : rolesPage;
                      const pageCount = Math.max(
                        1,
                        Math.ceil(items.length / FACET_PAGE_SIZE),
                      );
                      const pageItems =
                        group === "Properties" ||
                        group === "Classes" ||
                        group === "Roles" ||
                        group === "Graphs"
                          ? items.slice(
                              currentPage * FACET_PAGE_SIZE,
                              (currentPage + 1) * FACET_PAGE_SIZE,
                            )
                          : items;
                      const setPage =
                        group === "Properties"
                          ? setPropertiesPage
                          : group === "Classes"
                            ? setClassesPage
                            : group === "Graphs"
                              ? setGraphsPage
                              : setRolesPage;

                      return (
                        <section key={group} className="mb-5">
                          <div className="group/header mb-2 flex w-full items-stretch border-b">
                            <button
                              className={`flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm font-medium ${
                                group === "Properties" || group === "Roles"
                                  ? "bg-sky-800 text-sky-50 dark:bg-sky-950 dark:text-sky-100"
                                  : selectedFacet === group
                                    ? "text-primary"
                                    : "text-foreground"
                              }`}
                              onClick={() => setSelectedFacet(group)}
                            >
                              <span className="min-w-0 truncate">{group}</span>
                              <span
                                className={`ml-auto shrink-0 text-xs font-normal ${(group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError) ? "text-destructive" : group === "Properties" || group === "Roles" ? "text-sky-100/80 dark:text-sky-200/80" : "text-muted-foreground"}`}
                                aria-live="polite"
                                title={
                                  group === "Properties"
                                    ? propertyFacetError
                                    : group === "Classes"
                                      ? classFacetError
                                      : group === "Roles"
                                        ? roleFacetError
                                        : undefined
                                }
                              >
                                {(group === "Properties" && isLoadingProperties) ||
                                (group === "Classes" && isLoadingClasses) ||
                                (group === "Roles" && isLoadingRoles)
                                  ? "Updating…"
                                  : (group === "Properties" &&
                                        propertyFacetError) ||
                                      (group === "Classes" && classFacetError) ||
                                      (group === "Roles" && roleFacetError)
                                    ? "Update failed"
                                    : group === "Properties"
                                      ? propertyFacets.length
                                      : group === "Classes"
                                        ? classFacets.length
                                        : group === "Roles"
                                          ? roleFacets.length
                                          : items.length}
                              </span>
                            </button>
                            {group === "Properties" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                countQuery={propertyFacets[0]?.uri ? serializeFctQuery(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, "text")) : undefined}
                                countFilename="properties-first-item-count-fct-query.xml"
                              />
                            )}
                            {group === "Roles" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                countQuery={roleFacets[0]?.uri ? serializeFctQuery(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, "text")) : undefined}
                                countFilename="roles-first-item-count-fct-query.xml"
                              />
                            )}
                          </div>

                          {(group === "Properties" ||
                            group === "Classes" ||
                            group === "Roles") &&
                            items.length > FACET_PAGE_SIZE && (
                              <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) => Math.max(0, page - 1))
                                  }
                                  disabled={currentPage === 0}
                                >
                                  Previous
                                </button>
                                <span className="text-muted-foreground">
                                  Page {Math.min(currentPage + 1, pageCount)} of{" "}
                                  {pageCount}
                                </span>
                                <button
                                  type="button"
                                  className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    setPage((page) =>
                                      Math.min(pageCount - 1, page + 1),
                                    )
                                  }
                                  disabled={currentPage >= pageCount - 1}
                                >
                                  Next
                                </button>
                              </div>
                            )}

                          <div className="space-y-1">
                            {pageItems.map((item) => (
                              <div
                                key={item.key}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                              >
                                {group === "Graphs" ? (
                                  <input
                                    type="radio"
                                    name="maestro-query-graph"
                                    checked={queryTree.attributes.graph === item.key}
                                    onChange={() => bindGraph(item.key)}
                                    aria-label={`Bind graph ${item.label}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                ) : group === "Properties" ||
                                group === "Classes" ||
                                group === "Roles" ? (
                                  <input
                                    type="checkbox"
                                    checked={
                                      group === "Properties"
                                        ? selectedProperties.has(item.key)
                                        : group === "Classes"
                                          ? selectedClasses.has(item.key)
                                          : selectedRoles.has(item.key)
                                    }
                                    onChange={(event) =>
                                      group === "Properties"
                                        ? handlePropertyCheckboxChange(
                                            item.key,
                                            event.target.checked,
                                          )
                                        : group === "Classes"
                                          ? toggleClass(
                                              item.key,
                                              event.target.checked,
                                            )
                                          : handleRoleCheckboxChange(
                                              item.key,
                                              event.target.checked,
                                            )
                                    }
                                    aria-label={`Filter by ${item.label}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                ) : null}
                                {group === "Properties" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => navigateIntoRelationship(item.key, "forward")}
                                    title={`Drill down through ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Roles" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => navigateIntoRelationship(item.key, "reverse")}
                                    title={`Filter by role ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : group === "Classes" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => {
                                      if (!selectedClasses.has(item.key)) toggleClass(item.key, true);
                                      showClassResults(item.key, activeLeafId);
                                    }}
                                    title={`Show results for class ${toLabel(item.key)}`}
                                  >
                                    {toLabel(item.key)}
                                  </button>
                                ) : group === "Graphs" ? (
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => bindGraph(item.key)}
                                    title={`Bind graph ${item.key}`}
                                  >
                                    {item.label}
                                  </button>
                                ) : (
                                  <span className="min-w-0 flex-1 break-all">{item.label}</span>
                                )}
                                {(group === "Properties" ||
                                  group === "Roles") && (
                                  <DistinctCount
                                    tree={queryTree}
                                    kind={
                                      group === "Properties" ? "property" : "role"
                                    }
                                    uri={item.key}
                                  />
                                )}
                                {group === "Classes" && (
                                  <DistinctCount
                                    tree={queryTree}
                                    kind="class"
                                    uri={item.key}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}

                {defaultLeftTab === "personal" && (
                  <div className="space-y-3">
                    {classFacets.length > 0 && (
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-start justify-between gap-2 border-b px-2 py-2">
                        <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Categories</h2><QueryInspectorButton query={`${queryWithoutPagingXml}\n<!-- FCT API option: view=classes -->`} filename="categories-fct-query.xml" countQuery={classFacets[0]?.uri ? serializeFctQuery(createDistinctCountQuery(queryTree, "class", classFacets[0].uri, undefined, undefined, "text")) : undefined} countFilename="categories-first-item-count.sparql" /></div>
                        <span
                          className={`text-xs ${classFacetError ? "text-destructive" : "text-muted-foreground"}`}
                          aria-live="polite"
                          title={classFacetError || undefined}
                        >
                          {isLoadingClasses
                            ? "Updating…"
                            : classFacetError
                              ? "Update failed"
                              : classFacets.length}
                        </span>
                      </header>
                      {classFacetError ? (
                        <p className="text-xs text-destructive">{classFacetError}</p>
                      ) : classFacets.length === 0 && !isLoadingClasses ? (
                        <p className="text-xs text-muted-foreground">No classes found for this query.</p>
                      ) : (
                        <>
                          {classFacets.length > FACET_PAGE_SIZE && (
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.max(0, page - 1))}
                                disabled={classesPage === 0}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                Page {Math.min(classesPage + 1, Math.ceil(classFacets.length / FACET_PAGE_SIZE))} of {Math.max(1, Math.ceil(classFacets.length / FACET_PAGE_SIZE))}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.min(Math.ceil(classFacets.length / FACET_PAGE_SIZE) - 1, page + 1))}
                                disabled={classesPage >= Math.ceil(classFacets.length / FACET_PAGE_SIZE) - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className="space-y-1">
                            {classFacets
                              .slice(classesPage * FACET_PAGE_SIZE, (classesPage + 1) * FACET_PAGE_SIZE)
                              .map((item) => (
                                <div key={item.uri} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                                  <input
                                    type="checkbox"
                                    checked={selectedClasses.has(item.uri)}
                                    onChange={(event) => toggleClass(item.uri, event.target.checked)}
                                    aria-label={`Filter by class ${toLabel(item.uri)}`}
                                    className="size-4 shrink-0 accent-current"
                                  />
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => {
                                      if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true);
                                      showClassResults(item.uri, activeLeafId);
                                    }}
                                    title={`Show results for class ${toLabel(item.uri)}`}
                                  >
                                    {toLabel(item.uri)}
                                  </button>
                                  <DistinctCount tree={queryTree} kind="class" uri={item.uri} />
                                </div>
                              ))}
                          </div>
                        </>
                      )}
                    </article>
                    )}
                    {activeRoleFilters.map((roleNode) => {
                      const uri = roleNode.attributes.iri ?? "";
                      const label = roleFacets.find((item) => item.uri === uri)?.label || compactIri(uri);
                      return (
                        <article key={roleNode.id} className="flex min-w-0 flex-col">
                          <header className="group/header flex items-start justify-between gap-2 border-b px-3 py-2">
                            <div className="min-w-0">
                              <button
                                type="button"
                                className="cursor-pointer text-left text-sm font-semibold underline-offset-2 hover:underline"
                                onClick={() => navigateToPropertyPath(roleNode.id)}
                                title={`Navigate to role scope ${label}`}
                              >
                                Role filter: {label}
                              </button>
                              <p className="mt-1 break-all text-xs text-sky-100/80 dark:text-sky-200/80" title={uri}>{uri}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1"><QueryInspectorButton query={roleFacetSparql} language="sparql" filename="roles-facet.sparql" />
                            <button
                              type="button"
                              className="shrink-0 px-2 py-1 text-xs text-sky-100/80 hover:text-white dark:text-sky-200/80 dark:hover:text-white cursor-pointer"
                              onClick={() => deleteNode(roleNode.id)}
                              aria-label={`Remove role filter ${label}`}
                            >
                              Remove
                            </button></div>
                          </header>
                        </article>
                      );
                    })}
                    {renderPersonalWidgetCards("column")}
                    {graphFacets.length > 0 && (
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-center justify-between gap-2 px-2 py-2">
                        <div className="flex min-w-0 items-center gap-1"><h2 className="text-sm font-semibold">Datasites</h2><QueryInspectorButton query={`${queryWithoutPagingXml}\n<!-- FCT API option: graphOnly=true -->`} filename="datasites-fct-query.xml" /></div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground" aria-live="polite">
                            {graphFacets.length}
                          </span>
                          {queryTree.attributes.graph && (
                            <button
                              type="button"
                              onClick={clearGraph}
                              className="rounded border px-2 py-1 text-xs hover:bg-accent"
                              aria-label="Clear graph selection"
                              title="Clear datasite selection and Datasite field"
                            >Clear</button>
                          )}
                        </div>
                      </header>
                      {graphFacets.length === 0 ? (
                        <p className="px-2 text-xs text-muted-foreground">
                          No registered graphs yet.
                        </p>
                      ) : (
                        <>
                          {graphFacets.length > FACET_PAGE_SIZE && (
                            <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => Math.max(0, page - 1))} disabled={graphsPage === 0}>Previous</button>
                              <span className="text-muted-foreground">Page {Math.min(graphsPage + 1, Math.ceil(graphFacets.length / FACET_PAGE_SIZE))} of {Math.max(1, Math.ceil(graphFacets.length / FACET_PAGE_SIZE))}</span>
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => Math.min(Math.ceil(graphFacets.length / FACET_PAGE_SIZE) - 1, page + 1))} disabled={graphsPage >= Math.ceil(graphFacets.length / FACET_PAGE_SIZE) - 1}>Next</button>
                            </div>
                          )}
                          <div className="space-y-1">
                            {[...graphFacets]
                              .sort((a, b) => {
                                const selectedGraph = queryTree.attributes.graph;
                                if (a.uri === selectedGraph) return -1;
                                if (b.uri === selectedGraph) return 1;
                                return 0;
                              })
                              .slice(graphsPage * FACET_PAGE_SIZE, (graphsPage + 1) * FACET_PAGE_SIZE)
                              .map((item) => (
                              <label key={item.uri} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer">
                                <input type="radio" name="maestro-query-graph-personal" checked={queryTree.attributes.graph === item.uri} onChange={() => bindGraph(item.uri)} aria-label={`Bind datasite ${item.uri}`} className="size-4 shrink-0 accent-current" />
                                <span className="min-w-0 flex-1 break-all">{item.uri}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
                    )}
                  </div>
                )}

                {defaultLeftTab === "community" && (
                  <div className="space-y-2">
                    <h2 className="text-sm font-semibold">Community</h2>
                    <p className="text-xs text-muted-foreground">
                      Community-shared views will appear here. This tab is a
                      placeholder for now.
                    </p>
                  </div>
                )}
              </div>
            </aside>

            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={45} minSize={25} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col border-r">
              <div className="group/header shrink-0 border-b p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search results..."
                    aria-label="Search results"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      // Clear the authoritative <text> node, then explicitly run
                      // the same FCT results pipeline even if it was already empty.
                      setSearch("");
                      setSearchPipelineRun((current) => current + 1);
                    }}
                    className="shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    aria-label="Clear text search"
                    title="Clear text search"
                  >
                    Clear
                  </button>
                  <Toggle
                    pressed={centralTab === "query-tree" || centralTab === "view-query"}
                    onPressedChange={(pressed) => setCentralTab(pressed ? "query-tree" : (groupByPropertyUri ? "groups" : "results"))}
                    className="group inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm"
                    aria-label="Query"
                    title="Query"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 transition-transform group-data-[state=on]:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5h5v4H5zM14 15h5v4h-5zM5 15h5v4H5zM10 7h4v10M10 17h4" strokeLinejoin="round" /></svg>
                    <span>{centralTab === "query-tree" || centralTab === "view-query" ? "Results" : "Query"}</span>
                  </Toggle>
                  <QueryInspectorButton query={queryResultsXml} filename="results-fct-query.xml" />
                </div>
                {searchError && <p className="mt-2 text-sm text-destructive">{searchError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">
                    Group <strong className="font-semibold text-foreground">{isCountingResults || effectiveResultsTotalCount === null ? "…" : effectiveResultsTotalCount.toLocaleString()}</strong> results by:
                  </span>
                  <select
                    id="groups-property-select"
                    aria-label="Group results by property"
                    value={groupByPropertyUri}
                    disabled={groupByOptions.length <= 1}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setGroupByPropertyUri(value);
                      setCentralTab(value ? "groups" : "results");
                    }}
                    className="min-w-[8rem] max-w-full flex-1 rounded-md border border-input bg-background py-2 pl-3 pr-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {groupByOptions.map((option) => <option key={option.key || "none"} value={option.key}>{option.label}</option>)}
                  </select>
                  <label htmlFor="results-page-size" className="shrink-0 text-muted-foreground">in pages of</label>
                  <select
                    id="results-page-size"
                    aria-label="Results page size"
                    value={resultsPageSize}
                    disabled={isSearching}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_PAGE_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      try {
                        window.localStorage.setItem(RESULTS_PAGE_SIZE_STORAGE_KEY, String(nextSize));
                      } catch {
                        // Storage can be disabled; the current selection still applies.
                      }
                      setResultsPageSize(nextSize);
                      setResultsUiPage(0);
                      setGroupUiPage(0);
                    }}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {RESULTS_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <span aria-hidden="true" className="mx-1 h-6 border-l border-border" />
                  <label htmlFor="results-batch-size" className="shrink-0 text-muted-foreground">Batch size</label>
                  <select
                    id="results-batch-size"
                    aria-label="Server batch size"
                    value={centralTab === "groups" && selectedGroupByOption ? groupBatchSize : resultsBatchSize}
                    disabled={isSearching || groupValuesLoading}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      if (centralTab === "groups" && selectedGroupByOption) {
                        setGroupBatchSize(nextSize);
                        setGroupBatchOffset(0);
                        setGroupUiPage(0);
                        setGroupHasMoreBatches(false);
                        setGroupValues([]);
                      } else {
                        setResultsUiPage(0);
                        setResults([]);
                        setResultsPage(nextSize, 0);
                      }
                    }}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                  </select>
                  {selectedGroupByOption ? <><span aria-hidden="true" className="mx-1 h-6 border-l border-border" /><span className="shrink-0 text-muted-foreground">{groupValuesLoading ? "…" : `${visibleGroupValues.length} ${visibleGroupValues.length === 1 ? "group" : "groups"}`}</span></> : null}
                </div>
              </div>

              {(centralTab === "results" && effectiveResultsTotalCount !== null && effectiveResultsTotalCount > resultsPageSize || centralTab === "groups" && selectedGroupByOption && (groupValues.length > resultsPageSize || groupHasMoreBatches)) && (
                <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                  <span className="text-muted-foreground" aria-live="polite">
                    {centralTab === "groups"
                      ? `Page ${groupUiPage + 1} / ${Math.max(1, Math.ceil(groupValues.length / resultsPageSize)).toLocaleString()}${groupHasMoreBatches ? "+" : ""}`
                      : `Page ${resultsUiPage + 1} / ${Math.max(1, Math.ceil((effectiveResultsTotalCount ?? 0) / resultsPageSize)).toLocaleString()}`}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-input px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        if (centralTab === "groups") setGroupUiPage((page) => Math.max(0, page - 1));
                        else changeResultsPage(-1);
                      }}
                      disabled={(centralTab === "groups" ? groupUiPage === 0 : resultsUiPage === 0) || isSearching || groupValuesLoading}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-input px-2 py-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        if (centralTab === "groups") {
                          const nextPage = groupUiPage + 1;
                          setGroupUiPage(nextPage);
                          if ((nextPage + 1) * resultsPageSize > groupValues.length && groupHasMoreBatches) {
                            setGroupBatchOffset(groupValues.length);
                          }
                        } else changeResultsPage(1);
                      }}
                      disabled={isSearching || groupValuesLoading || (centralTab === "groups" ? ((groupUiPage + 1) * resultsPageSize >= groupValues.length && !groupHasMoreBatches) : resultsUiPage + 1 >= Math.ceil((effectiveResultsTotalCount ?? 0) / resultsPageSize))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              {centralTab === "results" && (
                <div
                  id="central-panel-results"
                  role="tabpanel"
                  aria-labelledby="central-tab-results"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >


              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {visibleResultsPage.map((item, index) => {
                  const isExpanded = expandedUris.has(item.uri);

                  return (
                    <div
                      key={`${item.uri}-${index}`}
                      className={`mb-2 rounded-md border ${
                        selectedUri === item.uri
                          ? "border-primary"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-start gap-2 p-3">
                        <button
                          onClick={() => setSelectedUri(item.uri)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="block text-sm font-medium cursor-pointer">
                            {item.title && item.title !== item.uri ? item.title : toLabel(item.uri)}
                          </span>
                          <span className="mt-1 block break-all text-xs text-muted-foreground">
                            {item.uri}
                          </span>
                          {(item.scopeValues?.length ?? 0) > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected property values">
                              {item.scopeValues!.map((scopeValue) => scopeValue.values.map((term, termIndex) => {
                                const displayValue = term.type === "uri" ? compactIri(term.value) : term.value;
                                const label = `${scopeValue.direction === "reverse" ? `${scopeValue.label} of` : scopeValue.label}: ${term.value}${term.lang ? ` @${term.lang}` : ""}${term.datatype ? `^^${term.datatype}` : ""}`;
                                return (
                                  <span
                                    key={`${scopeValue.direction}:${scopeValue.property}:${term.value}:${term.lang ?? ""}:${term.datatype ?? ""}:${termIndex}`}
                                    title={label}
                                    className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-normal text-muted-foreground"
                                  >
                                    <span className="font-medium text-foreground">{scopeValue.direction === "reverse" ? `${scopeValue.label} of` : scopeValue.label}</span>
                                    <span className="max-w-[240px] truncate">{displayValue}</span>
                                  </span>
                                );
                              }))}
                            </span>
                          )}
                        </button>

                        {search.trim().length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUris((previous) => {
                                const next = new Set(previous);

                                if (next.has(item.uri)) {
                                  next.delete(item.uri);
                                } else {
                                  next.add(item.uri);
                                }

                                return next;
                              })
                            }
                            className="shrink-0 rounded px-2 py-1 text-xs hover:bg-accent"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Hide" : "Matches"} ({item.matches.length})
                          </button>
                        )}
                      </div>

                      {isExpanded && search.trim().length > 0 && (
                        <div className="border-t px-3 py-2">
                          {item.matches.map((match, index) => (
                            <div
                              key={`${item.uri}-match-${index}`}
                              className="border-b py-2 text-sm last:border-b-0"
                            >
                              {match.excerpt ? (
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: match.excerpt
                                      .replace(/&lt;b&gt;/gi, "<b>")
                                      .replace(/&lt;\/b&gt;/gi, "</b>"),
                                  }}
                                />
                              ) : (
                                "(No excerpt available)"
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {visibleResultsPage.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {searchError
                      ? "Search could not be completed."
                      : !search.trim()
                        ? "No resources returned for the initial empty-text query."
                        : isSearching
                          ? "Searching..."
                          : "No matching results."}
                  </p>
                )}
              </div>
                </div>
              )}

              {centralTab === "groups" && selectedGroupByOption && (
                <div id="central-panel-groups" role="tabpanel" aria-labelledby="central-tab-groups" className="min-h-0 flex-1 overflow-auto p-3">
                  {groupByOptions.length > 0 ? (
                    <div className="flex min-h-0 flex-col gap-3">
                      {groupValuesLoading ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading group values from Virtuoso FCT…</p> : null}
                      {groupValuesError ? <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{groupValuesError}</p> : null}
                      {!groupValuesLoading && !groupValuesError && groupValues.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No values found for this relationship in the current scope.</p> : null}
                      <div className="flex flex-col gap-3">
                        {visibleGroupValues.map((groupValue) => {
                          const memberKey = `${selectedGroupByOption!.key}::${groupValueKey(groupValue)}`;
                          const members = groupMembers[memberKey] ?? { results: [], loading: true, error: "" };
                          const selectedRelationshipNode = findQueryNode(queryTree.children, selectedGroupByOption!.nodeId);
                          const expectedBinding = groupValueBinding(groupValue);
                          const bound = (selectedRelationshipNode?.children ?? []).some((child) => child.name === "value" && child.text === expectedBinding.text && (child.attributes.datatype ?? "uri") === expectedBinding.datatype && (child.attributes["xml:lang"] ?? "") === (expectedBinding.lang ?? ""));
                          return <article key={memberKey} className="flex min-w-0 flex-col rounded-md border border-border">
                            <header className="group/header flex items-start gap-2 border-b border-border px-3 py-2">
                              <input type="checkbox" checked={bound} onChange={(event) => {
                                if (selectedGroupByOption!.direction === "forward") setPropertyValue(activeLeafId, selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                                else setRoleValue(selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                              }} aria-label={`Filter ${selectedGroupByOption!.label} by ${groupValue.title || groupValue.uri}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                              <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{groupValue.title || groupValue.uri}</h3><p className="mt-0.5 break-all text-xs text-muted-foreground">{groupValue.uri}</p></div>
                              <span className="shrink-0 text-xs text-muted-foreground">{members.loading ? "…" : `${members.results.length} ${members.results.length === 1 ? "item" : "items"}`}</span>
                              <QueryInspectorButton query={serializeFctQuery(createGroupMemberQuery(queryTree, selectedGroupByOption!, groupValue))} filename={`group-${(groupValue.title || groupValue.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`} />
                            </header>
                            <div className="flex flex-col gap-1 p-2">
                              {members.error ? <p className="px-2 py-2 text-xs text-destructive">{members.error}</p> : members.loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading matching Results items…</p> : members.results.length > 0 ? members.results.map((item) => <button key={item.uri} type="button" onClick={() => setSelectedUri(item.uri)} className={`flex min-w-0 flex-col rounded-md px-2 py-2 text-left hover:bg-accent/50 ${selectedUri === item.uri ? "bg-accent/40" : ""}`}><span className="break-words text-sm font-medium cursor-pointer">{item.title && item.title !== item.uri ? item.title : toLabel(item.uri)}</span><span className="mt-0.5 break-all text-xs text-muted-foreground">{item.uri}</span></button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No Results items match this value.</p>}
                            </div>
                          </article>;
                        })}
                      </div>
                    </div>
                  ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Select a property or role in Focus, then choose it from Group by.</p>}
                </div>
              )}

              {centralTab === "query-tree" && (
                <div
                  id="central-panel-query-tree"
                  role="tabpanel"
                  aria-labelledby="central-tab-query-tree"
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Live query structure. Changes in Filters, Focus, navigation, and bindings appear here immediately.
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          resetQuery();
                          setSearch("");
                          setGroupByPropertyUri("");
                          setCentralTab("query-tree");
                          setSearchPipelineRun((current) => current + 1);
                        }}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setCentralTab("view-query")}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        View source
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {queryTree.children.map((node) => renderQueryNode(node))}
                  </ul>
                </div>
              )}

              {centralTab === "view-query" && (
                <div
                  id="central-panel-view-query"
                  role="tabpanel"
                  aria-labelledby="central-tab-view-query"
                  className="min-h-0 flex-1 overflow-auto p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Query source returned by the FCT endpoint.</p>
                    <ButtonGroup aria-label="Query source format">
                      <Toggle pressed={querySourceFormat === "xml"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("xml"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">XML</Toggle>
                      <Toggle pressed={querySourceFormat === "sparql"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("sparql"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">SPARQL</Toggle>
                    </ButtonGroup>
                    <button type="button" onClick={() => setCentralTab("query-tree")} className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Back to Query</button>
                  </div>
                  <CodeBlock className="h-full min-h-0" language={querySourceFormat === "xml" ? "xml" : "sparql"} code={querySourceFormat === "xml" ? prettyQueryXml : sourceSparql} filename={querySourceFormat === "xml" ? "fct-query.xml" : "query.sparql"} />
                </div>
              )}
            </section>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={18} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col">
              <div className="border-b p-4">
                <h2 className="text-base font-semibold">
                  {selectedResult?.title ?? "Record"}
                </h2>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selectedUri}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <h3 className="mb-3 text-sm font-semibold">
                  Properties and values
                </h3>
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {describedRecord.map((item, index) => (
                      <tr
                        key={`${item.property}-${index}`}
                        className="border-b"
                      >
                        <td className="break-all px-3 py-3 align-top font-medium">
                          {item.property}
                        </td>
                        <td className="break-all px-3 py-3 align-top">
                          {item.value}
                        </td>
                      </tr>
                    ))}
                    {describedRecord.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-sm text-muted-foreground">
                          {isDescribing ? "Loading record description…" : selectedUri ? "No description data returned." : "Select a result to describe it."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            </ResizablePanel>
          </ResizablePanelGroup>

      </div>
    </main>
  );
}