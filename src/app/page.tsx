"use client";

import { FCT_VIEW_TYPES, type FctViewType } from "@/lib/fct-view-types";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rememberNamespaceMetadata, rememberShortforms, setNamespacePrefixSource, toLabel } from "@/lib/uri-labels";
import { proxyDebugFingerprint, proxyDebugHeaders } from "@/lib/proxy-debug";
import { buildFctCountSparql } from "@/lib/fct-count-sparql";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { ThemeToggle } from "@/components/theme-toggle";
import { configureMaestroBrowserLogging, type BrowserLogLevel } from "@/lib/maestro-client-logging";
import type { ReactNode, Dispatch, SetStateAction, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ButtonGroup } from "@/components/ui/button-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { renderDiscoveredViewXslt } from "@/lib/discovered-view-xslt";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge } from "@/components/ui/avatar";
import { Toggle } from "@/components/ui/toggle";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster, toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Ban, Bot, Check, ChevronDown, ChevronRight, ChevronLeft, ChevronsRightLeft, ChevronsDownUp, ChevronsUpDown, CircleSlash, Code2, Focus, List, MousePointerClick, Network, Settings, Link, SearchCode, SignalHigh, SignalLow, SignalMedium, SignalZero, Tag, Tags, Trash, Trash2, UsersRound, BetweenHorizontalStart, BetweenHorizontalEnd, ListTree, CornerDownLeft, CirclePlay, AtSign, Shapes, X, Slash, GlobeCode, LoaderCircle, ArrowDown01, ArrowDown10, ArrowDownAZ, ArrowDownZA, ArrowLeft, ArrowRight, ClockArrowRight, Equal, EqualApproximately, Regex, RotateCcw, RotateCw, RefreshCw, Bookmark, History, BadgeCheck, BadgeAlert, BadgeX, BadgeQuestionMark, SquarePlus, SquareX, SquareCheck, User, LogIn, LogOut, KeyRound, ShieldCheck, ClipboardCheck, ClipboardList, CircleFadingCheck, Download, Upload, Eye, EyeOff, Info, Table2, TableProperties, ChartColumn, Server, Database, Globe, LayoutGrid } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { PersonalAuthSession, AuthType, loadPersonalAuthSession, savePersonalAuthSession, clearPersonalAuthSession, setMaestroSessionCookie, buildAuthHeader, graphForPrefix, AUTH_EXPECTED_KEY } from "@/lib/personal-auth";
import { MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, cachedFetchFct, clearClientQueryCache, maestroQueryFetch } from "@/lib/client-query-cache";
import { MAESTRO_TIMEOUT_CATEGORIES, readMaestroWidgetTimeouts, writeMaestroWidgetTimeouts, type MaestroTimeoutCategory } from "@/lib/maestro-query-timeouts";
import { setMaestroIncompleteResults, getMaestroIncompleteResults, subscribeMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";
import { initializeMaestroStorage, maestroStorageGet, maestroStorageSet, clearMaestroStorage } from "@/lib/maestro-storage";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CodeBlock } from "@/components/ui/code-block";
import { BasicAssistantChat } from "@/components/ai-elements/basic-chat";
import { transformMaestroRecordXslt, transformMaestroQueryXslt } from "@/lib/maestro-xslt";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import xmlFormat from "xml-formatter";
import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";
import { useFctQuery, fctQueryTreeApi, serializeFctQuery, createPropertyWidgetQuery, createGroupMemberQuery, createGroupValuesQuery, createDistinctCountQuery, setQueryViewAttributes } from "@/lib/fct-query-api";
import type { FctQueryNode, FctQueryTree, FctUiResultSummary, DistinctCountKind } from "@/lib/fct-query-api";

hljs.registerLanguage("xml", xmlLanguage);
// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.
hljs.registerLanguage("sparql", sqlLanguage);

/** Display an Anytime result marker only for a widget whose most recent query was incomplete. */

function IncompleteWidgetIndicator({ source }: { source: string }) {
  const [status, setStatus] = useState(() => getMaestroIncompleteResults(source));
  useEffect(() => {
    setStatus(getMaestroIncompleteResults(source));
    return subscribeMaestroIncompleteResults(() => setStatus(getMaestroIncompleteResults(source)));
  }, [source]);
  if (!status?.incomplete) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0 items-center" role="img" aria-label="Incomplete Virtuoso results" tabIndex={0}>
        <CircleFadingCheck className="size-4" aria-hidden="true" />
      </span>} />
      <TooltipContent className="z-[100] max-w-xs break-words">
        <span className="font-medium">Incomplete Virtuoso Anytime results</span>
        <span className="mt-1 block">{status.message || "The graph server stopped the query before completion. Available rows are shown."}</span>
        {status.requestId && <span className="mt-1 block">Request: {status.requestId}</span>}
      </TooltipContent>
    </Tooltip>
  );
}


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

/** Shared static colors for the Configure pane's green scheme. */
const CONFIGURE_LIST_BACKGROUND_COLOR = "#EFF6FC";
const CONFIGURE_HEADER_BACKGROUND_COLOR = "#6BA8E0"//"#0078D4";
const CONFIGURE_HEADER_BORDER_COLOR = "#005A9E";

const DEFAULT_RESULTS_PAGE_SIZE = 20;
const RESULTS_PAGE_SIZE_STORAGE_KEY = "maestro-results-page-size";
const RESULTS_BATCH_SIZE_OPTIONS = [100, 200, 300, 400, 500, 1000, 2000] as const;
/** Page sizes partition the active server batch into five equal fractions. */
function pageSizesForBatch(batchSize: number): number[] {
  const batch = Math.max(5, Math.floor(batchSize));
  return Array.from({ length: 5 }, (_, index) => Math.max(1, Math.floor(batch * (index + 1) / 5)));
}
/** LIMIT applied to every left-panel widget: Categories, Personal facets, Graphs, and Configure Properties/Roles. */
const LEFT_PANEL_LIMIT_STORAGE_KEY = "maestro-left-panel-limit";
const DEFAULT_LEFT_PANEL_LIMIT = 30;
const CENTER_PANEL_LIMIT_STORAGE_KEY = "maestro-center-panel-limit";
const CENTER_GROUP_LIMIT_STORAGE_KEY = "maestro-center-group-limit";
const RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY = "maestro-right-panel-describe-limit";
const RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY = "maestro-right-panel-page-limit";
const RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS = [30, 100, 250, 500, 1000, 10000] as const;
const RIGHT_PANEL_PAGE_LIMIT_OPTIONS = [10, 20, 30, 50, 100] as const;
/** Single inter-item gap used by all left-pane facet lists, including tree branches. */
const FACET_ITEM_GAP_CLASS = "space-y-0.5";
const PROPERTY_ROLE_ITEM_GAP_CLASS = "space-y-0";
/** Row window for the Categories tree query (type="classes" tree="yes"): one row per class/parent edge. */
const CATEGORY_TREE_QUERY_LIMIT = 500;
const RDFS_LABEL_URI = "http://www.w3.org/2000/01/rdf-schema#label";

/** Common RDF vocabulary properties used as human-readable names or labels. */
const TEXT_SEARCH_NAME_PROPERTIES = [
  { label: "rdfs:label", description: "RDF Schema label", uri: RDFS_LABEL_URI },
  { label: "skos:prefLabel", description: "Preferred label", uri: "http://www.w3.org/2004/02/skos/core#prefLabel" },
  { label: "foaf:name", description: "FOAF name", uri: "http://xmlns.com/foaf/0.1/name" },
  { label: "schema:name", description: "Schema.org name", uri: "https://schema.org/name" },
  { label: "dcterms:title", description: "Dublin Core title", uri: "http://purl.org/dc/terms/title" },
  { label: "dc:title", description: "Dublin Core title (legacy)", uri: "http://purl.org/dc/elements/1.1/title" },
  { label: "vcard:fn", description: "Formatted name", uri: "http://www.w3.org/2006/vcard/ns#fn" },
  { label: "foaf:nick", description: "Nickname", uri: "http://xmlns.com/foaf/0.1/nick" },
  { label: "schema:alternateName", description: "Alternative name", uri: "https://schema.org/alternateName" },
  { label: "skos:altLabel", description: "Alternative label", uri: "http://www.w3.org/2004/02/skos/core#altLabel" },
  { label: "skos:hiddenLabel", description: "Hidden label", uri: "http://www.w3.org/2004/02/skos/core#hiddenLabel" },
  { label: "dbp:name", description: "DBpedia infobox name", uri: "http://dbpedia.org/property/name" },
  { label: "dbp:alias", description: "DBpedia infobox aliases", uri: "http://dbpedia.org/property/alias" },
  { label: "dbo:alias", description: "DBpedia ontology aliases", uri: "http://dbpedia.org/ontology/alias" },
  { label: "dbo:birthName", description: "DBpedia birth name", uri: "http://dbpedia.org/ontology/birthName" },
  { label: "schema:name (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/name" },
  { label: "schema:alternateName (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/alternateName" },
] as const;

/** Estimates localStorage key/value payload size; browsers do not expose exact quota usage. */
function getLocalStorageUsageBytes(): number {
  let bytes = 0;
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key === null) continue;
    const value = window.localStorage.getItem(key) ?? "";
    // localStorage strings are commonly accounted for as UTF-16 code units.
    bytes += (key.length + value.length) * 2;
  }
  return bytes;
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}



type FacetItem = {
  uri: string;
  label: string;
  count: number;
  /** Immediate superclass, present on rows of a tree="yes" classes view (one row per parent). */
  parent?: string;
  example?: { uri: string; label: string; termType?: "uri" | "literal" | "bnode" };
};

function createFacetItem(
  uri: string,
  label: string,
  count: number | null | undefined = 0,
  example?: FacetItem["example"],
): FacetItem {
  return {
    uri,
    label,
    count: count ?? 0,
    ...(example ? { example } : {}),
  };
}


type FacetName = string;

type OntologyClassMetadata = { uri: string; ontology: string; parent?: string; ontologyLabel?: string };
type CategoryTreeNode = { item: FacetItem; children: CategoryTreeNode[] };

/** At most this many distinct leaf categories are listed on one page of the Categories tree. */
const CATEGORY_TREE_LEAVES_PER_PAGE = 10;
/** A node is identified by its path, because a class with several parents appears once under each. */
const categoryTreeNodeKey = (parentKey: string, uri: string) => (parentKey ? `${parentKey}\u0000${uri}` : uri);

/** Every node that has children (the ones that can be collapsed), by path key. */
function collectCategoryTreeParentKeys(roots: CategoryTreeNode[]): string[] {
  const keys: string[] = [];
  const visit = (node: CategoryTreeNode, parentKey: string) => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    if (node.children.length > 0) { keys.push(key); node.children.forEach((child) => visit(child, key)); }
  };
  roots.forEach((root) => visit(root, ""));
  return keys;
}

/**
 * Split the tree into pages holding at most CATEGORY_TREE_LEAVES_PER_PAGE distinct leaf categories each.
 * Leaves are taken in tree order; a page shows its leaves together with the ancestor path leading to each
 * of them, so a subtree larger than one page continues on the next page under the same ancestors.
 */
function paginateCategoryTree(roots: CategoryTreeNode[]): CategoryTreeNode[][] {
  const pageLeaves: Array<Set<string>> = [new Set()];
  const pagesOfNode = new Map<string, Set<number>>();
  const assign = (node: CategoryTreeNode, parentKey: string): Set<number> => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    const pages = new Set<number>();
    if (node.children.length === 0) {
      let current = pageLeaves[pageLeaves.length - 1];
      if (!current.has(node.item.uri) && current.size >= CATEGORY_TREE_LEAVES_PER_PAGE) { current = new Set(); pageLeaves.push(current); }
      current.add(node.item.uri);
      pages.add(pageLeaves.length - 1);
    } else {
      for (const child of node.children) assign(child, key).forEach((page) => pages.add(page));
    }
    pagesOfNode.set(key, pages);
    return pages;
  };
  roots.forEach((root) => assign(root, ""));
  const prune = (node: CategoryTreeNode, parentKey: string, page: number): CategoryTreeNode | null => {
    const key = categoryTreeNodeKey(parentKey, node.item.uri);
    if (!pagesOfNode.get(key)?.has(page)) return null;
    return { item: node.item, children: node.children.flatMap((child) => prune(child, key, page) ?? []) };
  };
  if (roots.length === 0) return [[]];
  return pageLeaves.map((_, page) => roots.flatMap((root) => prune(root, "", page) ?? []));
}

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
  label?: string;
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

type ListValueProjection = { property: string; direction: "forward" | "reverse" };

/** Make a derived FCT query. Projection nodes are deliberately not filters. */
function listValuesQueryClone(xml: string, columns: ListValueProjection[]): string {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const view = Array.from(document.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0", "view"))[0]
    ?? Array.from(document.getElementsByTagName("view"))[0];
  if (!view || !view.parentElement) throw new Error("The live query has no view carrier.");
  view.setAttribute("type", FCT_VIEW_TYPES.LIST_VALUES);
  view.removeAttribute("badges");
  const parent = view.parentElement;
  const ns = view.namespaceURI || "http://openlinksw.com/services/facets/1.0";
  for (const column of columns) {
    const node = document.createElementNS(ns, column.direction === "reverse" ? "property-of" : "property");
    node.setAttribute("iri", column.property);
    node.setAttribute("project", "yes");
    parent.insertBefore(node, view);
  }
  return new XMLSerializer().serializeToString(document);
}

/** Read the bounded, typed cells of the Maestro FCT list-values extension. */
function parseListValuesXml(xml: string): Map<string, ScopeValue[]> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid list-values FCT response XML.");
  const root = doc.documentElement;
  const errorNode = Array.from(root.getElementsByTagName("*")).find((node) => node.localName === "error");
  if (errorNode) throw new Error(errorNode.textContent || "The list-values request failed.");
  const map = new Map<string, ScopeValue[]>();
  const rows = Array.from(root.getElementsByTagName("*")).filter((node) => node.localName === "row");
  for (const row of rows) {
    const cols = Array.from(row.children).filter((node) => node.localName === "column");
    const resource = cols[0]?.textContent?.trim() ?? "";
    if (!resource) continue;
    const scoped = cols.slice(2).flatMap((col): ScopeValue[] => {
      const property = col.getAttribute("property") || "";
      if (!property) return [];
      const direction: RelationshipDirection = col.getAttribute("direction") === "reverse" ? "reverse" : "forward";
      const values = Array.from(col.children).filter((node) => node.localName === "value").map((node): EnrichedTerm => {
        const datatype = node.getAttribute("datatype") || undefined;
        const lang = node.getAttribute("xml:lang") || undefined;
        return { value: node.textContent ?? "", type: datatype === "uri" ? "uri" : datatype === "bnode" ? "bnode" : "literal",
          ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}) };
      });
      return [{ property, direction, label: toLabel(property), values: values.length ? values : [{ value: "-" }] }];
    });
    map.set(resource, scoped);
  }
  return map;
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const POLICY_QUERY_ACTIONS = new Set([
  "addProperty", "removeProperty", "setPropertyValues", "setPropertyValue", "setRoleValue",
  "addNestedProperty", "addNestedPropertyOf", "addClass", "removeClass", "setRoleFilter",
  "setResultsPage", "showClassResults", "deleteNode", "setSearchText", "resetQuery", "setView",
  "setQueryAttribute", "setNodeAttribute", "setNodeText", "setValue", "insertNode", "replaceNode", "removeNode",
]);

/** Split a constrained action's argument list without evaluating source code. */
function splitPolicyActionArguments(source: string): string[] {
  const args: string[] = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (source.slice(start).trim()) args.push(source.slice(start).trim());
  return args;
}

/** Parse only a direct call to an allowlisted query-update API; never eval template code. */
function parsePolicyQueryAction(source: string, element: Element, recordUri: string): { method: string; args: unknown[] } {
  if (source.length > 4000) throw new Error("Template action is too long.");
  const match = source.trim().match(/^fctQueryTreeApi\.([A-Za-z][A-Za-z0-9]*)\(([\s\S]*)\)\s*;?$/);
  if (!match || !POLICY_QUERY_ACTIONS.has(match[1])) throw new Error("Only direct calls to Maestro's allowlisted query-update API are permitted in mui:action.");
  const rawArgs = splitPolicyActionArguments(match[2]);
  const args = rawArgs.map((raw) => {
    if (raw === "undefined") return undefined;
    if (raw === "record.uri") return recordUri;
    if (raw === "result.uri") return ((element.closest("[data-maestro-query-instance]") as HTMLElement | null)?.dataset.resultUri ?? (element as HTMLElement).dataset.resultUri ?? "");
    const dataBinding = raw.match(/^event\.currentTarget\.dataset\.([A-Za-z][A-Za-z0-9]*)$/);
    if (dataBinding) return (element as HTMLElement).dataset[dataBinding[1]] ?? "";
    if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(raw)) return JSON.parse(raw);
    if (raw.startsWith("\"") || raw.startsWith("[") || raw.startsWith("{")) {
      try { return JSON.parse(raw); } catch { throw new Error("Action arguments must be JSON literals or approved record/data bindings."); }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    throw new Error("Action arguments must be literals, record.uri, result.uri, or event.currentTarget.dataset.<name>.");
  });
  if (args.length === 0 || args[0] !== undefined) throw new Error("A mui:action must pass undefined as its first argument so Maestro applies the operation to the live query.");
  return { method: match[1], args };
}

type ParsedFctResponse = {
  sparql: string;
  viewType: string;
  rows: FctResponseColumn[][];
  complete: "yes" | "no";
  rowCount: number;
  incomplete: boolean;
  results: FctResult[];
  properties: { uri: string; label: string; count: number }[];
  classes: { uri: string; label: string; count: number }[];
  roles: { uri: string; label: string; count: number }[];
  graphs: { uri: string; label: string; count: number }[];
  describe: { subject: FctResponseColumn; predicate: FctResponseColumn; object: FctResponseColumn }[];
  count?: number;
  shortforms: { uri: string; shortform?: string; label?: string }[];
    warning?: string;
  sqlState?: string;
  sqlMessage?: string;
  execMilliseconds?: string;
  dbActivity?: string;
  error?: string;
};

function parseFctResponse(xmlText: string): ParsedFctResponse {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The FCT API returned malformed XML.");
  const byLocalName = (root: ParentNode, name: string) => Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);
  const root = document.documentElement;
  const getText = (name: string) => byLocalName(root, name)[0]?.textContent?.trim() ?? "";
  const error = presentServerError(getText("error"));
  
  const warning = getText("warning");
const sqlState = getText("sql-state");
const sqlMessage = getText("sql-message");
const execMilliseconds = getText("exec-milliseconds");
const dbActivity = getText("db-activity");

  if (error) return { sparql: getText("sparql"), viewType: "error", rows: [], complete: "no", rowCount: 0, results: [], properties: [], classes: [], roles: [], graphs: [], describe: [], count: undefined, shortforms: [], incomplete: true, error };
  const resultNode = byLocalName(root, "result")[0];
  const resultType = resultNode?.getAttribute("type") ?? "text";
  const rows = resultNode ? byLocalName(resultNode, "row") : [];
  const termColumn = (element: Element, index: number): FctResponseColumn => {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value;
    const datatype = element.getAttribute("datatype") ?? undefined;
    const lang = element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ?? element.getAttribute("xml:lang") ?? undefined;
    const shortform = element.getAttribute("shortform") ?? undefined;
    const label = element.getAttribute("label") ?? undefined;
    const termType = datatype === "uri" || datatype === "url" ? "uri" : datatype === "bnode" ? "bnode" : "literal";
    return { value: element.textContent ?? "", name: String(index + 1), termType, ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}), ...(shortform ? { shortform } : {}), ...(label ? { label } : {}), attributes, raw: { "#text": element.textContent ?? "", ...attributes } };
  };
  const rowColumns = rows.map((row) => byLocalName(row, "column").map(termColumn));
  const firstTerm = (columns: FctResponseColumn[]) => columns[0];
  const results: FctResult[] = rowColumns.flatMap((columns) => {
    const first = firstTerm(columns);
    if (!first) return [];
    const second = columns[1];
    const third = columns[2];
    const isText = resultType === FCT_VIEW_TYPES.TEXT;
    const excerpt = isText ? (second?.value ?? "") : "";
    // A label column is any later column that is not a count. Count-sorted list
    // views (Group By) put the integer COUNT in column 2 and the label, if any,
    // after it; reading column 2 as the label made some titles show the count.
    const isCountColumn = (column: FctResponseColumn) =>
      column.attributes?.var === "ct" || column.attributes?.var === "n"
      || /#(?:integer|int|long|short|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong)$/.test(column.datatype ?? "");
    const labelColumn = isText ? undefined : columns.slice(1).find((column) => column.attributes?.var === "c2" || !isCountColumn(column));
    const title = first.termType === "uri"
      ? (first.label || labelColumn?.value || toLabel(first.value))
      : (labelColumn?.value || first.value);
    const parsedScopeValues: ScopeValue[] = [];
    const scopeValueMap = new Map<string, ScopeValue>();
    for (const column of columns) {
      const propIri = column.attributes?.property;
      if (!propIri) continue;
      const direction: RelationshipDirection = column.attributes?.direction === "reverse" ? "reverse" : "forward";
      const key = `${direction}\u0000${propIri}`;
      let scopeVal = scopeValueMap.get(key);
      if (!scopeVal) {
        scopeVal = {
          property: propIri,
          label: toLabel(propIri),
          direction,
          values: [],
        };
        scopeValueMap.set(key, scopeVal);
        parsedScopeValues.push(scopeVal);
      }
      if (column.value) {
        const nextTerm: EnrichedTerm = {
          value: column.value,
          ...(column.termType ? { type: column.termType } : {}),
          ...(column.datatype ? { datatype: column.datatype } : {}),
          ...(column.lang ? { lang: column.lang } : {}),
        };
        if (!scopeVal.values.some((v) => v.value === nextTerm.value)) {
          scopeVal.values.push(nextTerm);
        }
      }
    }
    const item: FctResult = {
      uri: first.value,
      title,
      ...(first.shortform ? { shortform: first.shortform } : {}),
      termType: first.termType ?? "literal",
      ...(first.datatype ? { datatype: first.datatype } : {}),
      ...(first.lang ? { lang: first.lang } : {}),
      columns,
      matches: excerpt ? [{ excerpt, columns: columns.slice(1) }] : [],
      ...(parsedScopeValues.length > 0 ? { scopeValues: parsedScopeValues } : {}),
    };
    if (resultType === FCT_VIEW_TYPES.LIST_COUNT && second) item.columns = columns;
    if (third && resultType === FCT_VIEW_TYPES.TEXT) item.matches = [{ excerpt: third.value, columns: columns.slice(2) }];
    return [item];
  });
  const facetItems = rowColumns.flatMap((columns) => {
    if (!columns[0]) return [];
    const labelKind = resultType === FCT_VIEW_TYPES.CLASSES ? "Class" : resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? "Role" : resultType === FCT_VIEW_TYPES.PROPERTIES ? "Property" : undefined;
    const exampleColumn = resultType === FCT_VIEW_TYPES.PROPERTIES || resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? columns[2] : undefined;
    return [{
      uri: columns[0].value,
      label: columns[0].label || columns[0].shortform || toLabel(columns[0].value, labelKind),
      count: Number(columns[1]?.value ?? 0),
      ...(resultType === FCT_VIEW_TYPES.CLASSES && columns[2]?.termType === "uri" && columns[2].value ? { parent: columns[2].value } : {}),
      ...(exampleColumn?.value ? { example: { uri: exampleColumn.value, label: exampleColumn.label || exampleColumn.shortform || (exampleColumn.termType === "uri" ? toLabel(exampleColumn.value, "Class") : exampleColumn.value), termType: exampleColumn.termType } } : {}),
    }];
  });
  const describe = rowColumns.flatMap((columns) => columns.length >= 3 ? [{ subject: columns[0], predicate: columns[1], object: columns[2] }] : []);
  const uris = new Map<string, { shortform?: string; label?: string }>();
  for (const columns of rowColumns) {
    for (const column of columns) {
      if (column.termType !== "uri") continue;
      const previous = uris.get(column.value);
      uris.set(column.value, {
        ...(column.shortform || previous?.shortform ? { shortform: column.shortform || previous?.shortform } : {}),
        ...(column.label || previous?.label ? { label: column.label || previous?.label } : {}),
      });
    }
  }
  return {
    sparql: getText("sparql"),
    viewType: resultType,
    rows: rowColumns,
    complete: getText("complete") === "yes" ? "yes" : "no",
    incomplete: getText("complete") !== "yes" || sqlState === "S1TAT" || Boolean(warning),
	
	...(warning ? { warning } : {}),
...(sqlState ? { sqlState } : {}),
...(sqlMessage ? { sqlMessage } : {}),
...(execMilliseconds ? { execMilliseconds } : {}),
...(dbActivity ? { dbActivity } : {}),
	
    rowCount: Number(getText("processed") || rows.length),
    results: resultType === FCT_VIEW_TYPES.TEXT || resultType === FCT_VIEW_TYPES.LIST || resultType === FCT_VIEW_TYPES.LIST_COUNT ? results : [],
    properties: resultType === FCT_VIEW_TYPES.PROPERTIES ? facetItems : [],
    classes: resultType === FCT_VIEW_TYPES.CLASSES ? facetItems : [],
    roles: resultType === FCT_VIEW_TYPES.PROPERTIES_IN ? facetItems : [],
    graphs: resultType === FCT_VIEW_TYPES.GRAPHS ? rowColumns.flatMap((columns) => columns[0] ? [{
      uri: columns[0].value,
      label: columns[1]?.value || columns[0].label || columns[0].shortform || toLabel(columns[0].value),
      count: Number(columns[2]?.value ?? 0),
    }] : []) : [],
    describe: resultType === FCT_VIEW_TYPES.DESCRIBE ? describe : [],
    count: resultType === "count" ? Number(rowColumns[0]?.[0]?.value ?? 0) : undefined,
    shortforms: Array.from(uris, ([uri, metadata]) => ({ uri, ...metadata })),
  };
}

/**
 * Some raw graph-server errors are not actionable as-is. A Virtuoso ANYTIME timeout means the query ran into the
 * server's time limit; the raw text goes to the console and the UI tells the user what to change instead.
 */
function presentServerError(message: string): string {
  if (/ANYTIME\s+timeout/i.test(message)) {
    console.error("Maestro: the graph server reported an ANYTIME timeout.", message);
    return `The graph server reported an ANYTIME timeout (partial or no results). ${message} Check the query's complexity and the graph server's own timeout limit; a nonzero Maestro timeout does not override server limits.`;
  }
  return message;
}

/** Browser/undici fetch errors are often just "Failed to fetch"; say what actually failed. */
function facetLoadErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  if (/^(failed to fetch|fetch failed|load failed|network ?error)/i.test(message)) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    return `${message}${causeText ? `: ${causeText}` : ""} — the request to the Maestro server did not complete (server down, network interruption, or blocked request).`;
  }
  return presentServerError(message);
}

async function readFctResponse(response: Response): Promise<ParsedFctResponse> {
  const text = await response.text();
  const data = parseFctResponse(text);
  if (!response.ok) throw new Error(data.error || `FCT API returned HTTP ${response.status}.`);
  if (data.error) throw new Error(data.error);
  return data;
}

function groupValueKey(value: FctResult): string {
  return JSON.stringify([value.uri, value.termType ?? "uri", value.datatype ?? "", value.lang ?? ""]);
}

function fctTermKey(text: string, datatype?: string, lang?: string): string {
  return JSON.stringify([text, datatype ?? "uri", lang ?? ""]);
}

function facetValueKey(value: FctResult): string {
  const binding = groupValueBinding(value);
  // Literal results without an explicit datatype are FCT strings, not URIs.
  // Keep this key aligned with queryValueKey so a one-item literal facet
  // remains visibly checked after its checkbox is clicked.
  const datatype = binding.datatype ?? (binding.lang ? undefined : value.termType === "uri" ? "uri" : "string");
  return fctTermKey(binding.text, datatype, binding.lang);
}

function groupValueBinding(value: FctResult): {
  text: string;
  datatype?: string;
  lang?: string;
} {
  const isUri = value.termType === "uri";
  const datatype =
    value.datatype ===
    "http://www.openlinksw.com/schemas/facets/dtp/plainstring"
      ? "string"
      : value.datatype;

  return {
    text: value.uri,
    ...(isUri
      ? { datatype: "uri" }
      : datatype
        ? { datatype }
        : value.lang
          ? {}
          : { datatype: "string" }),
    ...(value.lang ? { lang: value.lang } : {}),
  };
}


type PersonalWidget = {
  uri: string;
  label: string;
  excluded: boolean;
  values: FctResult[];
  selectedValues: string[];
  page: number;
  loading: boolean;
  error: string;
};

type RelationshipDirection = "forward" | "reverse";
type ScopeRelationship = { uri: string; direction: RelationshipDirection };
type GroupByOption = ScopeRelationship & { key: string; label: string; nodeId: string; memberBindingNodeId?: string; ancestorRole?: boolean };

type GroupMembersState = { results: FctResult[]; count?: number; loading: boolean; error: string };
type RoleWidgetStatus = { count: number; loading: boolean; error: string };


/** Hover-only query inspector for any widget backed by an FCT or SPARQL request. */
function QueryInspectorButton({
  query,
  language = "xml",
  filename,
  label = "View query",
  countQuery,
  countFilename,
  extraQueries = [],
  headerTone = false,
  toolbarButton = false,
}: {
  query: string;
  language?: "xml" | "sparql";
  filename: string;
  label?: string;
  countQuery?: string | null;
  countFilename?: string;
  extraQueries?: { id: string; label: string; query: string; filename: string; language?: "xml" | "sparql" }[];
  headerTone?: boolean;
  toolbarButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("widget");
  if (!query.trim()) return null;
  const showingCount = Boolean(countQuery?.trim()) && activeTab === "count";
  const selectedExtraQuery = extraQueries.find((item) => item.id === activeTab);
  const displayedCode = showingCount ? countQuery! : selectedExtraQuery?.query ?? query;
  const displayedFilename = showingCount ? (countFilename ?? "first-item-count.sparql").replace(/\.xml$/i, ".sparql") : selectedExtraQuery?.filename ?? filename;
  const displayedLanguage = showingCount || selectedExtraQuery ? selectedExtraQuery?.language ?? "sparql" : language;
  const inspectorButton = (
    <button
      type="button"
      onClick={() => { setActiveTab("widget"); setOpen(true); }}
      aria-label={`${label}: ${filename}`}
      className={`inline-flex ${toolbarButton ? "size-7 rounded border" : "size-7 rounded border"} shrink-0 items-center justify-center ${toolbarButton ? "" : "opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100"} ${headerTone ? "border-sky-700 bg-sky-800 text-sky-50 hover:bg-sky-700 hover:text-sky-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100 dark:hover:bg-sky-900" : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}
    >
      <Code2 className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <>
      {toolbarButton ? (
        <Tooltip>
          <TooltipTrigger render={inspectorButton} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger render={inspectorButton} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-label={`${label}: ${filename}`} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden p-3">
            <header className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Query inspector</h2>
                <p className="text-xs text-muted-foreground">Inspect the request used to populate this widget.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent" aria-label="Close query viewer"><X className="size-4" /></button>
            </header>
            {(countQuery?.trim() || extraQueries.length > 0) && (
              <div role="tablist" aria-label="Widget queries" className="mb-3 flex flex-wrap gap-1 border-b">
                <button type="button" role="tab" aria-selected={activeTab === "widget"} onClick={() => setActiveTab("widget")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "widget" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{countQuery?.trim() ? "Results SPARQL" : "FCT query"}</button>
                {countQuery?.trim() && <button type="button" role="tab" aria-selected={activeTab === "count"} onClick={() => setActiveTab("count")} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === "count" ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>Count SPARQL query</button>}
                {extraQueries.map((item) => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} onClick={() => setActiveTab(item.id)} className={`rounded-t-md px-3 py-2 text-sm ${activeTab === item.id ? "border border-b-0 bg-background font-medium" : "text-muted-foreground hover:bg-accent/50"}`}>{item.label}</button>)}
              </div>
            )}
            <p className="mb-2 text-xs text-muted-foreground">{displayedFilename} · {displayedLanguage.toUpperCase()}</p>
            <CodeBlock className="min-h-0 flex-1" code={displayedCode} language={displayedLanguage} filename={displayedFilename} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Build the exact count query used as the identity for a candidate's live-scope count. */
function distinctCountQueryFor(
  tree: FctQueryTree,
  kind: DistinctCountKind,
  uri: string,
  propertyUri?: string,
  candidateValue?: FctResult,
): string {
  const viewType =
    kind === "property" ? FCT_VIEW_TYPES.PROPERTIES
      : kind === "role" ? FCT_VIEW_TYPES.PROPERTIES_IN
        : kind === "class" ? FCT_VIEW_TYPES.CLASSES
          : FCT_VIEW_TYPES.LIST_COUNT;
  return buildFctCountSparql(
    createDistinctCountQuery(tree, kind, uri, propertyUri, candidateValue, viewType),
  ) ?? "";
}

/** Each visible item requests its own distinct-row count through the same-origin SPARQL proxy. */
function DistinctCount({
  tree,
  kind,
  uri,
  propertyUri,
  candidateValue,
  onCountChange,
}: {
  tree: FctQueryTree;
  kind: DistinctCountKind;
  uri: string;
  propertyUri?: string;
  candidateValue?: FctResult;
  onCountChange?: (query: string, count: number | null) => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Key this effect by the compiled scalar count query, not the full browsing
  // query. The compiler deliberately ignores <view> limit/offset, so Results
  // pagination does not refetch every facet count.
  const countSparqlQuery = distinctCountQueryFor(
    tree, kind, uri, propertyUri, candidateValue,
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadCount() {
      let stage = "building scalar count SPARQL from the query tree";
      let responseDiagnostics: unknown;
      try {
        if (!countSparqlQuery) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        stage = "executing scalar count SPARQL";
        const sparqlResponse = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("distinct-count-sparql", `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`) },
          body: JSON.stringify({ facetValueCount: { sparql: countSparqlQuery } }),
          signal: controller.signal,
        });
        const sparqlData = await sparqlResponse.json();
        responseDiagnostics = sparqlData;
        if (!sparqlResponse.ok) {
          throw new Error(sparqlData.error ?? "Failed to execute the item count against SPARQL.");
        }
        stage = "validating scalar count response";
        const parsedCount = Number(sparqlData.count);
        if (!Number.isFinite(parsedCount) || parsedCount < 0) {
          throw new Error("The SPARQL endpoint returned an invalid item count.");
        }
        if (!cancelled) {
          setCount(parsedCount);
          onCountChange?.(countSparqlQuery, parsedCount);
        }
      } catch (requestError) {
        if (
          cancelled ||
          (requestError instanceof Error && requestError.name === "AbortError")
        )
          return;
        const message = requestError instanceof Error ? requestError.message : "Could not load distinct count.";
        console.warn("Maestro facet item count failed", {
          kind,
          uri,
          propertyUri,
          stage,
          error: message,
          component: `DistinctCount:${kind}:${propertyUri ?? ""}:${uri}`,
          sparql: countSparqlQuery,
          proxyResponse: responseDiagnostics,
          cause: requestError instanceof Error ? requestError.cause : undefined,
        });
        setError(`${stage}: ${presentServerError(message)}`);
      }
    }

    // Query-tree edits can be emitted as a short sequence of intermediate states
    // (for example, deleting a bespoke facet). Wait for that sequence to settle so
    // one user action does not issue/flicker through several obsolete count queries.
    console.info("Maestro DistinctCount effect scheduled", {
      kind,
      uri,
      propertyUri,
      countSparqlLength: countSparqlQuery?.length ?? 0,
      countQueryFingerprint: countSparqlQuery ? proxyDebugFingerprint(countSparqlQuery) : "unsupported-query-tree",
    });
    const refreshTimer = window.setTimeout(() => {
      if (cancelled) return;
      console.info("Maestro DistinctCount request starting", { kind, uri, propertyUri });
      // Keep the last completed count visible while this independent count query refreshes.
      setError("");
      void loadCount();
    }, 45);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      controller.abort();
      console.info("Maestro DistinctCount effect cleaned up", { kind, uri, propertyUri });
    };
    // The compiled scalar count query is the semantic identity. Results paging,
    // parent object identity, and other non-count UI changes do not restart it.
  }, [countSparqlQuery]);

  return (
    <Tooltip><TooltipTrigger render={<span
      className={`shrink-0 text-xs ${error || count === 0 ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
      aria-invalid={count === 0 ? true : undefined}
    >
      {error
        ? "!"
        : count === null
          ? "…"
          : shortenCount(count)}
    </span>} /><TooltipContent>{error
          ? `Could not load distinct count: ${error}`
          : kind === "property"
            ? "Distinct property values"
            : kind === "role"
              ? "Distinct role values"
              : "Distinct results"}</TooltipContent></Tooltip>
  );
}

/** Return property filters that are actual siblings of the active <view>.
 * Scope is represented by the query tree itself: recurse through each node's
 * children until the array containing the active view is found, then inspect
 * only that array. Ancestors on the navigation path are not scope members.
 */
function getActiveViewPropertyFilters(tree: FctQueryTree): FctQueryNode[] {
  function findViewSiblings(nodes: FctQueryNode[]): FctQueryNode[] | null {
    if (nodes.some((node) => node.id === "query-view")) return nodes;
    for (const node of nodes) {
      const nested = findViewSiblings(node.children);
      if (nested) return nested;
    }
    return null;
  }
  return (findViewSiblings(tree.children) ?? []).filter((node) =>
    node.name === "property" && typeof node.attributes.iri === "string" && node.attributes.iri.length > 0,
  );
}

/** Return reverse-property filters attached to the active view's scope only.
 * Ancestor <property-of> nodes are navigation breadcrumbs, not filters for the
 * current result set; every direct <property-of> child of the view scope
 * is a candidate, including an existing relationship marked src="shacl".
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
    (node) => node.name === "property-of" &&
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

/**
 * Canonical Group By ordering, used by BOTH the Results group cards and the Personal facet widget that is being
 * grouped on: facet-equivalent count (column 2) descending, then label. One comparator keeps the two lists in the
 * same order, so a facet value always sits at the same position as its group card.
 */
function compareGroupValues(a: FctResult, b: FctResult): number {
  const aCount = Number(a.columns?.[1]?.value ?? 0);
  const bCount = Number(b.columns?.[1]?.value ?? 0);
  return bCount - aCount || (a.title || a.uri).localeCompare(b.title || b.uri);
}

/** Each widget owns a real subscription to the authoritative query store. */
function PersonalWidgetQueryListener({
  propertyUri,
  sortByCount,
  limit,
  groupBy,
  setPersonalWidgets,
  endpointReady,
  refreshRevision,
}: {
  propertyUri: string;
  sortByCount: boolean;
  endpointReady: boolean;
  refreshRevision: number;
  limit: number;
  /** When this facet is the active Group By, run the exact query the Results group pane runs. */
  groupBy?: { option: GroupByOption; limit: number };
  setPersonalWidgets: Dispatch<SetStateAction<PersonalWidget[]>>;
}) {
  const { tree } = useFctQuery();
  const widgetTree = createPropertyWidgetQuery(tree, propertyUri, "forward", undefined, true);
  const widgetQueryXml = groupBy
    ? serializeFctQuery(createGroupValuesQuery(tree, groupBy.option, { limit: groupBy.limit, offset: 0 }))
    : serializeFctQuery(setQueryViewAttributes(widgetTree, { sort: sortByCount ? "count" : "", limit: String(limit) }));
  const orderLikeGroups = Boolean(groupBy);

  useEffect(() => {
    // A restored query can mount this widget before its graph server is loaded.
    // Never dispatch speculative FCT requests during endpoint initialization.
    if (!endpointReady) return;
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
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-widget-values", `PersonalWidgetQueryListener:${propertyUri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok)
          throw new Error(data.error ?? `Failed to load ${propertyUri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal:${propertyUri}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
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
          .map((child) => {
            const lang = child.attributes["xml:lang"];
            // FCT literal constraints default to datatype="string". If the
            // key defaults this missing datatype to "uri", a one-value
            // literal facet filters its only checkbox out after selection.
            const datatype = child.attributes.datatype ?? (lang ? undefined : "string");
            return fctTermKey(child.text ?? "", datatype, lang);
          });
        // Equality bindings can be matched by exact RDF-term identity.
        // For contains/regex/comparisons/ranges, the returned facet values
        // satisfy the predicate but need not equal its operand (e.g.
        // CONTAINS("1997-05-16", "1997")). Never drop those server matches.
        const valueBindings = (activeFilter?.children ?? []).filter((child) => child.name === "value");
        const equalityOnly = valueBindings.every((child) =>
          !Object.hasOwn(child.attributes, "rangeStart") &&
          !Object.hasOwn(child.attributes, "rangeEnd") &&
          ["", "=", "eq", "equal"].includes((child.attributes.op ?? "=").trim().toLowerCase()),
        );
        const filteredValues = equalityOnly && selectedTerms.length
          ? fetchedValues.filter((value) => selectedTerms.includes(facetValueKey(value)))
          : fetchedValues;
        const values = orderLikeGroups ? filteredValues.slice().sort(compareGroupValues) : filteredValues;
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
  }, [widgetQueryXml, propertyUri, setPersonalWidgets, orderLikeGroups, endpointReady, refreshRevision]);

  return null;
}

/** Loads and renders the value list for a selected reverse-role facet in Filters. */
function PersonalRoleWidget({
  tree,
  roleNode,
  label,
  isGroupByRole,
  groupBy,
  limit,
  onGroupValueClick,
  setRoleWidgetStatuses,
  endpointReady,
  refreshRevision,
}: {
  tree: FctQueryTree;
  roleNode: FctQueryNode;
  label: string;
  isGroupByRole: boolean;
  /** When this role is the active Group By, run the exact query the Results group pane runs. */
  groupBy?: { option: GroupByOption; limit: number };
  limit: number;
  onGroupValueClick: (value: FctResult) => void;
  setRoleWidgetStatuses: Dispatch<SetStateAction<Record<string, RoleWidgetStatus>>>;
  endpointReady: boolean;
  refreshRevision: number;
}) {
  const { setRoleValue } = useFctQuery();
  const uri = roleNode.attributes.iri ?? "";
  const [values, setValues] = useState<FctResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  // Counts are keyed by the full compiled query, so a new live query scope can
  // never accidentally reuse a candidate's stale count from the prior scope.
  const [candidateCounts, setCandidateCounts] = useState<Record<string, number | null>>({});

  const unconstrainedTree: FctQueryTree = {
    ...tree,
    children: tree.children.map(function removeSelectedRoleValues(node): FctQueryNode {
      return {
        ...node,
        attributes: { ...node.attributes },
        children: node.id === roleNode.id
          ? node.children.filter((child) => child.name !== "value").map((child) => ({ ...child, attributes: { ...child.attributes }, children: child.children.map((nested) => ({ ...nested, attributes: { ...nested.attributes }, children: nested.children })) }))
          : node.children.map(removeSelectedRoleValues),
      };
    }),
  };
  const roleWidgetTree = createPropertyWidgetQuery(unconstrainedTree, uri, "reverse", roleNode.id, true);
  const widgetQueryXml = groupBy
    ? serializeFctQuery(createGroupValuesQuery(tree, groupBy.option, { limit: groupBy.limit, offset: 0 }))
    : serializeFctQuery(setQueryViewAttributes(
      roleWidgetTree,
      { ...(isGroupByRole ? { sort: "count" } : { sort: "" }), limit: String(limit) },
    ));
  const roleOrderLikeGroups = Boolean(groupBy);
  const selectedKeys = (roleNode.children ?? [])
    .filter((child) => child.name === "value" && Boolean(child.text))
    .map((child) => fctTermKey(child.text ?? "", child.attributes.datatype, child.attributes["xml:lang"]));

  // Publish this widget's own result count and request status to its header.
  // The global Roles facet list is a different query and can have a different count.
  useEffect(() => {
    const nextStatus: RoleWidgetStatus = { count: values.length, loading, error };
    setRoleWidgetStatuses((current) => {
      const previous = current[roleNode.id];
      return previous && previous.count === nextStatus.count && previous.loading === nextStatus.loading && previous.error === nextStatus.error
        ? current
        : { ...current, [roleNode.id]: nextStatus };
    });
  }, [roleNode.id, values.length, loading, error, setRoleWidgetStatuses]);

  useEffect(() => {
    if (!uri || !endpointReady) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function loadValues() {
      try {
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("personal-role-widget-values", `PersonalRoleWidget:${uri}`) },
          body: widgetQueryXml,
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!response.ok) throw new Error(data.error ?? `Failed to load role values for ${uri}.`);
        if (!cancelled) setMaestroIncompleteResults(`personal-role:${uri}`, { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        const fetchedRaw = Array.isArray(data.results) ? data.results as FctResult[] : [];
        const fetched = roleOrderLikeGroups ? fetchedRaw.slice().sort(compareGroupValues) : fetchedRaw;
        if (cancelled) return;
        setValues((current) => current.length === fetched.length && current.every((item, index) => item.uri === fetched[index]?.uri && item.datatype === fetched[index]?.datatype && item.lang === fetched[index]?.lang) ? current : fetched);
        setPage((current) => Math.min(current, Math.max(0, Math.ceil(fetched.length / 10) - 1)));
      } catch (requestError) {
        if (cancelled || (requestError instanceof Error && requestError.name === "AbortError")) return;
        setError(presentServerError(requestError instanceof Error ? requestError.message : "Failed to load role values."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadValues();
    return () => { cancelled = true; controller.abort(); };
  }, [uri, widgetQueryXml, tree, roleOrderLikeGroups, endpointReady, refreshRevision]);

  const visibleValues = values.filter((value) => {
    const binding = groupValueBinding(value);
    const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value);
    const count = candidateCounts[countQuery];
    const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
    // Keep a selected value available to uncheck even if the current query has
    // become empty; hide only confirmed zero-count alternatives.
    return selectedKeys.includes(valueKey) || count !== 0;
  });
  const pageCount = Math.max(1, Math.ceil(visibleValues.length / 10));
  const pageValues = visibleValues.slice(page * 10, (page + 1) * 10);
  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {loading && <p className="px-2 py-1 text-xs text-muted-foreground" aria-live="polite">Updating…</p>}
      {error && <Tooltip><TooltipTrigger render={<p className="px-2 py-1 text-xs text-destructive">Update failed: {error}</p>} /><TooltipContent>{error}</TooltipContent></Tooltip>}
      {!loading && !error && visibleValues.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No matching values for this role.</p>}
      {visibleValues.length > 10 && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1 text-xs">
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span className="text-muted-foreground">{page + 1}/{pageCount}</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-accent disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      )}
      <div className={`${FACET_ITEM_GAP_CLASS} ${loading ? "opacity-45" : ""}`}>
        {pageValues.map((value, valueIndex) => {
          const binding = groupValueBinding(value);
          const valueKey = fctTermKey(binding.text, binding.datatype, binding.lang);
          const countQuery = distinctCountQueryFor(tree, "value", value.uri, uri, value);
          const isZeroCount = candidateCounts[countQuery] === 0;
          return (
            <div key={`${value.uri}:${value.datatype ?? ""}:${value.lang ?? ""}`} className={`flex w-full items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 ${isGroupByRole ? "" : "cursor-pointer"}`}>
              <input id={`personal-role-value-${roleNode.id}-${valueIndex}`} type="checkbox" disabled={loading} checked={selectedKeys.includes(valueKey)} onChange={(event) => setRoleValue(uri, { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) }, event.currentTarget.checked)} className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} aria-label={`Filter ${label} by ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`} />
              {isGroupByRole ? (
                <Tooltip><TooltipTrigger render={<button type="button" onClick={() => onGroupValueClick(value)} className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}>{value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}</button>} /><TooltipContent>{`Scroll to group ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`}</TooltipContent></Tooltip>
              ) : (
                <label htmlFor={`personal-role-value-${roleNode.id}-${valueIndex}`} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                  {value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}
                </label>
              )}
              <DistinctCount
                tree={tree}
                kind="value"
                uri={value.uri}
                propertyUri={uri}
                candidateValue={value}
                onCountChange={(query, count) =>
                  setCandidateCounts((current) =>
                    current[query] === count ? current : { ...current, [query]: count },
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
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

type EndpointStatus = {
  id: string;
  status: number | null;
  state: "ok" | "server-error" | "http-error" | "timeout" | "unreachable";
  testedUrl?: string;
  attempts?: Array<{ url: string; status: number | null; state: string }>;
};
type EndpointOption = { id: string; label: string; url: string; group: string; schemeInferred?: boolean };

function EndpointStatusIcon({ status }: { status?: EndpointStatus }) {
  // Distinguish "not yet polled" from a completed probe without an HTTP response.
  if (!status) return <BadgeQuestionMark aria-label="Not yet polled" className="size-4 shrink-0 text-muted-foreground" />;
  const httpStatus = status.status;
  if (httpStatus === 200) return <BadgeCheck aria-label="HTTP 200 OK" className="size-4 shrink-0 text-green-600" />;
  if (httpStatus !== null && httpStatus >= 500) return <BadgeX aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-red-600" />;
  if (httpStatus !== null && httpStatus >= 400) return <BadgeAlert aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-orange-500" />;
  // A failed probe with no HTTP response must not be mistaken for "never polled".
  if (httpStatus === null) return <BadgeAlert aria-label={`Graph server ${status.state}`} className="size-4 shrink-0 text-orange-500" />;
  return <BadgeQuestionMark aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-muted-foreground" />;
}

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
const AUTO_CONFIGURED_FACETS_STORAGE_KEY = "maestro:auto-configured-facets:v1";
/** Auto-configure registry: the live query's exclude boolean for each facet URI. */
const FACET_EXCLUDE_STORAGE_KEY = "maestro:facet-exclude:v1";

type FacetExcludeRegistry = {
  property: Record<string, boolean>;
  "property-in": Record<string, boolean>;
};

function readFacetExcludeRegistry(): FacetExcludeRegistry {
  const empty: FacetExcludeRegistry = { property: {}, "property-in": {} };
  try {
    const raw = window.localStorage.getItem(FACET_EXCLUDE_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<FacetExcludeRegistry>;
    const clean = (value: unknown): Record<string, boolean> =>
      value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, flag]) => typeof flag === "boolean")) as Record<string, boolean>
        : {};
    return { property: clean(parsed.property), "property-in": clean(parsed["property-in"]) };
  } catch {
    return empty;
  }
}

/** Record the exclude boolean read from the live query's node for this facet. */
function recordFacetExclude(kind: "property" | "property-in", uri: string, excluded: boolean) {
  try {
    const registry = readFacetExcludeRegistry();
    if (registry[kind][uri] === excluded) return;
    registry[kind][uri] = excluded;
    window.localStorage.setItem(FACET_EXCLUDE_STORAGE_KEY, JSON.stringify(registry));
  } catch (error) {
    // Browsing and filtering must continue when localStorage is unavailable.
    console.error("[Maestro Auto-configure] Could not persist facet exclude flag.", error);
  }
}

function isFacetExcludeRecorded(kind: "property" | "property-in", uri: string): boolean {
  return readFacetExcludeRegistry()[kind][uri] === true;
}

type AutoConfiguredFacetKey = string;

function readAutoConfiguredFacetKeys(): AutoConfiguredFacetKey[] {
  try {
    const raw = window.localStorage.getItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

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
  } catch (error) {
    // Browsing and filtering must continue when localStorage is unavailable.
    console.error("[Maestro Auto-configure] Could not persist facet addition count.", error);
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
  const nextUris = Array.from(new Set(uris));
  try {
    const candidates = readFacetAutofillCandidates();
    // Avoid storage churn when the current-scope candidate list did not change.
    const previousUris = candidates[kind];
    if (previousUris.length !== nextUris.length || previousUris.some((uri, index) => uri !== nextUris[index])) {
      candidates[kind] = nextUris;
      window.localStorage.setItem(FACET_AUTOFILL_STORAGE_KEY, JSON.stringify(candidates));
    }
    return nextUris;
  } catch {
    // Browsing and filtering must continue when localStorage is unavailable.
    return nextUris;
  }
}

const RDF_TYPE_URI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
// Movie/Film release metadata is fetched alongside rdf:type so the release
// year is available even when no release-date facet was selected.
const MOVIE_RELEASE_PROPERTIES = [
  "http://dbpedia.org/ontology/releaseDate",
  "http://dbpedia.org/property/released",
  "http://schema.org/datePublished",
  "http://dbpedia.org/ontology/releaseYear",
  "http://dbpedia.org/property/releaseDate",
  "http://dbpedia.org/property/year",
] as const;
const MOVIE_CLASS_IRIS = new Set([
  "http://dbpedia.org/ontology/Film",
  "http://schema.org/Movie",
  "https://schema.org/Movie",
  "http://schema.org/Film",
]);
const releaseYearFromText = (text: string): string | null => {
  // ISO dates, date-time literals and year-only values; avoid arbitrary digits
  // embedded inside identifiers or numerical measurements.
  const match = text.match(/(?:^|\D)((?:18|19|20|21)\d{2})(?=\D|$)/);
  return match?.[1] ?? null;
};


/** Cap example ("e.g.") text at a character limit so one long value cannot stretch a row or badge. */
function ellipsize(text: string, limit = 40): string {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("").trimEnd()}…` : characters.join("");
}
const GROUP_BY_FACET_HIGHLIGHT_CLASSES = "border-sky-300 bg-sky-100/80 dark:border-sky-800 dark:bg-sky-950/50";

type ShareableUiState = {
  selectedFacet?: FacetName;
  propertiesPage?: number;
  classesPage?: number;
  graphsPage?: number;
  rolesPage?: number;
  findEndpointsEnabled?: boolean;
  centralTab?: "results" | "groups" | "query-tree" | "view-query" | "chat";
  workspaceTab?: "browse" | "view" | "analyze";
  /** Explicit state for the Results/Query toolbar toggle. */
  queryToggle?: boolean;
  showResultBadges?: boolean;
  /** Explicit state for the Badges toolbar toggle. */
  badgesToggle?: boolean;
  querySourceFormat?: "xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "response";
  defaultLeftTab?: "facets" | "personal" | "community";
  focusListOrder?: "Properties" | "Roles";
  focusWidgetsSuppressed?: boolean;
  groupByPropertyUri?: string;
  resultsUiPage?: number;
  groupUiPage?: number;
  groupBatchSize?: number;
  groupBatchOffset?: number;
  resultsPageSize?: number;
  selectedUri?: string;
  graphText?: string;
  rdfSourceUrl?: string;
  rdfTargetGraph?: string;
  /** Root breadcrumb signal (URI / Name / All fields / Clear Terms). */
  selectedSignalMode?: "uri" | "name" | "all" | "clear";
  /** The text currently shown in the root breadcrumb field (URI or search term, depending on the signal). */
  searchDraft?: string;
  /** Last text-search term retained while another signal is active. */
  savedSearchDraft?: string;
  /** Last fixed-subject URI retained independently from the text-search term. */
  savedUriDraft?: string;
  /** Selected name/label predicates, retained even while another signal is active. */
  selectedNamePropertyUris?: string[];
  /** Backward-compatible single-predicate state from older shared URLs. */
  selectedNamePropertyUri?: string;
  /** Metadata badge view mode: records (default) or classes. */
  breadcrumbBadgeMode?: "records" | "classes";
};

/** Read the graph-server URI from the query's authoritative addr attribute. */
function readGraphServerFromQueryXml(xml: string | null | undefined): string | null {
  if (!xml || typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root?.localName !== "query") return null;
  const address = root.getAttribute("addr") ?? "";
  const delimiter = address.indexOf("@");
  const graphServer = delimiter >= 0 ? address.slice(delimiter + 1).trim() : "";
  return graphServer || null;
}

function readShareableUiState(search?: string): ShareableUiState | null {
  if (typeof window === "undefined" && search === undefined) return null;
  const encodedState = new URLSearchParams(search ?? window.location.search).get("state");
  if (!encodedState) return null;
  try {
    const parsed: unknown = JSON.parse(encodedState);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ShareableUiState
      : null;
  } catch {
    return null;
  }
}

/** Parse the share URL's serialized FCT XML into a fresh tree with unique client-only node IDs. */
function parseFctQueryXml(xml: string): FctQueryTree | null {
  if (typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement?.localName !== "query") return null;
  const root = document.documentElement;
  const rootAttributes: Record<string, string> = {};
  for (const attribute of Array.from(root.attributes)) rootAttributes[attribute.name] = attribute.value;
  const usedIds = new Set<string>();
  let hasQueryText = false;
  let hasQueryView = false;
  const elementChildren = (element: Element) => Array.from(element.children);
  const parseNode = (element: Element, path: string, isRootChild: boolean): FctQueryNode => {
    const name = element.localName;
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) attributes[attribute.name] = attribute.value;
    const iri = attributes.iri ?? "";
    let id: string;
    if (name === "text" && isRootChild && !hasQueryText) {
      id = "query-text";
      hasQueryText = true;
    } else if (name === "view" && !hasQueryView) {
      id = "query-view";
      hasQueryView = true;
    } else if (name === "property" && iri) {
      const containsView = (candidate: Element): boolean => candidate.localName === "view" || elementChildren(candidate).some(containsView);
      id = `${containsView(element) ? "property-path" : "property-filter"}-${encodeURIComponent(iri)}-${path}`;
    } else if (name === "property-of" && iri) {
      id = `role-filter-${path}-${encodeURIComponent(iri)}`;
    } else if (name === "class" && iri) {
      id = `class-${path}-${encodeURIComponent(iri)}`;
    } else {
      id = `url-${path}-${name}`;
    }
    const baseId = id;
    let suffix = 1;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const children = name === "view" ? [] : elementChildren(element).map((child, index) => parseNode(child, `${path}.${index}`, false));
    const text = name === "text" || name === "value" ? (element.textContent ?? "") : undefined;
    return { id, name, attributes, ...(text !== undefined ? { text } : {}), children };
  };
  const children = elementChildren(root).map((child, index) => parseNode(child, String(index), true));
  if (!hasQueryView) {
    children.push({ id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.TEXT, limit: "30", offset: "0" }, children: [] });
  }
  return { name: "query", attributes: rootAttributes, children };
}

export default function Home() {
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [browserLogging, setBrowserLogging] = useState(false);
  const [browserLogLevel, setBrowserLogLevel] = useState<BrowserLogLevel>("debug");
  const [browserLogPreferencesLoaded, setBrowserLogPreferencesLoaded] = useState(false);
  useEffect(() => {
    void initializeMaestroStorage().then(() => {
      setBrowserLogging(maestroStorageGet("maestro-browser-logging") === "yes");
      const configured = maestroStorageGet("maestro-browser-log-level");
      if (["trace", "debug", "info", "warn", "error", "fatal"].includes(configured ?? ""))
        setBrowserLogLevel(configured as BrowserLogLevel);
      setBrowserLogPreferencesLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!browserLogPreferencesLoaded) return;
    configureMaestroBrowserLogging(browserLogging, browserLogLevel);
    maestroStorageSet("maestro-browser-logging", browserLogging ? "yes" : "no");
    maestroStorageSet("maestro-browser-log-level", browserLogLevel);
  }, [browserLogging, browserLogLevel, browserLogPreferencesLoaded]);
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [deleteHistoryDialogOpen, setDeleteHistoryDialogOpen] = useState(false);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  const [isLoadingHistoryQuery, setIsLoadingHistoryQuery] = useState(false);
  const [localStorageUsageBytes, setLocalStorageUsageBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!controlsSheetOpen) return;
    const refreshUsage = () => {
      try {
        setLocalStorageUsageBytes(getLocalStorageUsageBytes());
      } catch {
        setLocalStorageUsageBytes(null);
      }
    };
    refreshUsage();
    window.addEventListener("storage", refreshUsage);
    return () => window.removeEventListener("storage", refreshUsage);
  }, [controlsSheetOpen]);
  const [selectedUri, setSelectedUri] = useState("");
  const [urlStateInitialized, setUrlStateInitialized] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkDescription, setBookmarkDescription] = useState("");
  const [bookmarkTags, setBookmarkTags] = useState("");
  const [bookmarkTagVocabulary, setBookmarkTagVocabulary] = useState<"skos" | "dcterms" | "scot">("skos");
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [isQueryBookmarked, setIsQueryBookmarked] = useState(false);
  const [matchingBookmarkId, setMatchingBookmarkId] = useState("");
  const [bookmarkCheckRevision, setBookmarkCheckRevision] = useState(0);
  const [historyBookmarkId, setHistoryBookmarkId] = useState("");
  const [authSession, setAuthSession] = useState<PersonalAuthSession | null>(null);
  // Graph info card (opened from the info icon in the graph input group).
  const [graphInfoOpen, setGraphInfoOpen] = useState(false);
  const [graphInfo, setGraphInfo] = useState<{
    graph: string;
    subjectCount: number | null; subjectCountLoading: boolean; subjectCountError: string;
    access: boolean | null; accessLoading: boolean; accessError: string;
  }>({ graph: "", subjectCount: null, subjectCountLoading: false, subjectCountError: "", access: null, accessLoading: false, accessError: "" });
  const graphInfoRequestRef = useRef(0);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authRestoreIssue, setAuthRestoreIssue] = useState(false);
  const [authRestoreComplete, setAuthRestoreComplete] = useState(false);
  const [endpointReloadRevision, setEndpointReloadRevision] = useState(0);
  const [queryRefreshRevision, setQueryRefreshRevision] = useState(0);
  const [loginTab, setLoginTab] = useState<AuthType>("sparql-auth");
  const [loginGraphStore, setLoginGraphStore] = useState("http://demo.openlinksw.com/sparql");
  const [loginGraphPrefix, setLoginGraphPrefix] = useState("http://demo.openlinksw.com/ods/home/acme");
  const [loginUsername, setLoginUsername] = useState("acme");
  const [loginPassword, setLoginPassword] = useState("123456");
  const [loginShowPassword, setLoginShowPassword] = useState(false);
  const [loginOauthToken, setLoginOauthToken] = useState("");
  const [loginOauthProfileUrl, setLoginOauthProfileUrl] = useState("");
  const [loginOauthUserName, setLoginOauthUserName] = useState("");
  const [loginWebIdUri, setLoginWebIdUri] = useState("");
  const loginRememberMe = true;
  const [loginTesting, setLoginTesting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isFetchingAvatar, setIsFetchingAvatar] = useState(false);
  const [fetchedAvatarUrl, setFetchedAvatarUrl] = useState<string | null>(null);
  const [historyHasOlder, setHistoryHasOlder] = useState(false);
  const [historyHasNewer, setHistoryHasNewer] = useState(false);
  const [historyNavigationPending, setHistoryNavigationPending] = useState<"backward" | "forward" | null>(null);
  const [historyActionItems, setHistoryActionItems] = useState<Array<{ historyId: string; created: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null }>>([]);
  const [historyActionMenu, setHistoryActionMenu] = useState<"backward" | "forward" | null>(null);
  const historyHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDeletingCurrentHistory, setIsDeletingCurrentHistory] = useState(false);
  const bookmarkTitleInputRef = useRef<HTMLInputElement>(null);
  const historyVisitQueryRef = useRef("");
  const historyVisitIdRef = useRef("");
  const historyWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  // A template flush persists every edit but publishes just the final live query.
  const templateHistoryFlushRef = useRef(false);
  // While the pointer is over the search input, coalesce rapid query edits into
  // While the root breadcrumb search is expanded, coalesce changes into one in-memory snapshot.
  const pendingHistoryVisitRef = useRef<{ queryXml: string; stateUrl: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null } | null>(null);
  const [prefixSource, setPrefixSource] = useState<"prefixcc" | "zazuko" | "builtin">("prefixcc");
  const [prefixStatus, setPrefixStatus] = useState("Built-in prefixes");
  useEffect(() => {
    let active = true;
    const stored = maestroStorageGet("maestro-namespace-prefix-source");
    if (active && (stored === "prefixcc" || stored === "zazuko" || stored === "builtin")) setPrefixSource(stored);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (prefixSource === "builtin") {
      setNamespacePrefixSource({});
      setPrefixStatus("Built-in list only");
      return () => { active = false; };
    }
    setPrefixStatus("Loading namespace prefixes…");
    fetch(`/proxy/api/ontology/prefixes?source=${prefixSource}`, { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: { prefixes?: Record<string, string>; count?: number; note?: string }) => {
        if (!active) return;
        setNamespacePrefixSource(data.prefixes ?? {});
        setPrefixStatus(`${data.count ?? 0} community prefixes · ${data.note ?? "Built-in fallback"}`);
      })
      .catch(() => { if (active) { setNamespacePrefixSource({}); setPrefixStatus("Built-in prefixes (remote source unavailable)"); } });
    return () => { active = false; };
  }, [prefixSource]);
  const [fctEndpoints, setFctEndpoints] = useState<EndpointOption[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const activeBreadcrumbButtonRef = useRef<HTMLButtonElement | null>(null);
  const [endpointStatuses, setEndpointStatuses] = useState<
    Record<string, EndpointStatus>
  >({});
  // Only the selected endpoint's health may affect active query effects. A
  // different endpoint finishing its health check must not restart these loads.
  const selectedEndpointStatus = selectedEndpointId ? endpointStatuses[selectedEndpointId] : undefined;
  const [isCheckingEndpoints, setIsCheckingEndpoints] = useState(false);
  const [checkingEndpointIds, setCheckingEndpointIds] = useState<Record<string, boolean>>({});
  const [endpointChecksCompleted, setEndpointChecksCompleted] = useState(0);
  const [endpointChecksTotal, setEndpointChecksTotal] = useState(0);
  const [endpointMenuError, setEndpointMenuError] = useState("");
  const [endpointHealthToast, setEndpointHealthToast] = useState<{ endpointId: string; message: string } | null>(null);
  const [isRefreshingFailedEndpoint, setIsRefreshingFailedEndpoint] = useState(false);
  // A fresh 200 from an FCT query proves that its *own* graph server is
  // responding. Recover a non-green status once, without updating green on
  // every request or treating 4xx/5xx as a connectivity failure.
  useEffect(() => {
    const onSuccess = (event: Event) => {
      const endpointUrl = (event as CustomEvent<{ endpointUrl?: string }>).detail?.endpointUrl;
      if (!endpointUrl) return;
      const endpoint = fctEndpoints.find((item) => item.id === selectedEndpointId);
      if (!endpoint || endpoint.url !== endpointUrl) return;
      setEndpointStatuses((current) => {
        const previous = current[endpoint.id];
        if (previous?.state === "ok" && previous.status === 200) return current;
        return { ...current, [endpoint.id]: {
          id: endpoint.id, status: 200, state: "ok", testedUrl: endpoint.url,
        } };
      });
    };
    window.addEventListener(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, onSuccess);
    return () => window.removeEventListener(MAESTRO_GRAPH_SERVER_REQUEST_SUCCESS, onSuccess);
  }, [fctEndpoints, selectedEndpointId]);

  const [selectedFacet, setSelectedFacet] = useState<FacetName>("Properties");
  const [propertiesPage, setPropertiesPage] = useState(0);
  const [classesPage, setClassesPage] = useState(0);
  const [graphsPage, setGraphsPage] = useState(0);
  const [graphSort, setGraphSort] = useState<"count-desc" | "count-asc" | "label-asc" | "label-desc">("count-desc");
  const [graphSortPickerExpanded, setGraphSortPickerExpanded] = useState(false);
  const [graphListSparql, setGraphListSparql] = useState("");
  const [graphText, setGraphText] = useState("");
  const [graphNavigationHistory, setGraphNavigationHistory] = useState<string[]>([""]);
  const [graphNavigationIndex, setGraphNavigationIndex] = useState(0);
  const restoredGraphTextRef = useRef<string | null>(null);
  const [findEndpointsEnabled, setFindEndpointsEnabled] = useState(false);
  const [centralTab, setCentralTab] = useState<"results" | "groups" | "query-tree" | "view-query" | "chat">("results");
  const [workspaceTab, setWorkspaceTab] = useState<"browse" | "view" | "analyze">("browse");
  // The URL's top-level tab takes precedence from the first client paint.
  // A layout effect runs before the browser paints, avoiding a flash of Browse
  // while the full query and shareable UI state are still being restored.
  useLayoutEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "browse" || requestedTab === "view" || requestedTab === "analyze") {
      setWorkspaceTab(requestedTab);
    }
  }, []);
  type AnalysisDefinition = { uri: string; label: string; icon: string; stylesheet: string; order: number };
  // XSLT controls presentation only. It never supplies callbacks, event attributes,
  // breadcrumb mutation logic, or badge navigation logic.
  type AnalysisCell = { values: string[]; checked: boolean; badgeStyle: CSSProperties; cellStyle: CSSProperties };
  type AnalysisTable = { trailStyle: CSSProperties; tableStyle: CSSProperties; headerStyle: CSSProperties; cellStyle: CSSProperties; rowStyle: CSSProperties; columns: { kind: string; nodeId: string; label: string; breadcrumbStyle: CSSProperties; headerStyle: CSSProperties }[]; rows: { uri: string; label: string; cells: AnalysisCell[] }[] };
  function analysisPresentationStyle(raw: string | null): CSSProperties {
    const permitted: Record<string, keyof CSSProperties> = {
      "background-color": "backgroundColor", "color": "color", "font-size": "fontSize",
      "font-weight": "fontWeight", "font-style": "fontStyle", "text-align": "textAlign",
      "border-radius": "borderRadius", "padding": "padding", "opacity": "opacity",
      "border-color": "borderColor", "border-width": "borderWidth", "line-height": "lineHeight",
      "white-space": "whiteSpace", "vertical-align": "verticalAlign",
    };
    const output: Record<string, string> = {};
    for (const part of (raw ?? "").split(";")) {
      const index = part.indexOf(":");
      if (index < 1) continue;
      const key = permitted[part.slice(0, index).trim().toLowerCase()];
      const value = part.slice(index + 1).trim();
      // No URL expressions, CSS variables, positioning, or interactive styling.
      if (!key || !value || /url\s*\(|var\s*\(|[{}<>]/i.test(value)) continue;
      output[key] = value;
    }
    return output as CSSProperties;
  }
  const [analysisDefinitions, setAnalysisDefinitions] = useState<AnalysisDefinition[]>([]);
  const [selectedAnalysisUri, setSelectedAnalysisUri] = useState("");
  const [analysisTable, setAnalysisTable] = useState<AnalysisTable | null>(null);
  // Width is keyed by the real facet node / value rather than its position, so
  // adding a column does not reset unrelated columns in either analysis table.
  const [analysisColumnWidths, setAnalysisColumnWidths] = useState<Record<string, number>>({});
  function beginAnalysisColumnResize(event: ReactPointerEvent<HTMLSpanElement>, key: string, width: number) {
    event.preventDefault();
    event.stopPropagation();
    const origin = event.clientX;
    const update = (move: PointerEvent) => setAnalysisColumnWidths((current) => ({
      ...current, [key]: Math.max(88, Math.min(900, width + move.clientX - origin)),
    }));
    const finish = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }
  // Analyze-only selection. Stored against the visible page so changes of
  // query or pagination cannot accidentally select different results.
  const [analysisSelection, setAnalysisSelection] = useState<{ pageKey: string; keys: string[] }>({ pageKey: "", keys: [] });
  const [analysisError, setAnalysisError] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const analysisRenderedBaseRef = useRef("");
  const [analysisValuesState, setAnalysisValuesState] = useState<{ requestKey: string; byUri: Map<string, ScopeValue[]> } | null>(null);
  const [analysisValuesError, setAnalysisValuesError] = useState("");
  const [compareFacet, setCompareFacet] = useState("");
  // Histogram reuses Compare Table's exact boolean cells; it is a presentation,
  // not another FCT query, XSLT template, or numeric-bin calculation.
  const [analyzeHistogram, setAnalyzeHistogram] = useState(false);
  const [assistantPromptDraft, setAssistantPromptDraft] = useState("");
  const [assistantPendingPrompt, setAssistantPendingPrompt] = useState<{ id: number; text: string } | null>(null);
  const assistantPromptIdRef = useRef(0);
  // The Query Tree is its own pane under the results, not a replacement tab.
  const [queryTreeOpen, setQueryTreeOpen] = useState(false);
  const [queryTreeHeightPercent, setQueryTreeHeightPercent] = useState(40);
  const [queryTreeHeightLoaded, setQueryTreeHeightLoaded] = useState(false);
  const [recordFormatEnabled, setRecordFormatEnabled] = useState(false);
  const [recordFormatPreferenceLoaded, setRecordFormatPreferenceLoaded] = useState(false);
  const queryTreeHeightDbRef = useRef<IDBDatabase | null>(null);
  const centralPaneRef = useRef<HTMLElement | null>(null);
  const [showResultBadges, setShowResultBadges] = useState(false);
  const [orderResults, setOrderResults] = useState(false);
  const [breadcrumbBadgeMode, setBreadcrumbBadgeMode] = useState<"records" | "classes">("records");
  const [hoveredBreadcrumbBadgeId, setHoveredBreadcrumbBadgeId] = useState<string | null>(null);
  const [openBreadcrumbDropdownId, setOpenBreadcrumbDropdownId] = useState<string | null>(null);
  const [shiftKeyDown, setShiftKeyDown] = useState(false);
  const [hoveredFacetKey, setHoveredFacetKey] = useState<string | null>(null);

  const toggleBreadcrumbBadgeMode = useCallback(() => {
    setBreadcrumbBadgeMode((current) => {
      const next = current === "records" ? "classes" : "records";
      maestroStorageSet("maestro-breadcrumb-badge-mode", next);
      return next;
    });
  }, []);

// This tracks the Shift key and hovered row
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Shift") setShiftKeyDown(true);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Shift") setShiftKeyDown(false);
  };

  const handleWindowBlur = () => setShiftKeyDown(false);

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleWindowBlur);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleWindowBlur);
  };
}, []);

  // Keep the draggable Query Tree pane height and order-results toggle in IndexedDB.
  useEffect(() => {
    void initializeMaestroStorage().then(() => {
      const saved = maestroStorageGet("maestro-order-results");
      if (saved !== null) {
        setOrderResults(saved === "yes" || saved === "true");
      }
      const savedBadgeMode = maestroStorageGet("maestro-breadcrumb-badge-mode");
      if (savedBadgeMode === "classes" || savedBadgeMode === "records") {
        setBreadcrumbBadgeMode((current) => {
          const stateObj = readShareableUiState(typeof window !== "undefined" ? window.location.search : "");
          if (stateObj?.breadcrumbBadgeMode) return stateObj.breadcrumbBadgeMode;
          return savedBadgeMode;
        });
      }
    });
    if (typeof window === "undefined" || !window.indexedDB) {
      setQueryTreeHeightLoaded(true);
      setRecordFormatPreferenceLoaded(true);
      return;
    }
    let cancelled = false;
    const request = window.indexedDB.open("maestro-ui-preferences", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences");
    };
    request.onsuccess = () => {
      const db = request.result;
      if (cancelled) { db.close(); return; }
      queryTreeHeightDbRef.current = db;
      const preferences = db.transaction("preferences", "readonly").objectStore("preferences");
      const read = preferences.get("query-tree-height-percent");
      const readFormat = preferences.get("record-format-enabled");
      const readOrder = preferences.get("order-results-enabled");
      read.onsuccess = () => {
        const value = Number(read.result);
        if (!cancelled && Number.isFinite(value) && value >= 15 && value <= 75) setQueryTreeHeightPercent(value);
        if (!cancelled) setQueryTreeHeightLoaded(true);
      };
      read.onerror = () => { if (!cancelled) setQueryTreeHeightLoaded(true); };
      readOrder.onsuccess = () => {
        if (!cancelled && typeof readOrder.result === "boolean") {
          setOrderResults(readOrder.result);
        }
      };
      readFormat.onsuccess = () => {
        if (!cancelled) {
          setRecordFormatEnabled(readFormat.result === true);
          setRecordFormatPreferenceLoaded(true);
        }
      };
      readFormat.onerror = () => { if (!cancelled) setRecordFormatPreferenceLoaded(true); };
    };
    request.onerror = () => {
      if (!cancelled) {
        setQueryTreeHeightLoaded(true);
        setRecordFormatPreferenceLoaded(true);
      }
    };
    return () => {
      cancelled = true;
      queryTreeHeightDbRef.current?.close();
      queryTreeHeightDbRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!queryTreeHeightLoaded || !queryTreeHeightDbRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const transaction = queryTreeHeightDbRef.current?.transaction("preferences", "readwrite");
        transaction?.objectStore("preferences").put(queryTreeHeightPercent, "query-tree-height-percent");
      } catch (error) {
        console.warn("Maestro could not persist Query Tree height in IndexedDB", error);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [queryTreeHeightPercent, queryTreeHeightLoaded]);

  // Restore personal authentication session on load.
  useEffect(() => {
    void (async () => {
      try {
        const session = await loadPersonalAuthSession();
        if (session) {
          setAuthSession(session);
          setAuthRestoreIssue(false);
          if (session.graphStore) {
            setLoginGraphStore(session.graphStore);
            setPersonalSparqlEndpoint(session.graphStore);
          }
          if (session.graphPrefix) setLoginGraphPrefix(session.graphPrefix);
          setLoginTab(session.authType);
          if (session.authType === "sparql-auth") {
            if (session.userName) setLoginUsername(session.userName);
            if (session.password) setLoginPassword(session.password);
          } else if (session.authType === "sparql-oauth") {
            if (session.oauthToken) setLoginOauthToken(session.oauthToken);
            if (session.oauthProfileUrl) setLoginOauthProfileUrl(session.oauthProfileUrl);
            if (session.userName) setLoginOauthUserName(session.userName);
          } else if (session.authType === "sparql-webid") {
            if (session.webIdUri) setLoginWebIdUri(session.webIdUri);
            if (session.oauthToken) setLoginOauthToken(session.oauthToken);
          }
          if (session.avatarUrl) setFetchedAvatarUrl(session.avatarUrl);
          // The initial menu load waits for session restoration. A browser
          // refresh is not a new login and must not trigger another load.
        }
        if (!session && window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") {
          // A previous login should exist, but neither persisted credentials nor
          // the long-lived proxy cookie could be restored. Keep the user informed.
          setAuthRestoreIssue(true);
        }
        // Not logged in: the page loads as usual, with no personal graph server logic (no History, Bookmarks, or store access).
      } catch (err) {
        console.warn("Could not load personal graph auth session", err);
        if (window.localStorage.getItem(AUTH_EXPECTED_KEY) === "1") setAuthRestoreIssue(true);
      } finally {
        // Only now may the registry be read. The session cookie has either
        // been restored or we've established this is an anonymous session.
        setAuthRestoreComplete(true);
      }
    })();
  }, []);

  // Renew the existing authenticated proxy cookie while the page stays open.
  // Never create a session here: only a restored or explicitly logged-in session qualifies.
  useEffect(() => {
    if (!authSession) return;
    const renew = () => setMaestroSessionCookie(authSession);
    window.addEventListener("focus", renew);
    document.addEventListener("visibilitychange", renew);
    // Keep the existing login cookie alive during a long-lived active Maestro tab.
    // This does not extend an OAuth token's provider-defined expiry or create a new login.
    const renewalTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") renew();
    }, 10 * 60 * 1000);
    return () => {
      window.clearInterval(renewalTimer);
      window.removeEventListener("focus", renew);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [authSession]);

  const handleFetchProfile = async () => {
    const targetUrl = loginTab === "sparql-oauth" ? loginOauthProfileUrl.trim() : loginWebIdUri.trim();
    if (!targetUrl) return;
    setIsFetchingAvatar(true);
    try {
      const response = await fetch("/proxy/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", profileUrl: targetUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch profile");
      if (data.avatarUrl) {
        setFetchedAvatarUrl(data.avatarUrl);
        toast.add({ title: "Avatar detected", description: "Successfully retrieved avatar image from profile.", type: "success" });
      }
      if (data.displayName && loginTab === "sparql-oauth" && !loginOauthUserName) {
        setLoginOauthUserName(data.displayName);
      }
    } catch (err) {
      toast.add({ title: "Could not fetch profile", description: err instanceof Error ? err.message : "Profile lookup failed", type: "error" });
    } finally {
      setIsFetchingAvatar(false);
    }
  };

  /** Live values from the login <form>; browsers can autofill fields without firing React onChange. */
  type LoginFormValues = { graphStore?: string; graphPrefix?: string; username?: string; password?: string };
  const readLoginFormValues = (form: HTMLFormElement | null): LoginFormValues => {
    if (!form) return {};
    const data = new FormData(form);
    const text = (name: string) => (data.has(name) ? String(data.get(name) ?? "") : undefined);
    return { graphStore: text("graph_store"), graphPrefix: text("graph_prefix"), username: text("username"), password: text("password") };
  };

  const buildCurrentSession = (form: LoginFormValues = {}): PersonalAuthSession => {
    const formGraphStore = form.graphStore ?? loginGraphStore;
    const formGraphPrefix = form.graphPrefix ?? loginGraphPrefix;
    const formUsername = form.username ?? loginUsername;
    const formPassword = form.password ?? loginPassword;
    let userName = "";
    let authHeader = "";
    let avatarUrl: string | undefined = undefined;

    if (loginTab === "sparql-auth") {
      userName = formUsername.trim() || "acme";
      const user = formUsername.trim();
      const pass = formPassword;
      if (user || pass) {
        authHeader = buildAuthHeader("sparql-auth", user, pass);
      }
      avatarUrl = undefined;
    } else if (loginTab === "sparql-oauth") {
      userName = loginOauthUserName.trim() || "OAuth User";
      const token = loginOauthToken.trim();
      if (token) {
        authHeader = buildAuthHeader("sparql-oauth", undefined, undefined, token);
      }
      avatarUrl = fetchedAvatarUrl || undefined;
    } else if (loginTab === "sparql-webid") {
      const uri = loginWebIdUri.trim();
      userName = uri.split("#").pop() || uri.split("/").filter(Boolean).pop() || "WebID User";
      const token = loginOauthToken.trim();
      authHeader = buildAuthHeader("sparql-webid", undefined, undefined, token, undefined, uri);
      avatarUrl = fetchedAvatarUrl || undefined;
    }

    return {
      authType: loginTab,
      graphStore: formGraphStore.trim() || "http://demo.openlinksw.com/sparql",
      graphPrefix: formGraphPrefix.trim() || "http://demo.openlinksw.com/ods/home/acme",
      userName,
      password: loginTab === "sparql-auth" ? formPassword : undefined,
      authHeader,
      oauthToken: loginTab === "sparql-oauth" ? loginOauthToken.trim() : (loginTab === "sparql-webid" ? loginOauthToken.trim() : undefined),
      oauthProfileUrl: loginTab === "sparql-oauth" ? loginOauthProfileUrl.trim() : undefined,
      webIdUri: loginTab === "sparql-webid" ? loginWebIdUri.trim() : undefined,
      avatarUrl,
      rememberMe: loginRememberMe,
    };
  };

  const handleTestConnection = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    const session = buildCurrentSession(readLoginFormValues(event?.currentTarget.form ?? null));
    setLoginTesting(true);
    setLoginError("");
    try {
      const response = await fetch("/proxy/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          authType: session.authType,
          graphStore: session.graphStore,
          authHeader: session.authHeader,
          graphPrefix: session.graphPrefix,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.connected) {
        throw new Error(data.error || "Connection test failed");
      }
      toast.add({
        title: "Connection test succeeded",
        description: `Connected to personal graph server (HTTP ${data.status}). History graph: ${graphForPrefix(session.graphPrefix)}`,
        type: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setLoginError(msg);
      toast.add({ title: "Connection failed", description: msg, type: "error" });
    } finally {
      setLoginTesting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formValues = readLoginFormValues(e.currentTarget);
    // Keep React state in step with what is actually in the fields.
    if (formValues.graphStore !== undefined) setLoginGraphStore(formValues.graphStore);
    if (formValues.graphPrefix !== undefined) setLoginGraphPrefix(formValues.graphPrefix);
    if (formValues.username !== undefined) setLoginUsername(formValues.username);
    if (formValues.password !== undefined) setLoginPassword(formValues.password);
    const session = buildCurrentSession(formValues);
    setLoginTesting(true);
    setLoginError("");
    try {
      const response = await fetch("/proxy/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          authType: session.authType,
          graphStore: session.graphStore,
          authHeader: session.authHeader,
          graphPrefix: session.graphPrefix,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.connected) {
        throw new Error(data.error || (data.status === 401 ? "Authentication failed: Invalid credentials or unauthorized." : "Could not connect to the personal graph server."));
      }
      // Persist the session first: this also sets the maestro_session cookie the proxy routes read.
      await savePersonalAuthSession(session, loginRememberMe);
      setAuthSession(session);
      setAuthRestoreIssue(false);
      setPersonalSparqlEndpoint(session.graphStore);
      setLoginDialogOpen(false);
      toast.add({
        title: "Connected",
        description: `Logged in as ${session.userName}. History set to ${graphForPrefix(session.graphPrefix)}`,
        type: "success",
      });

      // As soon as login succeeds, load every ./graph document into <graph>/query + manifest fragment.
      try {
        const seedResponse = await fetch("/proxy/api/graph-seed", { method: "POST", cache: "no-store", headers: proxyDebugHeaders("login-graph-seed", "Login") });
        const seedData = await seedResponse.json().catch(() => ({}));
        if (!seedResponse.ok || !seedData.ok) throw new Error(seedData.error || `Graph load failed (HTTP ${seedResponse.status})`);
        toast.add({
          title: "Graphs loaded",
          description: `Loaded ${Array.isArray(seedData.loaded) ? seedData.loaded.length : 0} RDF documents into ${graphForPrefix(session.graphPrefix)}.`,
          type: "success",
        });
      } catch (seedError) {
        toast.add({ title: "Could not load ./graph into your graph server", description: seedError instanceof Error ? seedError.message : "Graph load failed", type: "error" });
      }

      // Drop cached Datasite lists from before login and reload them from the personal store.
      await clearClientQueryCache();
      setEndpointReloadRevision((r) => r + 1);
      setBookmarkCheckRevision((r) => r + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setLoginError(msg);
      toast.add({ title: "Login failed", description: msg, type: "error" });
    } finally {
      setLoginTesting(false);
    }
  };

  useEffect(() => {
    if (!recordFormatPreferenceLoaded || !queryTreeHeightDbRef.current) return;
    try {
      const transaction = queryTreeHeightDbRef.current.transaction("preferences", "readwrite");
      transaction.objectStore("preferences").put(recordFormatEnabled, "record-format-enabled");
    } catch (error) {
      console.warn("Maestro could not persist the Format toggle in IndexedDB", error);
    }
  }, [recordFormatEnabled, recordFormatPreferenceLoaded]);



  const [querySourceFormat, setQuerySourceFormat] = useState<"xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "response">("xml");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [isRdfLoaderOpen, setIsRdfLoaderOpen] = useState(false);
  const [rdfSourceUrl, setRdfSourceUrl] = useState("");
  const [rdfTargetGraph, setRdfTargetGraph] = useState(
    "http://example.org/graph/imported",
  );
  const [isRdfLoading, setIsRdfLoading] = useState(false);
  /*
  const [activeTab, setActiveTab] = useState<
    "default" | "personal" | "community"
  >("default");
*/
  // Inner tabs for the left pane in Default view.
const [defaultLeftTab, setDefaultLeftTab] = useState<"facets" | "personal" | "community">("personal");
  const [focusListOrder, setFocusListOrder] = useState<"Properties" | "Roles">("Properties");


  const [personalWidgets, setPersonalWidgets] = useState<PersonalWidget[]>([]);
  // SHACL-discovered widgets use the ordinary Personal facet machinery.
  // This set changes only the label icon, not widget query/filter behavior.
  // Tutorial previews are presentation-only and never mutate or persist the query.
  const [tutorialMode, setTutorialMode] = useState(false);
  const [facetHoverPreview, setFacetHoverPreview] = useState<{
    kind: "facet" | "record";
    uri: string;
    label: string;
    direction: "forward" | "reverse";
    source: "personal" | "configure" | "record";
    successorNodeId?: string | null;
  } | null>(null);
  // One owner controls every transient tutorial highlight. Clearing this state
  // removes the results overlay, Query Tree tint, breadcrumb tint, and widget tint.
  const clearTutorialPreview = () => setFacetHoverPreview(null);
  const beginFacetHoverPreview = (uri: string, direction: "forward" | "reverse", label: string, source: "personal" | "configure") => {
    if (!tutorialMode) return;
    const matchingRelationship = findRelationshipPreviewNode(uri, direction);
    setFacetHoverPreview({
      kind: "facet", uri, direction, label, source,
      // Preview the selected relationship as the immediate successor crumb,
      // without changing the authoritative query or saved breadcrumb trail.
      successorNodeId: matchingRelationship && !getPropertyPath().some((crumb) => crumb.id === matchingRelationship.id)
        ? matchingRelationship.id
        : null,
    });
  };
  const beginRecordHoverPreview = (uri: string, label: string) => {
    if (!tutorialMode || !uri.trim()) return;
    setFacetHoverPreview({ kind: "record", uri, label, direction: "forward", source: "record" });
  };
  const [breadcrumbTrail, setBreadcrumbTrail] = useState<
  { id: string; uri: string; name: string }[]
>([]);

  // Remember whether the muted suffix came from navigating to an ancestor.
  // Such a suffix must not be replaced by newly added Configure relationships.
  const ancestorGhostRetainedRef = useRef(false);
  const previousActiveGhostPathRef = useRef<string[]>([]);
  const previousScopeRelationshipsRef = useRef<Map<string, string[]>>(new Map());

  const [focusWidgetsSuppressed, setFocusWidgetsSuppressed] = useState(false);
  const [groupByPropertyUri, setGroupByPropertyUri] = useState("");
  // Preserve a Personal facet's group-by selection while the Code Block pane
  // temporarily replaces the results/groups pane.
  const groupByBeforeCodeViewRef = useRef("");
  const [resultsUiPage, setResultsUiPage] = useState(0);
  const [groupUiPage, setGroupUiPage] = useState(0);
  const [groupBatchSize, setGroupBatchSize] = useState<number>(100);
  const [groupBatchOffset, setGroupBatchOffset] = useState(0);
  const [groupHasMoreBatches, setGroupHasMoreBatches] = useState(false);
  const groupCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingGroupScrollRef = useRef<string | null>(null);
  const personalWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const roleWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const categoriesWidgetRef = useRef<HTMLElement | null>(null);
  const facetListsLoadingObservedRef = useRef(false);
  const facetListsLoadKeyRef = useRef("");
  const FACET_PAGE_SIZE = 10;
  const [propertyFacets, setPropertyFacets] = useState<FacetItem[]>([]);
  const [classFacets, setClassFacets] = useState<FacetItem[]>([]);
  // Class -> immediate superclass edges from the tree="yes" classes view (a class may have several parents).
  const [classTreeEdges, setClassTreeEdges] = useState<Array<{ uri: string; parent: string }>>([]);
  const [facetCandidateCounts, setFacetCandidateCounts] = useState<Record<string, number | null>>({});
  const [roleFacets, setRoleFacets] = useState<FacetItem[]>([]);
  const [roleWidgetStatuses, setRoleWidgetStatuses] = useState<Record<string, RoleWidgetStatus>>({});
  const [graphFacets, setGraphFacets] = useState<FacetItem[]>([]);
  const [graphHasMore, setGraphHasMore] = useState(false);
  const [propertyFacetSparql, setPropertyFacetSparql] = useState("");
  const [roleFacetSparql, setRoleFacetSparql] = useState("");
  const [facetAutofillCandidates, setFacetAutofillCandidates] = useState<FacetAutofillCandidates>({ property: [], "property-in": [] });
  // localStorage mutations do not trigger React renders. This revision makes
  // additions to the live query observable to the Auto-configure candidate effects.
  const [facetUsageRevision, setFacetUsageRevision] = useState(0);
  const previousFacetQueryNodesRef = useRef<Map<string, { kind: "property" | "property-in"; uri: string; excluded: boolean }> | null>(null);
  const [autoConfiguredFacetKeys, setAutoConfiguredFacetKeys] = useState<Set<AutoConfiguredFacetKey>>(
    () => new Set(typeof window === "undefined" ? [] : readAutoConfiguredFacetKeys()),
  );
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
  const [isLoadingGraphs, setIsLoadingGraphs] = useState(false);
  const [roleFacetError, setRoleFacetError] = useState("");

  const {
    tree: queryTree,
    revision: queryRevision,
    replaceTree: replaceQueryTree,
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
    navigateToPropertyPath: navigateToPropertyPathRaw,
    moveViewToSibling: moveViewToSiblingRaw,
    addClass,
    removeClass,
    setSearchText: setSearch,
    resetQuery,
    setQueryAttribute,
    setNodeAttribute,
    setRoleFilter,
    setResultsPage,
    showClassResults,
    refresh: refreshQuery,
    deleteNode,
  } = useFctQuery();

  useEffect(() => {
    setGraphsPage(0);
  }, [queryTree.attributes.graph]);

  const searchNode = queryTree.children.find(
    (node) => node.name === "text" && node.id === "query-text",
  );
  // Treat any root-level URI value as the fixed-subject constraint, including
  // legacy/duplicate nodes that do not have Maestro's canonical node ID.
  const rootUriValues = queryTree.children.filter(
    (node) => node.name === "value" && node.attributes.datatype === "uri",
  );
  const uriNode = rootUriValues.find((node) => node.id === "query-uri-value")
    ?? rootUriValues.find((node) => Boolean(node.text?.trim()))
    ?? rootUriValues[0];
  const activeSearchNode = uriNode ?? searchNode;
  const [searchDraft, setSearchDraft] = useState(activeSearchNode?.text ?? "");
  // Keep text search and fixed-subject URI drafts independently so switching
  // signals never overwrites the term belonging to the other mode.
  const [savedSearchDraft, setSavedSearchDraft] = useState(searchNode?.text ?? "");
  const [savedUriDraft, setSavedUriDraft] = useState(uriNode?.text ?? "");
  const [selectedNamePropertyUris, setSelectedNamePropertyUris] = useState<string[]>(() => {
    const configured = (searchNode?.attributes.property ?? RDFS_LABEL_URI).trim();
    const parsed = configured.split(/[\s,]+/).filter(Boolean);
    return parsed.length && parsed[0].toLowerCase() !== "none" ? parsed : [RDFS_LABEL_URI];
  });
  const search = searchDraft;
  const searchDraftRef = useRef(searchDraft);

  // Follow query edits from elsewhere while retaining independent text and URI drafts.
  useEffect(() => {
    if (!activeSearchNode) return;
    const nextText = activeSearchNode.text ?? "";
    searchDraftRef.current = nextText;
    setSearchDraft(nextText);
    if (activeSearchNode.name === "value" && activeSearchNode.attributes.datatype === "uri") setSavedUriDraft(nextText);
    else if (activeSearchNode.id === "query-text") setSavedSearchDraft(nextText);
  }, [activeSearchNode?.id, activeSearchNode?.text]);
  // The URI signal fixes the query subject; other signals search text values or clear the term.
  const querySignalMode: "uri" | "name" | "all" | "clear" = uriNode
    ? "uri"
    : !searchNode
      ? "clear"
      : searchNode.attributes.property
        ? "name"
        : "all";
  // Keep the selected signal separate from query constraints. URI mode is valid
  // with an empty draft, in which case the query API correctly stores no <value>.
  const [selectedSignalMode, setSelectedSignalMode] = useState<"uri" | "name" | "all" | "clear">(querySignalMode);
  const selectedSignalModeRef = useRef<"uri" | "name" | "all" | "clear">(querySignalMode);
  // Follow live query changes when a URI or text constraint exists. If neither
  // exists, preserve the selected mode so an empty URI draft stays in URI mode.
  useEffect(() => {
    if (uriNode) {
      selectedSignalModeRef.current = "uri";
      setSelectedSignalMode("uri");
    } else if (searchNode) {
      const mode = searchNode.attributes.property ? "name" : "all";
      selectedSignalModeRef.current = mode;
      setSelectedSignalMode(mode);
    }
  }, [uriNode?.id, uriNode?.text, searchNode?.id, searchNode?.attributes.property]);
  const textSearchMode = selectedSignalMode;
  const selectedNamePropertyLabel = selectedNamePropertyUris
    .map((uri) => TEXT_SEARCH_NAME_PROPERTIES.find((property) => property.uri === uri)?.label ?? toLabel(uri))
    .join(", ") || "no properties";
  const [signalPickerExpanded, setSignalPickerExpanded] = useState(false);
  const signalOptions = [
    { mode: "uri" as const, Icon: SignalZero, label: "URI — use the entered URI as the fixed subject" },
    { mode: "name" as const, Icon: SignalLow, label: `Name — search using ${selectedNamePropertyLabel}` },
    { mode: "all" as const, Icon: SignalMedium, label: "All fields — search text across all properties" },
    { mode: "clear" as const, Icon: SignalHigh, label: "Clear Terms — remove the text constraint from the query" },
  ];
  const ActiveSignalIcon = signalOptions.find(({ mode }) => mode === textSearchMode)?.Icon ?? SignalHigh;
  const [rootSearchExpanded, setRootSearchExpanded] = useState(false);
  const rootSearchExpandedRef = useRef(rootSearchExpanded);
  // Last record label seen for each root URI, so the root crumb label stays stable when the badge toggles to Classes.
  const rootUriLabelCacheRef = useRef<Map<string, string>>(new Map());
  // Keep queued History work aware of the breadcrumb's current visibility,
  // including work enqueued just before the search field opened.
  rootSearchExpandedRef.current = rootSearchExpanded;
  const [namePropertyMenuOpen, setNamePropertyMenuOpen] = useState(false);
  // The Categories tree/list toggle belongs to the authoritative FCT query,
  // so History, share links, and restored queries reproduce the same mode.
  const categoriesTreeMode = queryTree.attributes.classTree === "true";
  // Path keys of explicitly expanded tree nodes. New trees and new branches start closed.
  const [expandedCategoryNodes, setExpandedCategoryNodes] = useState<Set<string>>(() => new Set());
  const [ontologyClassMetadata, setOntologyClassMetadata] = useState<Record<string, OntologyClassMetadata>>({});
  const [personalSparqlEndpoint, setPersonalSparqlEndpoint] = useState("");
  const [breadcrumbPreviewSummaries, setBreadcrumbPreviewSummaries] = useState<Record<string, FctUiResultSummary>>({});
  const [breadcrumbMenuPreviewSummaries, setBreadcrumbMenuPreviewSummaries] = useState<Record<string, FctUiResultSummary>>({});
  const breadcrumbMenuPreviewPendingRef = useRef(new Set<string>());
  useEffect(() => { setBreadcrumbMenuPreviewSummaries({}); breadcrumbMenuPreviewPendingRef.current.clear(); }, [queryRevision, selectedEndpointId]);
  const [breadcrumbPreviewPendingIds, setBreadcrumbPreviewPendingIds] = useState<Set<string>>(() => new Set());
  // Reuse result-set metadata for the exact scoped query before issuing a breadcrumb-only request.
  const metadataRegistryRef = useRef<Map<string, FctUiResultSummary>>(new Map());

  function setMainViewType(node: FctQueryNode, type: string): FctQueryNode {
    return {
      ...node,
      attributes: node.id === "query-view"
        ? { ...node.attributes, type, offset: "0" }
        : node.attributes,
      children: node.children.map((child) => setMainViewType(child, type)),
    };
  }

  /** Navigate from a Record predicate to that predicate URI as a new root. */
  const openRecordPropertyUri = (uri: string) => {
    if (!uri.trim()) return;
    // Clear all prior constraints/path but preserve graphsite@graphserver routing.
    const findView = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.name === "view") return node;
        const nested = findView(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const currentView = findView(queryTree.children);
    const rootView: FctQueryNode = currentView
      ? { ...currentView, attributes: { ...currentView.attributes, type: FCT_VIEW_TYPES.LIST, offset: "0", index: "" }, children: [] }
      : { id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.LIST, limit: "30", offset: "0" }, children: [] };
    const freshTree = { ...queryTree, children: [rootView] };
    const rooted = fctQueryTreeApi.setValue(freshTree, null, [{ text: uri, datatype: "uri" }], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    });
    replaceQueryTree(rooted);
    selectedSignalModeRef.current = "uri";
    setSelectedSignalMode("uri");
    setSavedUriDraft(uri);
    searchDraftRef.current = uri;
    setSearchDraft(uri);
    setSearchPipelineRun((current) => current + 1);
  };

  // Navigate through the shared FCT query API. Class navigation must use a
  // native <class>, which Categories and the root breadcrumb both derive from.
  // Property/role badges use the same canonical filter IDs as their widgets.
  const navigateResultBadge = (predicate: string, term: ScopeValue["values"][number], direction: "forward" | "reverse", category = false, operator: "=" | "contains" = "=") => {
    const uri = term.value.trim();
    if (!uri || uri === "-") return;
    const freshView: FctQueryNode = {
      id: "query-view", name: "view", attributes: {
        type: FCT_VIEW_TYPES.LIST, limit: String(resultsBatchSize), offset: "0",
      }, children: [],
    };
    // Preserve query-wide settings (especially addr), but remove all previous
    // constraints. Compose the new tree via the public query transformations,
    // then publish it once so all listeners derive the same authoritative state.
    let nextTree = { ...queryTree, children: [freshView] };
    if (category) {
      nextTree = fctQueryTreeApi.addClass(nextTree, null, uri);
    } else {
      const value = {
        text: uri,
        ...(operator === "contains" ? { op: "contains" } : {}),
        ...(term.type === "uri" ? { datatype: "uri" }
          : term.datatype ? { datatype: term.datatype }
          : term.lang ? { lang: term.lang }
          : { datatype: "string" }),
      };
      if (direction === "reverse") {
        nextTree = fctQueryTreeApi.setRoleFilter(nextTree, predicate, true);
        nextTree = fctQueryTreeApi.setRoleValue(nextTree, predicate, value, true);
      } else {
        nextTree = fctQueryTreeApi.addProperty(nextTree, predicate, null);
        nextTree = fctQueryTreeApi.setPropertyValues(nextTree, null, predicate, [value]);
      }
    }
    replaceQueryTree(nextTree);
    searchDraftRef.current = "";
    setSearchDraft("");
    setResultsUiPage(0);
    setCentralTab("results");
  };

  const applyRecordAsRootValue = (uri: string) => {
    if (!uri.trim()) return;
    const nonTextTree = {
      ...queryTree,
      children: queryTree.children
        .filter((node) => node.name !== "text")
        .map((node) => setMainViewType(node, FCT_VIEW_TYPES.LIST)),
    };
    const record = results.find((item) => item.uri === uri) ?? groupValues.find((item) => item.uri === uri);
    const rootValue = record?.termType === "literal"
      ? { text: uri, ...(record.lang ? { lang: record.lang } : { datatype: record.datatype || "string" }) }
      : { text: uri, datatype: "uri" };
    replaceQueryTree(fctQueryTreeApi.setValue(nonTextTree, null, [rootValue], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    }));
    if (record?.termType !== "literal") {
      selectedSignalModeRef.current = "uri";
      setSelectedSignalMode("uri");
      setSavedUriDraft(uri);
      searchDraftRef.current = uri;
      setSearchDraft(uri);
    }
    clearTutorialPreview();
    setSearchPipelineRun((current) => current + 1);
  };


  function setTextSearchMode(mode: "uri" | "name" | "all" | "clear", propertyUris = selectedNamePropertyUris) {
    selectedSignalModeRef.current = mode;
    setSelectedSignalMode(mode);
    if (mode === "name") setSelectedNamePropertyUris(propertyUris);
    if (mode === "clear") {
      // Both drafts are retained independently; clear only the active query constraint.
      if (uriNode) setSavedUriDraft(uriNode.text ?? searchDraft);
      else if (searchNode) setSavedSearchDraft(searchNode.text ?? searchDraft);
      const withoutSearch = {
        ...queryTree,
        children: queryTree.children
          .filter((node) => node.id !== "query-text")
          .map((node) => setMainViewType(node, FCT_VIEW_TYPES.TEXT)),
      };
      replaceQueryTree(fctQueryTreeApi.setValue(withoutSearch, null, [], {
        replaceExisting: true,
        idPrefix: "query-uri-value",
      }));
      searchDraftRef.current = "";
      setSearchDraft("");
      setSearchPipelineRun((current) => current + 1);
      return;
    }

    if (mode === "uri") {
      const restoredUri = uriNode?.text ?? savedUriDraft;
      searchDraftRef.current = restoredUri;
      setSearchDraft(restoredUri);
      setSavedUriDraft(restoredUri);
      const nonSearchTree = {
        ...queryTree,
        children: queryTree.children
          .filter((node) => node.name !== "text")
          .map((node) => setMainViewType(node, FCT_VIEW_TYPES.LIST)),
      };
      replaceQueryTree(fctQueryTreeApi.setValue(
        nonSearchTree,
        null,
        restoredUri.trim() ? [{ text: restoredUri, datatype: "uri" }] : [],
        { replaceExisting: true, idPrefix: "query-uri-value" },
      ));
      setSearchPipelineRun((current) => current + 1);
      return;
    }

    const restoredText = searchNode?.text ?? savedSearchDraft;
    const uriToResolve = mode === "name" && textSearchMode === "uri" && !restoredText.trim()
      ? (uriNode?.text ?? savedUriDraft).trim()
      : "";
    searchDraftRef.current = restoredText;
    setSearchDraft(restoredText);
    setSavedSearchDraft(restoredText);

    const textNode: FctQueryNode = searchNode
      ? {
          ...searchNode,
          attributes: mode === "name" ? { ...searchNode.attributes, property: propertyUris.join(" ") } : Object.fromEntries(Object.entries(searchNode.attributes).filter(([key]) => key !== "property")),
          text: restoredText,
        }
      : {
          id: "query-text",
          name: "text",
          attributes: mode === "name" ? { property: propertyUris.join(" ") } : {},
          text: restoredText,
          children: [],
        };
    const withoutSearch = {
      ...queryTree,
      children: queryTree.children
        .filter((node) => node.id !== "query-text")
        .map((node) => setMainViewType(node, FCT_VIEW_TYPES.TEXT)),
    };
    const withoutUri = fctQueryTreeApi.setValue(withoutSearch, null, [], {
      replaceExisting: true,
      idPrefix: "query-uri-value",
    });
    replaceQueryTree({ ...withoutUri, children: [textNode, ...withoutUri.children] });
    setSearchPipelineRun((current) => current + 1);

    // When leaving URI mode for an empty Name search, resolve the URI's label.
    // Only fill the field if the user has not started typing while the request runs.
    if (uriToResolve) {
      void (async () => {
        const controller = new AbortController();
        try {
            const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("uri-label-lookup", "UriLabelLookup") },
            body: `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="${escapeXmlText(queryTree.attributes.inference ?? "")}" same-as="${escapeXmlText(queryTree.attributes["same-as"] ?? "")}" addr="${escapeXmlText(queryTree.attributes.addr || (selectedEndpointId ? `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}` : ""))}"><value datatype="uri">${escapeXmlText(uriToResolve)}</value><view type="${FCT_VIEW_TYPES.DESCRIBE}" limit="30" offset="0"/></query>`,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          const label = (data.describe ?? []).find((triple) =>
            triple.subject?.value === uriToResolve &&
            triple.predicate?.value === RDFS_LABEL_URI &&
            triple.object?.termType !== "bnode" &&
            Boolean(triple.object?.value?.trim()),
          )?.object?.value?.trim() ?? "";
          if (label && selectedSignalModeRef.current === "name" && !searchDraftRef.current.trim()) {
            searchDraftRef.current = label;
            setSearchDraft(label);
            setSavedSearchDraft(label);
            setSearch(label);
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("URI label lookup failed:", error);
          }
        }
      })();
    }
  }

  function updateSearchText(value: string) {
    searchDraftRef.current = value;
    setSearchDraft(value);
    if (textSearchMode === "uri") {
      setSavedUriDraft(value);
      const nonSearchTree = {
        ...queryTree,
        children: queryTree.children.filter((node) => node.name !== "text"),
      };
      replaceQueryTree(fctQueryTreeApi.setValue(
        nonSearchTree,
        null,
        value.trim() ? [{ text: value, datatype: "uri" }] : [],
        { replaceExisting: true, idPrefix: "query-uri-value" },
      ));
      return;
    }
    if (searchNode) {
      setSavedSearchDraft(value);
      setSearch(value);
      return;
    }
    // Typing after Clear Terms starts a fresh, restrictive name search.
    setSavedSearchDraft(value);
    replaceQueryTree({
      ...queryTree,
      children: [
        { id: "query-text", name: "text", attributes: { property: RDFS_LABEL_URI }, text: value, children: [] },
        ...queryTree.children,
      ],
    });
  }

  // Use a structural signature rather than the tree object's identity: the
  // query model can retain the same root object while its children change.
  // That made [queryTree] miss additions, so learned counts stayed at zero.
  const facetQuerySignature = (() => {
    const relationships: Array<[string, string, string]> = [];
    const visit = (nodes: FctQueryNode[]) => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri) {
          relationships.push([node.id, node.name, node.attributes.iri]);
        }
        visit(node.children);
      }
    };
    visit(queryTree.children);
    return JSON.stringify(relationships);
  })();

  // Learn from changes to the authoritative <query> tree, not from UI event
  // handlers. This catches additions from checkboxes, label navigation, and
  // any other code path that inserts a <property> or <property-of> node.
  useEffect(() => {
    const currentNodes = new Map<string, { kind: "property" | "property-in"; uri: string; excluded: boolean }>();
    const collectRelationshipNodes = (nodes: FctQueryNode[]) => {
      for (const node of nodes) {
        if ((node.name === "property" || node.name === "property-of") && node.attributes.iri) {
          currentNodes.set(node.id, {
            kind: node.name === "property" ? "property" : "property-in",
            uri: node.attributes.iri,
            excluded: node.attributes.exclude?.trim().toLowerCase() === "yes",
          });
        }
        collectRelationshipNodes(node.children);
      }
    };
    collectRelationshipNodes(queryTree.children);

    const previousNodes = previousFacetQueryNodesRef.current;
    previousFacetQueryNodesRef.current = currentNodes;
    const debugAutoConfigure = (() => {
      try {
        return window.localStorage.getItem("maestro:debug-autoconfigure") === "true";
      } catch {
        return false;
      }
    })();

    // Establish a baseline on mount; don't treat nodes already in an initial
    // query as new user additions.
    if (!previousNodes) {
      if (debugAutoConfigure) {
        console.debug("[Maestro Auto-configure] baseline", Array.from(currentNodes.values()));
      }
      return;
    }

    let recordedAddition = false;
    for (const [id, current] of currentNodes) {
      const previous = previousNodes.get(id);
      // Whenever the live query adds or changes a facet node, store its exclude boolean.
      if (!previous || previous.kind !== current.kind || previous.uri !== current.uri || previous.excluded !== current.excluded) {
        recordFacetExclude(current.kind, current.uri, current.excluded);
      }
      if (previous?.kind === current.kind && previous.uri === current.uri) continue;
      recordFacetAddition(current.kind, current.uri);
      recordedAddition = true;
      if (debugAutoConfigure) {
        console.debug("[Maestro Auto-configure] recorded query addition", { id, ...current });
      }
    }
    if (debugAutoConfigure) {
      console.debug("[Maestro Auto-configure] query snapshot", {
        queryRevision,
        previous: Array.from(previousNodes.values()),
        current: Array.from(currentNodes.values()),
        counts: readFacetAddCounts(),
      });
    }
    if (recordedAddition) setFacetUsageRevision((revision) => revision + 1);
  }, [facetQuerySignature, queryRevision]);

  useEffect(() => {
    const activePath = getPropertyPath();
    const activeIds = activePath.map((crumb) => crumb.id);
    const previousActiveIds = previousActiveGhostPathRef.current;
    const movedToAncestor = previousActiveIds.length > activeIds.length &&
      activeIds.every((id, index) => id === previousActiveIds[index]);
    if (movedToAncestor) ancestorGhostRetainedRef.current = true;
    else if (previousActiveIds.join("|") !== activeIds.join("|")) ancestorGhostRetainedRef.current = false;
    previousActiveGhostPathRef.current = activeIds;

    // Only relationships in the authoritative query can appear as breadcrumbs.
    const existingIds = new Set<string>();
    const scopeRelationships = new Map<string, FctQueryNode[]>();
    const collect = (nodes: FctQueryNode[], scopeId: string) => {
      const relationships = nodes.filter((node) =>
        (node.name === "property" || node.name === "property-of") && Boolean(node.attributes.iri?.trim()),
      );
      scopeRelationships.set(scopeId, relationships);
      for (const node of relationships) existingIds.add(node.id);
      for (const node of nodes) collect(node.children, node.id);
    };
    collect(queryTree.children, "query-root");
    const currentScopeIds = new Map(Array.from(scopeRelationships, ([id, nodes]) => [id, nodes.map((node) => node.id)]));
    const previousScopeIds = previousScopeRelationshipsRef.current;
    const scopeId = activePath[activePath.length - 1]?.id ?? "query-root";
    const siblingNodes = scopeRelationships.get(scopeId) ?? [];
    const newlyAdded = siblingNodes.filter((node) => !(previousScopeIds.get(scopeId) ?? []).includes(node.id));
    previousScopeRelationshipsRef.current = currentScopeIds;

    setBreadcrumbTrail((current) => {
      const retained = current.filter((crumb) => existingIds.has(crumb.id));
      const activeIsPrefix = activePath.length <= retained.length &&
        activePath.every((crumb, index) => crumb.id === retained[index]?.id);
      let nextTrail = activeIsPrefix ? retained : activePath;

      // An ancestor-navigation suffix is owned by the user's navigation, so
      // Configure additions cannot silently replace its muted path.
      if (ancestorGhostRetainedRef.current && nextTrail.length > activePath.length) return nextTrail;

      // A Configure addition at the root (or any active scope) creates a
      // single ghost successor without moving <view>. When there is already an
      // automatic ghost, the *latest* added sibling takes that slot.
      const candidate = newlyAdded[newlyAdded.length - 1] ??
        (nextTrail.length <= activePath.length ? siblingNodes[siblingNodes.length - 1] : undefined);
      if (candidate) {
        nextTrail = [...activePath, {
          id: candidate.id,
          uri: candidate.attributes.iri ?? "",
          name: candidate.name,
        }];
        ancestorGhostRetainedRef.current = false;
      }
      return nextTrail;
    });
  }, [queryTree, getPropertyPath, queryRevision]);



  // Read the registry once after session restoration; subsequently only an
  // explicit login changes the menu. Never POST a proxy selection on refresh.
  useEffect(() => {
    if (!authRestoreComplete) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedUrl = readGraphServerFromQueryXml(params.get("q"));
        const response = await cachedFetchFct("/proxy/api/fct", {
          cache: "no-store", headers: proxyDebugHeaders("endpoint-menu", "EndpointMenu"),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load graph servers.");
        if (cancelled) return;
        const endpoints: EndpointOption[] = Array.isArray(data.endpoints)
          ? (data.endpoints as EndpointOption[]).filter((item) =>
              authSession || (item.id !== "personal-sparql" && item.label.toLowerCase() !== "personal sparql"))
          : [];
        // The server in the authoritative query wins. Match the shorthand
        // registry address and its expanded /sparql URL equivalently.
        const canonicalServer = (value: string) => {
          try {
            const uri = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
            const path = uri.pathname.replace(/\/+$/, "") || "/sparql";
            return `${uri.host.toLowerCase()}${path}`;
          } catch { return value.trim().toLowerCase(); }
        };
        const requested = requestedUrl
          ? endpoints.find((item) => item.url === requestedUrl || item.id === requestedUrl ||
              canonicalServer(item.url) === canonicalServer(requestedUrl))
          : undefined;
        if (requestedUrl && !requested) {
          setEndpointMenuError(`The graph server in query addr is not configured: ${requestedUrl}`);
        } else {
          setEndpointMenuError("");
        }
        // An empty response during restoration must not erase a menu that
        // was already available to the user.
        setFctEndpoints((current) => endpoints.length > 0 ? endpoints : current);
        // Preserve the selection across a login-triggered registry reload.
        // Never clear it because a transient response omits an entry.
        setSelectedEndpointId((current) => {
          const retained = endpoints.find((item) => item.id === current);
          const choice = requested ?? retained ?? (!requestedUrl ? endpoints[0] : undefined);
          return choice?.id ?? current;
        });
      } catch (error) {
        if (!cancelled) setEndpointMenuError(
          error instanceof Error ? error.message : "Could not load graph servers.",
        );
        // Keep both the existing menu and selection on fetch failure.
      }
    })();
    return () => { cancelled = true; };
    // A new login explicitly increments endpointReloadRevision. Session
    // restoration only unblocks the first read; it never increments revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRestoreComplete, endpointReloadRevision]);

  /** Health-check precisely one selected server. Never scan the registry. */
  async function checkSelectedGraphServer(endpoint: EndpointOption): Promise<EndpointStatus> {
    setCheckingEndpointIds((current) => ({ ...current, [endpoint.id]: true }));
    setIsCheckingEndpoints(true);
    setEndpointChecksCompleted(0);
    setEndpointChecksTotal(1);
    let status: EndpointStatus;
    try {
      const response = await fetch(
        `/proxy/api/fct?health=1&endpointId=${encodeURIComponent(endpoint.id)}`,
        { cache: "no-store", headers: proxyDebugHeaders("endpoint-health", `EndpointHealth:${endpoint.id}`) },
      );
      const data = await response.json();
      if (!response.ok || !data.check) throw new Error(data.error ?? "Health check failed.");
      status = data.check as EndpointStatus;
    } catch {
      status = { id: endpoint.id, status: null, state: "unreachable", testedUrl: endpoint.url };
    } finally {
      setCheckingEndpointIds((current) => ({ ...current, [endpoint.id]: false }));
      setIsCheckingEndpoints(false);
      setEndpointChecksCompleted(1);
    }
    // A host-only registry entry may resolve to HTTP, but only after HTTPS
    // returned 404. Make that resolved URL authoritative for subsequent queries.
    if (status.state === "ok" && status.status === 200 &&
        endpoint.schemeInferred && endpoint.url.startsWith("https://") &&
        status.testedUrl === endpoint.url.replace(/^https:\/\//, "http://")) {
      const resolvedUrl = status.testedUrl;
      setFctEndpoints((current) => current.map((item) => item.id === endpoint.id ? { ...item, url: resolvedUrl } : item));
      const address = queryTree.attributes.addr ?? "";
      const separator = address.indexOf("@");
      if (separator >= 0 && address.slice(separator + 1) === endpoint.url) {
        setQueryAttribute("addr", `${address.slice(0, separator)}@${resolvedUrl}`);
      }
      await setAuxiliaryGraphServerUri(resolvedUrl).catch(() => {});
    }
    setEndpointStatuses((current) => ({ ...current, [endpoint.id]: status }));
    return status;
  }

  async function refreshFailedEndpointAndRetry() {
    if (!endpointHealthToast || isRefreshingFailedEndpoint) return;
    const endpoint = fctEndpoints.find((item) => item.id === endpointHealthToast.endpointId);
    if (!endpoint) return;
    setIsRefreshingFailedEndpoint(true);
    try {
      const health = await checkSelectedGraphServer(endpoint);
      if (health.state === "ok" && health.status === 200) {
        setEndpointHealthToast(null);
        setEndpointMenuError("");
        refreshQuery();
      }
    } finally {
      setIsRefreshingFailedEndpoint(false);
      setIsCheckingEndpoints(false);
    }
  }

  async function setAuxiliaryGraphServerUri(uri: string) {
    const response = await fetch("/proxy/api/fct", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectEndpointUrl: uri }), cache: "no-store",
    });
    if (!response.ok) throw new Error("Unable to select the configured graph server URI.");
  }

  /** Only a user's explicit menu selection or a saved query URI may select a server. */
  async function synchronizeFctEndpointSelection(graphServerUri: string) {
    if (!graphServerUri) return;
    const endpoint = fctEndpoints.find((item) => item.url === graphServerUri || item.id === graphServerUri);
    if (!endpoint) throw new Error(`The query references an unconfigured graph server: ${graphServerUri}`);
    if (!authSession && (endpoint.id === "personal-sparql" || endpoint.label.toLowerCase() === "personal sparql")) {
      throw new Error("Log in before selecting the personal graph server.");
    }
    await setAuxiliaryGraphServerUri(endpoint.url);
    setSelectedEndpointId(endpoint.id);
    setEndpointMenuError("");
  }

  async function chooseFctEndpoint(endpointId: string) {
    if (!endpointId || endpointId === selectedEndpointId) return;
    const endpoint = fctEndpoints.find((item) => item.id === endpointId);
    if (!endpoint) return;
    if (!authSession && (endpoint.id === "personal-sparql" || endpoint.label.toLowerCase() === "personal sparql")) return;
    try { await setAuxiliaryGraphServerUri(endpoint.url); }
    catch (error) {
      setEndpointMenuError(error instanceof Error ? error.message : "Could not choose graph server.");
      return;
    }
    setSelectedEndpointId(endpointId);
    setEndpointMenuError("");
    setEndpointHealthToast(null);
    const graph = queryTree.attributes.graph?.trim() ?? "";
    setQueryAttribute("addr", `${graph}@${endpoint.url}`);
    // The query health gate checks the newly selected server before executing.
  }

  // Personal View widgets subscribe to the authoritative query tree. A widget
  // exists while its property-filter node exists in <query>. Binding selection is
  // reconciled from that node, so deleting a <value> clears only that checkbox
  // while leaving the property filter and its widget intact.
  useEffect(() => {
    // Keep the Filters pane scoped to the properties directly attached to the
    // current <view>, which moves as the user navigates the breadcrumbs.
    if (focusWidgetsSuppressed) {
      setPersonalWidgets([]);
      return;
    }
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
        const excluded = node.attributes.exclude?.trim().toLowerCase() === "yes";
        const baseLabel = toLabel(uri, "Property");
        const label = baseLabel;
        const existing = existingByUri.get(uri);
        if (existing) {
          return existing.label === label && existing.excluded === excluded &&
            existing.selectedValues.length === boundValues.length &&
            existing.selectedValues.every(
              (value, index) => value === boundValues[index],
            )
            ? existing
            : { ...existing, label, excluded, selectedValues: boundValues };
        }
        return {
          uri,
          label,
          excluded,
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
            widget.label === current[index]?.label &&
            widget.excluded === current[index]?.excluded &&
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
  }, [queryTree, propertyFacets, focusWidgetsSuppressed]);

  const viewNode = findQueryNode(queryTree.children, "query-view");
  // Server batches and visible UI pages are independent. The active query view's
  // limit/offset are the main Results batch profile; the Group by query has its
  // own limit/offset below. The page-size preference is shared across both views.
  useEffect(() => {
    const rootHasUri = queryTree.children.some((node) => node.name === "value" && node.attributes.datatype === "uri");
    const rootHasRelationship = queryTree.children.some((node) => node.name === "property" || node.name === "property-of");
    const rootView = queryTree.children.find((node) => node.name === "view");
    if (rootHasUri && !rootHasRelationship && rootView?.attributes.type === FCT_VIEW_TYPES.PROPERTIES) {
      setNodeAttribute(rootView.id, "type", FCT_VIEW_TYPES.LIST);
    }
  }, [queryTree, setNodeAttribute]);
  const resultsBatchSize = Math.max(
    1,
    Math.floor(Number(viewNode?.attributes.limit ?? 100) || 100),
  );
  const resultsOffset = Math.max(0, Number(viewNode?.attributes.offset ?? "0") || 0);
  const [resultsPageSize, setResultsPageSize] = useState<number>(DEFAULT_RESULTS_PAGE_SIZE);
  const activePageBatchSize = centralTab === "groups" ? groupBatchSize : resultsBatchSize;
  const resultsPageSizeOptions = pageSizesForBatch(activePageBatchSize);
  const effectivePageSize = resultsPageSizeOptions.includes(resultsPageSize) ? resultsPageSize : resultsPageSizeOptions[0];
  useEffect(() => {
    if (resultsPageSize !== effectivePageSize) {
      setResultsPageSize(effectivePageSize);
      setResultsUiPage(0);
      setGroupUiPage(0);
      maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(effectivePageSize));
    }
  }, [resultsPageSize, effectivePageSize]);

  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const savedCenter = Number(maestroStorageGet(CENTER_PANEL_LIMIT_STORAGE_KEY));
      if (RESULTS_BATCH_SIZE_OPTIONS.some((value) => value === savedCenter)) {
        const live = fctQueryTreeApi.getTree();
        const node = findQueryNode(live.children, "query-view");
        // Respect the restored/share URL's explicit view limit; the Sheet controls
        // it only when the view is still at the default initial batch size.
        if (node && Number(node.attributes.limit ?? 30) === 30 && savedCenter !== 30) {
          setResultsPage(savedCenter, 0);
        }
      }
      const savedGroup = Number(maestroStorageGet(CENTER_GROUP_LIMIT_STORAGE_KEY));
      if (RESULTS_BATCH_SIZE_OPTIONS.some((value) => value === savedGroup)) setGroupBatchSize(savedGroup);
      const savedDescribe = Number(maestroStorageGet(RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY));
      if (RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS.some((value) => value === savedDescribe)) setRecordDescriptionQueryLimit(savedDescribe);
      const savedPage = Number(maestroStorageGet(RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY));
      if (RIGHT_PANEL_PAGE_LIMIT_OPTIONS.some((value) => value === savedPage)) setRecordDescriptionPageSize(savedPage);
    });
    return () => { active = false; };
  }, []);

  const resultsPageSizeStorageInitialized = useRef(false);

  useEffect(() => {
    if (resultsPageSizeStorageInitialized.current) return;
    resultsPageSizeStorageInitialized.current = true;
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const saved = maestroStorageGet(RESULTS_PAGE_SIZE_STORAGE_KEY);
      const savedSize = Number(saved);
      if (saved !== null && Number.isFinite(savedSize) && savedSize > 0) setResultsPageSize(savedSize);
      else maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(DEFAULT_RESULTS_PAGE_SIZE));
    });
    return () => { active = false; };
  }, []);

  const [leftPanelLimit, setLeftPanelLimitState] = useState<number>(DEFAULT_LEFT_PANEL_LIMIT);
  useEffect(() => {
    let active = true;
    void initializeMaestroStorage().then(() => {
      if (!active) return;
      const stored = Number(maestroStorageGet(LEFT_PANEL_LIMIT_STORAGE_KEY));
      const valid = RESULTS_BATCH_SIZE_OPTIONS.find((size) => size === stored);
      if (valid !== undefined) setLeftPanelLimitState(valid);
    });
    return () => { active = false; };
  }, []);
  const setLeftPanelLimit = useCallback((size: number) => {
    if (!RESULTS_BATCH_SIZE_OPTIONS.some((option) => option === size)) return;
    setLeftPanelLimitState(size);
    setGraphsPage(0);
    maestroStorageSet(LEFT_PANEL_LIMIT_STORAGE_KEY, String(size));
  }, []);

  const queryXml = serializeFctQuery(queryTree);

  // Load vocabulary namespace labels from the app's LOD metadata route. Known
  // prefixes are seeded synchronously, so the UI never falls back to nsN for
  // established public vocabularies while metadata is loading.
  useEffect(() => {
    let active = true;
    fetch("/proxy/api/ontology/namespaces", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { namespaces?: unknown } | null) => {
        if (active && payload?.namespaces) rememberNamespaceMetadata(payload.namespaces);
      })
      .catch(() => { /* Built-in namespace prefixes remain available offline. */ });
    return () => { active = false; };
  }, []);

  // Ask the personal store whether this exact serialized query already has a bookmark.
  useEffect(() => {
    if (!authSession) { setIsQueryBookmarked(false); setMatchingBookmarkId(""); return; }
    if (!urlStateInitialized) return;
    let active = true;
    setIsQueryBookmarked(false);
    setMatchingBookmarkId("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/proxy/api/query-favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", queryXml, historyId: historyBookmarkId || undefined }),
          cache: "no-store",
        });
        const payload = await response.json() as { bookmarked?: boolean; historyId?: string | null };
        if (active && response.ok) {
          setIsQueryBookmarked(payload.bookmarked === true);
          setMatchingBookmarkId(payload.bookmarked && payload.historyId ? payload.historyId : "");
        }
      } catch {
        if (active) {
          setIsQueryBookmarked(false);
          setMatchingBookmarkId("");
        }
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [queryXml, urlStateInitialized, bookmarkCheckRevision, historyBookmarkId, authSession]);

  // Keep History navigation enabled state synchronized with the actual store.
  // With no loaded History item, the comparison cursor is the current time.
  useEffect(() => {
    if (!authSession) { setHistoryHasOlder(false); setHistoryHasNewer(false); return; }
    if (!urlStateInitialized || rootSearchExpanded) return;
    let active = true;
    // Preserve the currently displayed button states while the root search
    // field is open. They are refreshed only after the coalesced History write
    // has been persisted when the field closes.
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        // Query changes enqueue a History visit. Wait for that write, then ask
        // relative to the newly-current item rather than the previous cursor.
        await historyWriteQueueRef.current;
        if (!active) return;
        const currentId = historyVisitQueryRef.current === queryXml
          ? historyVisitIdRef.current
          : historyBookmarkId;
        // Attribute each availability query to the specific navigation button
        // whose enabled state it controls. Separate requests make the component
        // identity unambiguous in DevTools and server-side request logs.
        const [backResponse, forwardResponse] = await Promise.all([
          fetch("/proxy/api/query-favorites", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-maestro-debug-component": "HistoryBackButton",
            },
            body: JSON.stringify({ action: "availability", direction: "backward", historyId: currentId }),
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/proxy/api/query-favorites", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-maestro-debug-component": "HistoryForwardButton",
            },
            body: JSON.stringify({ action: "availability", direction: "forward", historyId: currentId }),
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        const [backPayload, forwardPayload] = await Promise.all([
          backResponse.json() as Promise<{ older?: boolean }>,
          forwardResponse.json() as Promise<{ newer?: boolean }>,
        ]);
        if (active) {
          setHistoryHasOlder(backResponse.ok && backPayload.older === true);
          setHistoryHasNewer(forwardResponse.ok && forwardPayload.newer === true);
        }
      } catch {
        if (active) {
          setHistoryHasOlder(false);
          setHistoryHasNewer(false);
        }
      }
    }, 100);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [urlStateInitialized, historyBookmarkId, queryXml, bookmarkCheckRevision, rootSearchExpanded, authSession]);

  useEffect(() => {
    if (!bookmarkDialogOpen) return;
    const timer = window.setTimeout(() => {
      bookmarkTitleInputRef.current?.focus();
      bookmarkTitleInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookmarkDialogOpen]);

  // The main Results request must use the active view's server-side limit and offset.
  const queryResultsXml = queryXml;
  const prettyQueryXml = xmlFormat(queryXml, { indentation: "  " });

  /**
   * Apply a saved FCT query and its shareable UI state without navigating. The
   * initial URL restore and RDF History navigation both use this same path so
   * query listeners and every UI component are refreshed consistently.
   */
  function restoreQueryAndUiState(
    serializedQuery: string | null,
    restored: ShareableUiState | null,
    restoredHistoryId?: string | null,
  ): boolean {
    if (restoredHistoryId) setHistoryBookmarkId(restoredHistoryId);
    let restoredQueryFromUrl = false;
    if (serializedQuery) {
      const restoredTree = parseFctQueryXml(serializedQuery);
      if (restoredTree) {
        // Restore the authoritative query through the store so every existing
        // query listener sees the same tree as if the user had built it in the UI.
        replaceQueryTree(restoredTree);
        const restoredTextNode = restoredTree.children.find(
          (node) => node.name === "text" && node.id === "query-text",
        );
        setSearch(restoredTextNode?.text ?? "");
        // The Name / All fields / Clear Terms control is derived from the
        // presence of this node and its `property` attribute. Preserve that
        // structure exactly, including a URL that intentionally has no <text>.
        // Keep the datasite field tied to the graph attribute in q, rather than
        // allowing a separately saved draft field to override the shared query.
        const restoredAddress = restoredTree.attributes.addr ?? "";
        const addressDelimiter = restoredAddress.indexOf("@");
        const restoredGraph = addressDelimiter >= 0 ? restoredAddress.slice(0, addressDelimiter) : "";
        restoredTree.attributes.graph = restoredGraph;
        restoredTree.attributes.addr = restoredAddress;
        setQueryAttribute("graph", restoredGraph || null);
        setGraphText(restoredGraph);
        restoredQueryFromUrl = true;
      }
    }
    if (restored) {
      // Endpoint selection is synchronized with the proxy cookie by the async navigation/restore caller.
      // Do not set selectedEndpointId here: doing so alone can make the dropdown disagree with the server receiving queries.
      if (typeof restored.selectedFacet === "string" && restored.selectedFacet.length < 100) setSelectedFacet(restored.selectedFacet);
      if (typeof restored.propertiesPage === "number" && Number.isFinite(restored.propertiesPage)) setPropertiesPage(Math.max(0, Math.floor(restored.propertiesPage)));
      if (typeof restored.classesPage === "number" && Number.isFinite(restored.classesPage)) setClassesPage(Math.max(0, Math.floor(restored.classesPage)));
      if (typeof restored.graphsPage === "number" && Number.isFinite(restored.graphsPage)) setGraphsPage(Math.max(0, Math.floor(restored.graphsPage)));
      if (typeof restored.rolesPage === "number" && Number.isFinite(restored.rolesPage)) setRolesPage(Math.max(0, Math.floor(restored.rolesPage)));
      if (typeof restored.findEndpointsEnabled === "boolean") setFindEndpointsEnabled(restored.findEndpointsEnabled);
      // "query-tree" was a full-pane tab in older share links; it is now the
      // lower pane, so it maps to Results plus an open Query Tree pane.
      if (["results", "groups", "query-tree", "view-query", "chat"].includes(restored.centralTab ?? "")) {
        setCentralTab(restored.centralTab === "query-tree" || restored.centralTab === "chat" ? "results" : restored.centralTab!);
      }
      if (restored.workspaceTab === "browse" || restored.workspaceTab === "view" || restored.workspaceTab === "analyze") setWorkspaceTab(restored.workspaceTab);
      if (typeof restored.queryToggle === "boolean") setQueryTreeOpen(restored.queryToggle);
      else if (restored.centralTab === "query-tree") setQueryTreeOpen(true);
      if (typeof restored.showResultBadges === "boolean") setShowResultBadges(restored.showResultBadges);
      if (typeof restored.badgesToggle === "boolean") setShowResultBadges(restored.badgesToggle);
      if (restored.breadcrumbBadgeMode === "classes" || restored.breadcrumbBadgeMode === "records") {
        setBreadcrumbBadgeMode(restored.breadcrumbBadgeMode);
        maestroStorageSet("maestro-breadcrumb-badge-mode", restored.breadcrumbBadgeMode);
      }
      if (["xml", "sparql", "alphabet-xml", "alphabet-sparql", "response"].includes(restored.querySourceFormat ?? "")) setQuerySourceFormat(restored.querySourceFormat as "xml" | "sparql" | "alphabet-xml" | "alphabet-sparql" | "response");
      if (["facets", "personal", "community"].includes(restored.defaultLeftTab ?? "")) setDefaultLeftTab(restored.defaultLeftTab!);
      if (restored.focusListOrder === "Properties" || restored.focusListOrder === "Roles") setFocusListOrder(restored.focusListOrder);
      if (typeof restored.focusWidgetsSuppressed === "boolean") setFocusWidgetsSuppressed(restored.focusWidgetsSuppressed);
      if (typeof restored.groupByPropertyUri === "string") setGroupByPropertyUri(restored.groupByPropertyUri);
      if (typeof restored.resultsUiPage === "number" && Number.isFinite(restored.resultsUiPage)) setResultsUiPage(Math.max(0, Math.floor(restored.resultsUiPage)));
      if (typeof restored.groupUiPage === "number" && Number.isFinite(restored.groupUiPage)) setGroupUiPage(Math.max(0, Math.floor(restored.groupUiPage)));
      if (typeof restored.groupBatchSize === "number" && RESULTS_BATCH_SIZE_OPTIONS.some((n) => n === restored.groupBatchSize)) setGroupBatchSize(restored.groupBatchSize);
      if (typeof restored.groupBatchOffset === "number" && Number.isFinite(restored.groupBatchOffset)) setGroupBatchOffset(Math.max(0, Math.floor(restored.groupBatchOffset)));
      if (typeof restored.resultsPageSize === "number" && Number.isFinite(restored.resultsPageSize) && restored.resultsPageSize > 0) setResultsPageSize(restored.resultsPageSize);
      if (typeof restored.selectedUri === "string") setSelectedUri(restored.selectedUri);
      // Clear Terms removes <text> from q, so preserve the hidden draft separately
      // to restore it when the user switches back to Name or All fields.
      const restoredNameProperties = Array.isArray(restored.selectedNamePropertyUris)
        ? restored.selectedNamePropertyUris.filter((uri): uri is string => typeof uri === "string" && uri.trim().length > 0)
        : typeof restored.selectedNamePropertyUri === "string" && restored.selectedNamePropertyUri.trim()
          ? restored.selectedNamePropertyUri.split(/[\s,]+/).filter(Boolean)
          : null;
      if (restoredNameProperties?.length) setSelectedNamePropertyUris(restoredNameProperties);
      if (typeof restored.savedSearchDraft === "string") {
        setSavedSearchDraft(restored.savedSearchDraft);
        if (!restoredQueryFromUrl && !restored.savedUriDraft) setSearchDraft(restored.savedSearchDraft);
      }
      if (typeof restored.savedUriDraft === "string") {
        setSavedUriDraft(restored.savedUriDraft);
        if (!restoredQueryFromUrl) setSearchDraft(restored.savedUriDraft);
      }
      if (!restoredQueryFromUrl && typeof restored.graphText === "string") {
        restoredGraphTextRef.current = restored.graphText;
        setGraphText(restored.graphText);
      }
      if (typeof restored.rdfSourceUrl === "string") setRdfSourceUrl(restored.rdfSourceUrl);
      if (typeof restored.rdfTargetGraph === "string") setRdfTargetGraph(restored.rdfTargetGraph);
    }
    // Root breadcrumb: signal status plus the URI and search-text values saved with this History item.
    // The explicit saved fields win; items saved before they existed fall back to what the query itself implies.
    {
      const rootChildren = serializedQuery ? (parseFctQueryXml(serializedQuery)?.children ?? []) : [];
      const impliedUri = rootChildren.find((node) => node.name === "value" && node.attributes.datatype === "uri");
      const impliedText = rootChildren.find((node) => node.name === "text" && node.id === "query-text");
      const impliedMode: "uri" | "name" | "all" | "clear" = impliedUri ? "uri" : !impliedText ? "clear" : impliedText.attributes.property ? "name" : "all";
      const savedMode = restored?.selectedSignalMode;
      const mode: "uri" | "name" | "all" | "clear" | null = savedMode === "uri" || savedMode === "name" || savedMode === "all" || savedMode === "clear"
        ? savedMode
        : (serializedQuery ? impliedMode : null);
      if (mode) {
        selectedSignalModeRef.current = mode;
        setSelectedSignalMode(mode);
      }
      if (serializedQuery || restored) {
        const uriValue = typeof restored?.savedUriDraft === "string" ? restored.savedUriDraft : (impliedUri?.text ?? "");
        const textValue = typeof restored?.savedSearchDraft === "string" ? restored.savedSearchDraft : (impliedText?.text ?? "");
        setSavedUriDraft(uriValue);
        setSavedSearchDraft(textValue);
        const shown = typeof restored?.searchDraft === "string" ? restored.searchDraft : (mode === "uri" ? uriValue : mode === "clear" ? "" : textValue);
        searchDraftRef.current = shown;
        setSearchDraft(shown);
      }
    }
    return restoredQueryFromUrl;
  }

  // Restore the initial share URL once. Subsequent state changes only rewrite
  // the address bar; they never navigate or rerun this initializer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Select the URL tab before restoring any query or saved UI state.
    const tabFromUrl = params.get("tab");
    if (tabFromUrl === "browse" || tabFromUrl === "view" || tabFromUrl === "analyze") setWorkspaceTab(tabFromUrl);
    restoreQueryAndUiState(params.get("q"), readShareableUiState(), params.get("history"));
    // An explicit ?tab= wins over a possibly older workspaceTab in saved state.
    if (tabFromUrl === "browse" || tabFromUrl === "view" || tabFromUrl === "analyze") setWorkspaceTab(tabFromUrl);
    setUrlStateInitialized(true);
  // This is intentionally a one-time initializer for the initial URL only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlStateInitialized) return;
    const params = new URLSearchParams(window.location.search);
    params.set("q", queryXml);
    params.set("tab", workspaceTab);
    const state: ShareableUiState = {
      selectedFacet,
      propertiesPage,
      classesPage,
      graphsPage,
      rolesPage,
      findEndpointsEnabled,
      centralTab,
      workspaceTab,
      queryToggle: queryTreeOpen,
      showResultBadges,
      badgesToggle: showResultBadges,
      querySourceFormat,
      defaultLeftTab,
      focusListOrder,
      focusWidgetsSuppressed,
      groupByPropertyUri,
      resultsUiPage,
      groupUiPage,
      groupBatchSize,
      groupBatchOffset,
      resultsPageSize,
      selectedUri,
      graphText,
      rdfSourceUrl,
      rdfTargetGraph,
      selectedSignalMode,
      searchDraft,
      savedSearchDraft,
      savedUriDraft,
      selectedNamePropertyUris,
      breadcrumbBadgeMode,
    };
    params.set("state", JSON.stringify(state));
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [urlStateInitialized, queryXml, queryRevision, selectedEndpointId, selectedFacet, propertiesPage, classesPage, graphsPage, rolesPage, findEndpointsEnabled, centralTab, workspaceTab, queryTreeOpen, showResultBadges, querySourceFormat, defaultLeftTab, focusListOrder, focusWidgetsSuppressed, groupByPropertyUri, resultsUiPage, groupUiPage, groupBatchSize, groupBatchOffset, resultsPageSize, selectedUri, graphText, rdfSourceUrl, rdfTargetGraph, savedSearchDraft, savedUriDraft, selectedNamePropertyUris, breadcrumbBadgeMode, selectedSignalMode, searchDraft]);

  /** Describe the first XML-tree delta between two query snapshots for History replay. */
  function deriveHistoryAction(previousXml: string, nextXml: string): { operator: "+" | "-"; xpath: string; value?: string } | null {
    if (!previousXml || !nextXml || previousXml === nextXml) return null;
    type Entry = { signature: string; value: string };
    const flatten = (xml: string) => {
      const document = new DOMParser().parseFromString(xml, "application/xml");
      if (document.querySelector("parsererror")) return new Map<string, Entry>();
      const entries = new Map<string, Entry>();
      const walk = (element: Element, path: string) => {
        const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((item) => item.localName === element.localName) : [element];
        const index = Math.max(1, siblings.indexOf(element) + 1);
        const attributes = Array.from(element.attributes).map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(";");
        const directText = Array.from(element.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent ?? "").join("").trim();
        const xpathLiteral = (value: string) => value.includes("'") && value.includes('"')
          ? `concat(${value.split("'").map((part, i) => `${i ? `, "'", ` : ""}'${part}'`).join("")})`
          : value.includes("'") ? `\"${value}\"` : `'${value}'`;
        const identityPredicates = Array.from(element.attributes)
          .filter((attribute) => ["iri", "datatype", "op", "id", "type", "exclude", "property"].includes(attribute.name))
          .map((attribute) => `[@${attribute.name}=${xpathLiteral(attribute.value)}]`).join("");
        const textPredicate = directText ? `[.=${xpathLiteral(directText)}]` : "";
        const currentPath = `${path}/${element.localName}${identityPredicates}${textPredicate}[${index}]`;
        entries.set(currentPath, { signature: `${element.localName}|${attributes}|${directText}`, value: directText || attributes || element.localName });
        Array.from(element.children).forEach((child) => walk(child, currentPath));
      };
      if (document.documentElement) walk(document.documentElement, "");
      return entries;
    };
    const before = flatten(previousXml), after = flatten(nextXml);
    const added = [...after].find(([path, entry]) => !before.has(path) || before.get(path)?.signature !== entry.signature);
    const removed = [...before].find(([path, entry]) => !after.has(path) || after.get(path)?.signature !== entry.signature);
    if (added && (!removed || added[0].split("/").length >= removed[0].split("/").length)) {
      return { operator: "+", xpath: added[0], value: added[1].value };
    }
    if (removed) return { operator: "-", xpath: removed[0], value: removed[1].value };
    return null;
  }

  /** Persist one History visit for a query snapshot, preserving queue ordering. */
  async function writeHistoryVisit(queryXmlSnapshot: string, stateUrlSnapshot: string, action: { operator: "+" | "-"; xpath: string; value?: string } | null) {
    const response = await fetch("/proxy/api/query-favorites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "visit", queryXml: queryXmlSnapshot, stateUrl: stateUrlSnapshot, historyAction: action }), cache: "no-store",
    });
    const payload = await response.json() as { historyId?: string; error?: string };
    if (!response.ok || !payload.historyId) throw new Error(payload.error ?? `HTTP ${response.status}`);
    historyVisitIdRef.current = payload.historyId;
    setHistoryBookmarkId(payload.historyId);
    // Persist the URL captured for this exact query visit, not the current URL.
    const visitUrl = new URL(stateUrlSnapshot, window.location.origin);
    visitUrl.searchParams.set("history", payload.historyId);
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get("q") === queryXmlSnapshot) {
      currentParams.set("history", payload.historyId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${currentParams.toString()}${window.location.hash}`);
    }
    await fetch("/proxy/api/query-favorites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateState", historyId: payload.historyId, stateUrl: visitUrl.toString() }), cache: "no-store",
    });
  }

  // Each distinct FCT query gets its own History record. While the root breadcrumb
  // search is visible, coalesce all query/UI changes and persist only the latest
  // snapshot after the search closes. UI-only changes otherwise update the visit.
  useEffect(() => {
    if (!urlStateInitialized) return;
    // Not logged in: never record History. Tracking refs stay untouched so the current query is recorded as a fresh visit after login.
    if (!authSession || templateHistoryFlushRef.current) return;
    const stateUrl = window.location.href;
    const previousQueryXml = historyVisitQueryRef.current;
    const isInitialLoadedHistoryItem = Boolean(historyBookmarkId && !previousQueryXml);
    const isNewQuery = !isInitialLoadedHistoryItem && previousQueryXml !== queryXml;
    const queryAction = isNewQuery ? deriveHistoryAction(previousQueryXml, queryXml) : null;
    historyVisitQueryRef.current = queryXml;
    if (isInitialLoadedHistoryItem) historyVisitIdRef.current = historyBookmarkId;

    const synchronize = async () => {
      try {
        if (isNewQuery) {
          await writeHistoryVisit(queryXml, stateUrl, queryAction);
          return;
        }

        // On initial restoration, keep the selected History item as the cursor.
        // On UI-only state changes, update its URL without creating a new visit.
        const currentId = historyBookmarkId;
        // Never overwrite an older visit's URL with the URL for a newer query
        // while that newer query's History item is still being written.
        if (currentId && historyVisitIdRef.current === currentId && historyVisitQueryRef.current === queryXml) {
          await fetch("/proxy/api/query-favorites", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updateState", historyId: currentId, stateUrl }), cache: "no-store",
          });
        }
      } catch (error) {
        console.warn("Maestro History synchronization failed", error);
      }
    };

    if (rootSearchExpanded) {
      // No History writes while the root search field is visible. Only create a
      // pending snapshot once a query changes, then replace it with the latest
      // query/state whenever more changes occur.
      if (isNewQuery || pendingHistoryVisitRef.current) {
        const pendingPreviousXml = pendingHistoryVisitRef.current?.queryXml ?? previousQueryXml;
        pendingHistoryVisitRef.current = { queryXml, stateUrl, action: deriveHistoryAction(pendingPreviousXml, queryXml) };
      }
      return;
    }
    const pending = pendingHistoryVisitRef.current;
    if (pending) {
      pendingHistoryVisitRef.current = null;
      // Persist the final coalesced snapshot, not a separately reconstructed
      // value. Intermediate snapshots are discarded when the ref is cleared.
      const persistLatest = async () => {
        if (rootSearchExpandedRef.current) {
          pendingHistoryVisitRef.current = { queryXml: pending.queryXml, stateUrl: pending.stateUrl, action: pending.action };
          return;
        }
        try {
          await writeHistoryVisit(pending.queryXml, pending.stateUrl, pending.action);
        } catch (error) {
          console.warn("Maestro History synchronization failed", error);
        }
      };
      historyWriteQueueRef.current = historyWriteQueueRef.current.then(persistLatest, persistLatest);
      return;
    }
    const synchronizeWhenCollapsed = async () => {
      if (rootSearchExpandedRef.current) {
        pendingHistoryVisitRef.current = { queryXml, stateUrl, action: queryAction };
        return;
      }
      await synchronize();
    };
    historyWriteQueueRef.current = historyWriteQueueRef.current.then(synchronizeWhenCollapsed, synchronizeWhenCollapsed);
    // Do not cancel queued writes in effect cleanup; pending History is flushed
    // when the root breadcrumb search field closes.
  }, [urlStateInitialized, queryXml, queryRevision, historyBookmarkId, selectedEndpointId, selectedFacet, propertiesPage, classesPage, graphsPage, rolesPage, findEndpointsEnabled, centralTab, workspaceTab, queryTreeOpen, showResultBadges, querySourceFormat, defaultLeftTab, focusListOrder, focusWidgetsSuppressed, groupByPropertyUri, resultsUiPage, groupUiPage, groupBatchSize, groupBatchOffset, resultsPageSize, selectedUri, graphText, rdfSourceUrl, rdfTargetGraph, savedSearchDraft, savedUriDraft, selectedNamePropertyUris, rootSearchExpanded, authSession, selectedSignalMode]);

  // The graph text box may contain an unapplied draft distinct from the query's graph binding.
  // Restore that draft after the query-graph synchronization effect has run once.
  useEffect(() => {
    if (!urlStateInitialized || restoredGraphTextRef.current === null) return;
    setGraphText(restoredGraphTextRef.current);
    restoredGraphTextRef.current = null;
  }, [urlStateInitialized, queryRevision]);

  const activeViewPropertyFilters = getActiveViewPropertyFilters(queryTree);
  const rdfTypePropertyNode = activeViewPropertyFilters.find((node) => node.attributes.iri === RDF_TYPE_URI);
  const groupByOptions: GroupByOption[] = [
    { key: "", uri: "", direction: "forward", label: "none", nodeId: "" },
    // RDF type is permanent dropdown furniture, but it uses the ordinary forward-property grouping path.
    ...(rdfTypePropertyNode?.attributes.exclude?.trim().toLowerCase() === "yes" ? [] : [{ key: `forward:${RDF_TYPE_URI}`, uri: RDF_TYPE_URI, direction: "forward" as const, label: "Category", nodeId: rdfTypePropertyNode?.id ?? "group-by-rdf-type" }]),
    ...activeViewPropertyFilters.flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri || uri === RDF_TYPE_URI || node.attributes.exclude?.trim().toLowerCase() === "yes") return [];
      return [{ key: `forward:${uri}`, uri, direction: "forward" as const, label: toLabel(uri, "Property"), nodeId: node.id }];
    }),
    // Only reverse-role nodes explicitly selected in Focus belong in Group By.
    // A <property-of> ancestor that merely contains the active <view> is a
    // navigation/scope breadcrumb, not a checked relationship selection.
    ...getActiveViewRoleFilters(queryTree).flatMap((node) => {
      const uri = node.attributes.iri;
      if (typeof uri !== "string" || !uri || node.attributes.exclude?.trim().toLowerCase() === "yes") return [];
      return [{ key: `reverse:${uri}`, uri, direction: "reverse" as const, label: `${toLabel(uri, "Role")} of`, nodeId: node.id }];
    }).filter((option, index, all) => all.findIndex((candidate) => candidate.key === option.key) === index),
  ];
  const selectedGroupByOption = groupByOptions.find((option) => option.key !== "" && option.key === groupByPropertyUri) ?? null;
  useEffect(() => {
    if (groupByPropertyUri && !groupByOptions.some((option) => option.key === groupByPropertyUri)) {
      // Opening Code Block does not mutate the FCT query. Ignore transient
      // facet-option gaps during that pane switch; restore the grouping when
      // returning to Results instead of treating the pane switch as deselection.
      if (groupByBeforeCodeViewRef.current === groupByPropertyUri) return;
      setGroupByPropertyUri("");
      setCentralTab((current) => current === "groups" ? "results" : current);
    }
  }, [groupByPropertyUri, groupByOptions.map((option) => option.key).join("|"), centralTab]);
  useEffect(() => {
    if (groupByBeforeCodeViewRef.current && centralTab !== "view-query" && groupByOptions.some((option) => option.key === groupByBeforeCodeViewRef.current)) {
      groupByBeforeCodeViewRef.current = "";
    }
  }, [centralTab, groupByOptions.map((option) => option.key).join("|")]);
  const [groupValues, setGroupValues] = useState<FctResult[]>([]);
  const [groupValuesLoading, setGroupValuesLoading] = useState(false);
  const [groupValuesError, setGroupValuesError] = useState("");
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMembersState>>({});
  const groupMemberRequestStates = useRef(new Map<string, "loading" | "loaded">());
  // Counts are derived from the member rows loaded for each visible group.
  // Keep the index and cards in the same descending-count order.
  // Order the WHOLE loaded set with the canonical comparator before paging, so page N of the cards, the group
  // index, and the grouped Personal facet widget (same comparator, same query) all list values in one order.
  const orderedGroupValues = groupValues.slice().sort(compareGroupValues);
  const pageGroupValues = orderedGroupValues.slice(groupUiPage * resultsPageSize, (groupUiPage + 1) * resultsPageSize);
  const visibleGroupValues = pageGroupValues;
  const groupedPersonalFacetUri = selectedGroupByOption?.direction === "forward"
    && selectedGroupByOption.uri !== RDF_TYPE_URI
    && personalWidgets.some((widget) => widget.uri === selectedGroupByOption.uri && !widget.excluded)
    ? selectedGroupByOption.uri
    : null;
  const isGroupByCategory = selectedGroupByOption?.direction === "forward" && selectedGroupByOption.uri === RDF_TYPE_URI;
  const groupedRoleUri = selectedGroupByOption?.direction === "reverse"
    ? selectedGroupByOption.uri
    : null;
  const groupedFacetActive = Boolean(groupedPersonalFacetUri || groupedRoleUri || isGroupByCategory);

  // Entering Group by mode selects the matching facet pane once. Do not make
  // the pane depend continuously on groupBy state: users must still be able to
  // open Configure while grouping is active.
  useEffect(() => {
    if (!groupedFacetActive) return;
    setDefaultLeftTab("personal");
  }, [groupedFacetActive, isGroupByCategory, groupedPersonalFacetUri]);


  useEffect(() => {
    const pendingKey = pendingGroupScrollRef.current;
    if (!pendingKey || centralTab !== "groups") return;
    const target = groupCardRefs.current.get(pendingKey);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingGroupScrollRef.current = null;
    }
  }, [centralTab, groupUiPage, visibleGroupValues.map(groupValueKey).join("|")]);

  function scrollToGroupForFacetValue(value: FctResult) {
    if (centralTab !== "groups" || !selectedGroupByOption) return;
    const clickedKey = facetValueKey(value);
    let matchIndex = orderedGroupValues.findIndex((groupValue) => facetValueKey(groupValue) === clickedKey);
    // Fall back to the value's identity (URI/text + language) if term-type metadata differs between the two panes.
    if (matchIndex < 0) matchIndex = orderedGroupValues.findIndex((groupValue) => groupValue.uri === value.uri && (groupValue.lang ?? "") === (value.lang ?? ""));
    if (matchIndex < 0) return;
    const groupValue = orderedGroupValues[matchIndex];
    const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
    const targetPage = Math.floor(matchIndex / resultsPageSize);
    if (targetPage !== groupUiPage) {
      pendingGroupScrollRef.current = key;
      setGroupUiPage(targetPage);
      return;
    }
    groupCardRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const sourceSparql = sparqlQuery || "# SPARQL will appear after the endpoint returns a query.";
  const queryWithoutPagingXml = useCallback(
  (viewType?: FctViewType, sortByCount = false, classTree = false) =>
    serializeFctQuery(
      setQueryViewAttributes(queryTree, {
        ...(viewType ? { type: viewType } : {}),
        sort: sortByCount ? "count" : "",
        // tree="yes" adds every superclass up to the root, so the view returns one row per
        // (class, parent) edge and needs a much larger window than the flat list.
        limit: String(classTree ? CATEGORY_TREE_QUERY_LIMIT : leftPanelLimit),
        offset: "0",
        ...(classTree ? { tree: "yes" } : {}),
      }),
    ),
  [queryTree, leftPanelLimit],
);
  // Snapshot the semantic facet requests. Effects depend on their serialized XML,
  // not queryWithoutPagingXml's callback identity (which changes on every tree edit).
  const propertyFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES);
  // The flat Categories list is authoritative in both display modes. Tree mode only changes its arrangement.
  const classFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, isGroupByCategory, false);
  const roleFacetQueryXml = queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN);
  // For broad scans of large public endpoints, use the tested rdfs:label-only
  // alphabet query. Other label predicates in the former 17-way join made the
  // aggregation prohibitively expensive on the Virtuoso DBpedia demo.
  const alphabetLabelUris = "http://www.w3.org/2000/01/rdf-schema#label";
  // The Alphabet system facet queries a clone of the live scope and never
  // constrains its own counts by the currently selected letter.
  const alphabetQueryXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
    type: FCT_VIEW_TYPES.ALPHABET, index: "", indexLabels: alphabetLabelUris, limit: "26", offset: "0",
  }));
  // ASK preflight: clone the *live* query and append only the label
  // relationship to its active view scope. Do not run the alphabet query,
  // its language/initial filters, GROUP BY, or any count until ASK is true.
  const alphabetAskQueryXml = (() => {
    const clone = setQueryViewAttributes(queryTree, {
      type: FCT_VIEW_TYPES.ASK, index: "", limit: "1", offset: "0",
    });
    const addLabelAtViewScope = (nodes: FctQueryNode[]): FctQueryNode[] => {
      if (nodes.some((node) => node.name === "view")) return [
        ...nodes,
        { id: "alphabet-preflight-label", name: "property", attributes: { iri: alphabetLabelUris }, children: [] },
      ];
      return nodes.map((node) => ({ ...node, children: addLabelAtViewScope(node.children) }));
    };
    return serializeFctQuery({ ...clone, children: addLabelAtViewScope(clone.children) });
  })();
  // Show the same locally compiled SPARQL that the FCT proxy executes for
  // this alphabet request. Keep failures visible in Code Block for diagnosis.
  const alphabetSparql = (() => {
    try {
      return compileFctXmlToSparql(alphabetQueryXml).query;
    } catch (error) {
      return `# Alphabet SPARQL compilation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  const currentView = (() => {
    const seek = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.name === "view") return node;
        const child = seek(node.children);
        if (child) return child;
      }
    };
    return seek(queryTree.children);
  })();
  const alphabetIndex = currentView?.attributes.index || "";
  const [alphabetCounts, setAlphabetCounts] = useState<Record<string, number>>({});
  const alphabetCountsQueryRef = useRef("");
  const [alphabetError, setAlphabetError] = useState("");
  const [isLoadingAlphabet, setIsLoadingAlphabet] = useState(false);
  const [alphabetPreflight, setAlphabetPreflight] = useState<"checking" | "available" | "unavailable">("checking");
  // Ask FCT for the total independently of the current results page. The
  // count view uses the same active scope and filters, but never the page offset.
  const queryCountXml = serializeFctQuery(
    setQueryViewAttributes(queryTree, { type: FCT_VIEW_TYPES.TEXT, limit: "1000", offset: "0" }),
  );

  const [results, setResults] = useState<FctResult[]>([]);
  const resultsEnrichmentCacheRef = useRef(new Map<string, ScopeValue[]>());
  const resultsBatchRequestPending = useRef(false);
  const resultsLoadedQueryIdentityRef = useRef("");
  const activeQueryIdentityRef = useRef("");
  const previousResultsQueryIdentityRef = useRef("");
  const queryGraphServer = readGraphServerFromQueryXml(queryCountXml);
  const endpointReadyForQuery = Boolean(
    selectedEndpointId &&
    selectedEndpointStatus?.state === "ok" &&
    selectedEndpointStatus.status === 200 &&
    // addr is authoritative: a restored query must not race ahead of its server.
    (queryGraphServer && fctEndpoints.some((endpoint) =>
      endpoint.id === selectedEndpointId &&
      (queryGraphServer === endpoint.url)
    ))
  );

  // A URL load or an attempted query against a non-green server triggers
  // exactly one selected-server health check. No startup failover or bulk scans.
  const lastPreflightRef = useRef("");
  const preflightInFlightRef = useRef("");
  useEffect(() => {
    if (!urlStateInitialized || !selectedEndpointId) return;
    const selected = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!selected || queryGraphServer !== selected.url) return;
    if (selectedEndpointStatus?.state === "ok" && selectedEndpointStatus.status === 200) return;
    const probeKey = `${selected.url}\u0000${queryRefreshRevision}\u0000${queryRevision}`;
    if (lastPreflightRef.current === probeKey || preflightInFlightRef.current === selected.url) return;
    lastPreflightRef.current = probeKey;
    preflightInFlightRef.current = selected.url;
    void (async () => {
      try {
        // A cold start can race the proxy registry/session initialization. Only
        // report an unavailable server after a couple of bounded retries; the
        // manual toast Refresh used to work because it happened later.
        let health: EndpointStatus | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, attempt * 900));
          health = await checkSelectedGraphServer(selected);
          if (health.state === "ok" && health.status === 200) break;
        }
        if (health?.state !== "ok" || health.status !== 200) {
          setEndpointHealthToast({ endpointId: selected.id, message: `Graph server ${selected.label} is unavailable.` });
        } else {
          setEndpointHealthToast(null);
        }
      } finally {
        if (preflightInFlightRef.current === selected.url) preflightInFlightRef.current = "";
        setIsCheckingEndpoints(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStateInitialized, selectedEndpointId, fctEndpoints, queryGraphServer, queryRefreshRevision, queryRevision]);

  // A cheap ASK first determines whether the current scope has labels.
  // Only a true response reveals the pane and starts counts.
  // Both requests share the same AbortController so navigation cannot publish
  // stale letters or reveal the pane for an earlier query.
  useEffect(() => {
    const controller = new AbortController();
    if (alphabetCountsQueryRef.current !== alphabetQueryXml) {
      alphabetCountsQueryRef.current = alphabetQueryXml;
      setAlphabetCounts({});
    }
    setAlphabetPreflight("checking");
    setIsLoadingAlphabet(false);
    setAlphabetError("");
    if (!selectedEndpointId || !endpointReadyForQuery) {
      setAlphabetPreflight("unavailable");
      return () => controller.abort();
    }
    void (async () => {
      try {
        const askResponse = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("alphabet-ask", "AlphabetSystemFacetAsk") },
          body: alphabetAskQueryXml,
        });
        const askXml = await askResponse.text();
        if (!askResponse.ok) throw new Error(`Alphabet preflight returned HTTP ${askResponse.status}: ${askXml.slice(0, 300)}`);
        const askDoc = new DOMParser().parseFromString(askXml, "application/xml");
        if (askDoc.querySelector("parsererror")) throw new Error("Invalid alphabet ASK response XML.");
        const decision = Array.from(askDoc.getElementsByTagName("*")).find((node) => node.localName === "boolean")?.textContent?.trim();
        if (decision !== "true" && decision !== "false") throw new Error("Alphabet preflight returned no valid boolean.");
        if (controller.signal.aborted) return;
        if (decision === "false") {
          setAlphabetPreflight("unavailable");
          setAlphabetCounts({});
          return;
        }
        setAlphabetPreflight("available");
        setIsLoadingAlphabet(true);
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("alphabet-facet", "AlphabetSystemFacet") },
          body: alphabetQueryXml,
        });
        const payload = await readFctResponse(response);
        if (!controller.signal.aborted) {
          setMaestroIncompleteResults("alphabet", { incomplete: payload.incomplete, requestId: "", message: payload.warning || payload.sqlMessage || "" });
        }
        const next: Record<string, number> = {};
        for (const row of payload.rows) {
          const rawKey = (row[0]?.value ?? "").trim();
          const match = /^(?:["']?)([A-Za-z])(?:["']?)$/.exec(rawKey);
          const key = match?.[1].toUpperCase();
          const count = Number(row[1]?.value ?? 0);
          if (key && Number.isFinite(count) && count >= 0) next[key] = (next[key] ?? 0) + count;
        }
        if (!controller.signal.aborted) {
          setAlphabetCounts(next);
          if (!Object.values(next).some((count) => count > 0)) setAlphabetPreflight("unavailable");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAlphabetError(error instanceof Error ? error.message : "Could not load alphabet counts.");
          setAlphabetPreflight("unavailable");
          setAlphabetCounts({});
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingAlphabet(false);
      }
    })();
    return () => controller.abort();
  }, [alphabetQueryXml, alphabetAskQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  useEffect(() => {
    // Keep the view's persisted index label predicates consistent with changes
    // to the user's selected root search label properties.
    if (!alphabetIndex) return;
    if ((currentView?.attributes.indexLabels ?? "") !== alphabetLabelUris) setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
  }, [alphabetIndex, currentView?.attributes.indexLabels, alphabetLabelUris]);

  // Keep the active request identity current for stale-response protection, but
  // do not clear widgets merely because arbitrary query state changed. The
  // coordinated clear is invoked only by the explicit view-navigation actions.
  useLayoutEffect(() => {
const queryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;
activeQueryIdentityRef.current = queryIdentity;
}, [queryCountXml, selectedEndpointId, endpointReadyForQuery]);

useEffect(() => {
  if (!urlStateInitialized) return;
  const nextIdentity = `${selectedEndpointId}\u0000${queryCountXml}`;
  const previousIdentity = previousResultsQueryIdentityRef.current;

  previousResultsQueryIdentityRef.current = nextIdentity;

  // Keep the initial load; reset only when an existing query changes.
  if (!previousIdentity || previousIdentity === nextIdentity) return;

  setResultsUiPage(0);
  setResults([]);
  resultsLoadedQueryIdentityRef.current = "";
  resultsBatchRequestPending.current = false;
  setResultsPageMatchCount(0);
  setResultsPageComplete(false);
  setResultsTotalCount(null);
  setSelectedUri("");
  setDescribedRecord([]);
  setRecordDescriptionPage(0);
  setSparqlQuery("");
  setSearchError("");

  // Restart server-side paging at offset zero for the new query.
  if (resultsOffset !== 0) {
    setResultsPage(resultsBatchSize, 0);
  }
}, [
  queryResultsXml,
  selectedEndpointId,
  urlStateInitialized,
  resultsOffset,
  resultsBatchSize,
  setResultsPage,
]);

  function clearWidgetsForViewChange() {
    setResultsUiPage(0);
    setResults([]);
    resultsLoadedQueryIdentityRef.current = "";
    resultsBatchRequestPending.current = false;
    setResultsPageMatchCount(0);
    setResultsPageComplete(false);
    setResultsTotalCount(null);
    setIsCountingResults(endpointReadyForQuery);
    setIsSearching(endpointReadyForQuery);
    setSearchError("");
    setSparqlQuery("");
    setSelectedUri("");
    setDescribedRecord([]);
    setIsDescribing(false);

    // Keep the persistent facet widget shells/headers; clear only their data.
    // Keep the last successful Configure lists visible while replacement requests
    // load. A transient health failure must not remove the Configure buttons.
    setClassFacets([]); setClassTreeEdges([]);
    setGraphFacets([]);
    setPropertyFacetSparql("");
    setRoleFacetSparql("");
    setPropertyFacetError("");
    setClassFacetError("");
    setRoleFacetError("");
    setIsLoadingProperties(endpointReadyForQuery);
    setIsLoadingClasses(endpointReadyForQuery);
    setIsLoadingRoles(endpointReadyForQuery);
    setIsLoadingGraphs(endpointReadyForQuery);

    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupValuesLoading(false);
    setGroupValuesError("");
    setGroupMembers({});
    setFocusWidgetsSuppressed(true);
    setPersonalWidgets([]);

    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });

    if (resultsOffset !== 0) setResultsPage(resultsBatchSize, 0);
  }

  function navigateToPropertyPath(targetId: string) {
    const path = getPropertyPath();
    const currentPathId = path[path.length - 1]?.id ?? "query-root";
    if (targetId !== currentPathId) clearWidgetsForViewChange();
    navigateToPropertyPathRaw(targetId);
  }

  /** Root breadcrumb action, shared by its button and the Refresh fallback. */
  function handleRootBreadcrumbClick() {
    clearTutorialPreview();
    setDefaultLeftTab("personal");
    navigateToPropertyPath("query-root");
  }

  /** Use the breadcrumb's single navigation path for relationship crumbs. */
  function handleBreadcrumbClick(targetId: string) {
    clearTutorialPreview();
    setDefaultLeftTab("personal");
    navigateToPropertyPath(targetId);
  }

  /** Toolbar Refresh repeats the current query, checking only a non-green server. */
  async function refreshMaestroPage() {
    const selected = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!selected) return;
    const status = endpointStatuses[selected.id];
    if (!(status?.state === "ok" && status.status === 200)) {
      const health = await checkSelectedGraphServer(selected);
      if (health.state !== "ok" || health.status !== 200) {
        setEndpointHealthToast({ endpointId: selected.id, message: `Graph server ${selected.label} is unavailable.` });
        return;
      }
      setEndpointHealthToast(null);
    }
    refreshQuery();
    setQueryRefreshRevision((revision) => revision + 1);
    setSearchPipelineRun((revision) => revision + 1);
  }

  function refreshCurrentBreadcrumb() {
    const activeBreadcrumbButton = activeBreadcrumbButtonRef.current;
    if (activeBreadcrumbButton) {
      activeBreadcrumbButton.click();
      return;
    }
    const activeCrumb = displayedBreadcrumbPath[activeBreadcrumbIndex];
    if (activeCrumb) handleBreadcrumbClick(activeCrumb.id);
    else handleRootBreadcrumbClick();
  }

  function moveViewToSibling(currentFocusId: string, targetId: string) {
    if (currentFocusId !== targetId) clearWidgetsForViewChange();
    moveViewToSiblingRaw(currentFocusId, targetId);
  }
  const [resultsTotalCount, setResultsTotalCount] = useState<number | null>(null);
  const [resultsPageMatchCount, setResultsPageMatchCount] = useState(0);
  // A short SPARQL result batch is the signal that this result stream has ended.
  // The separate scalar count is used for the overall pager, not as a substitute
  // for the actual result bindings returned by the current page query.
  const [resultsPageComplete, setResultsPageComplete] = useState(false);
  // The FCT Results request is paged, so a short batch only says that this
  // page is the end of the stream; it must not override a larger scalar count
  // for the whole query (e.g. 930 matches but 14 rows in the current FCT view).
  // Use the completed result stream only as a fallback when scalar counting is
  // unavailable, and never let a stale/partial batch lower a valid total.
  const effectiveResultsTotalCount = resultsTotalCount === null
    ? (resultsPageComplete ? results.length : null)
    : Math.max(resultsTotalCount, results.length);
  type RecordValueTerm = {
    property: string;
    value: string;
    direction: "property" | "property-of";
    termType: "uri" | "literal" | "bnode";
    datatype?: string;
    lang?: string;
  };
  const [describedRecord, setDescribedRecord] = useState<RecordValueTerm[]>([]);
  const [describedRecordUri, setDescribedRecordUri] = useState("");
  // One authoritative SELECT snapshot feeds both Default and graph-stored XSLT formats.
  // Keep its XML, record identity, and completion flag together to prevent stale formatting.
  const [recordDescriptionSnapshot, setRecordDescriptionSnapshot] = useState<{
    key: string; uri: string; xml: string; incomplete: boolean;
  } | null>(null);

  // Graph provenance is discovered separately; Record SELECT is authoritative.
  const [recordGraphs, setRecordGraphs] = useState<string[]>([]);
  const [selectedRecordGraph, setSelectedRecordGraph] = useState("");
  const [selectedRecordAuthor, setSelectedRecordAuthor] = useState("");
  const [recordGraphError, setRecordGraphError] = useState("");
  const [loadingRecordGraphs, setLoadingRecordGraphs] = useState(false);
  const [loadingRecordAuthors, setLoadingRecordAuthors] = useState(false);
  const [recordAuthorError, setRecordAuthorError] = useState("");
  // A named graph's family is its full IRI before the first fragment delimiter.
  // Its #ID remains essential for physical named-graph selection and authorship.
  type RecordGraphAuthor = { graph: string; author: string; predicate: string };
  const [recordGraphAuthors, setRecordGraphAuthors] = useState<RecordGraphAuthor[]>([]);
  const recordGraphFamily = (iri: string): string => iri.split("#", 1)[0];
  const recordGraphOptions = Array.from(new Set(recordGraphs.map(recordGraphFamily)));
  const graphsInSelectedFamily = recordGraphs.filter((graph) =>
    !selectedRecordGraph || recordGraphFamily(graph) === selectedRecordGraph
  );
  const recordAuthors = recordGraphAuthors.filter((entry) => graphsInSelectedFamily.includes(entry.graph));

  type RecordPolicyOption = { uri: string; label: string; recordShape: string; matchedClasses: string[]; templates: { uri: string; label: string }[]; template: string | null };
  const [recordPolicies, setRecordPolicies] = useState<RecordPolicyOption[]>([]);
  const [recordPolicy, setRecordPolicy] = useState<RecordPolicyOption | null>(null);
  const [selectedRecordTemplateUri, setSelectedRecordTemplateUri] = useState("");
  // A user-selected format wins over automatic policy selection for that Record/query.
  const manualRecordFormatSelectionRef = useRef<{ recordUri: string; queryXml: string; policyUri: string; templateUri: string } | null>(null);
  // Format choices belong to the selected Category (rdf:type), never to an individual record.
  // Explicitly checked Categories take precedence when a resource has several types.
  const recordFormatCategory = (): string => {
    const propertyPath = getPropertyPath();
    const scopeId = propertyPath[propertyPath.length - 1]?.id ?? null;
    const selectedCategories = getClassesAtNode(scopeId);
    const recordTypes = describedRecord
      .filter((item) => item.direction === "property" && item.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
      .map((item) => item.value);
    return selectedCategories.find((iri) => recordTypes.includes(iri))
      ?? selectedCategories[0] ?? recordTypes[0] ?? "";
  };
  const recordFormatPreferenceKey = (kind: "policy" | "template"): string => {
    const category = recordFormatCategory();
    return category ? `record-${kind}-category:${category}` : "";
  };
  const [isLoadingRecordPolicy, setIsLoadingRecordPolicy] = useState(false);
  const [recordPolicyCheckedUri, setRecordPolicyCheckedUri] = useState("");
  const [recordPolicyError, setRecordPolicyError] = useState("");
  const [recordValidation, setRecordValidation] = useState<{ conforms: boolean; complete: boolean; violations: { path: string; message: string; value?: string }[]; optionalMissing?: { path: string; name: string }[]; unsupportedConstraints: string[]; message: string } | null>(null);
  const [isValidatingRecord, setIsValidatingRecord] = useState(false);
  const [formattedRecordHtml, setFormattedRecordHtml] = useState("");
  // URI label lookups are presentation enhancements; never block the initial card.
  const recordUriLabelCacheRef = useRef(new Map<string, string>());
  const [recordLabelRevision, setRecordLabelRevision] = useState(0);
  const [formattedRecordButtonsHtml, setFormattedRecordButtonsHtml] = useState<Record<string, string>>({});
  const [recordFormatPreviews, setRecordFormatPreviews] = useState<Record<string, string>>({});
  const [recordFormatMenuOpen, setRecordFormatMenuOpen] = useState(false);
  const [recordControlsOpen, setRecordControlsOpen] = useState(true);
  const [recordFormatError, setRecordFormatError] = useState("");
  const [bookmarkQueryDebugOpen, setBookmarkQueryDebugOpen] = useState(false);
  const [bookmarkQueryDebug, setBookmarkQueryDebug] = useState({ xml: "", sparql: "", response: "", countResponse: "" });
  // SHACL-discovered services use the same rendered Book XSLT tab host as
  // Other Properties. Their operations and XSLT live in the personal graph.
  type RecordService = { uri: string; label: string; operations: { uri: string; label: string; requires: string[] }[] };
  type ServiceResult = { html: string; error: string; loading: boolean; name: string };
  const [recordServices, setRecordServices] = useState<RecordService[]>([]);
  const [recordServiceTab, setRecordServiceTab] = useState("");
  const [recordServiceResults, setRecordServiceResults] = useState<Record<string, ServiceResult>>({});
  const [recordServiceArguments, setRecordServiceArguments] = useState<Record<string, Record<string, string>>>({});
  const [recordServiceDom, setRecordServiceDom] = useState<{tabs: HTMLElement; host: HTMLElement} | null>(null);
  const activeServiceRecordRef = useRef("");
  const formattedRecordContainerRef = useRef<HTMLDivElement>(null);
  const [recordDebug, setRecordDebug] = useState({ xml: "", sparql: "", formatterXml: "", formatterSparql: "", policyDiscovery: "", templateLookup: "" });
  /** Download the RDF triples in the exact DESCRIBE snapshot shown in Record. */
  function downloadRecordDescribe() {
    const snapshot = recordDescriptionSnapshot;
    if (!snapshot || snapshot.key !== currentRecordDescriptionKey || snapshot.uri !== selectedUri) return;
    const parsed = new DOMParser().parseFromString(snapshot.xml, "application/xml");
    const ns = "http://openlinksw.com/services/facets/1.0/";
    const toTerm = (value: string, object = false): string => {
      if (/^_:[A-Za-z][\w-]*$/.test(value)) return value;
      if (/^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(value)) return `<${value}>`;
      if (!object) throw new Error(`Invalid RDF subject or predicate: ${value}`);
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
    };
    try {
      const lines: string[] = [];
      for (const row of Array.from(parsed.getElementsByTagNameNS(ns, "row"))) {
        const cells = Array.from(row.getElementsByTagNameNS(ns, "column"));
        if (cells.length < 3) continue;
        const [subject, predicate, object] = cells.slice(0, 3).map((c) => c.textContent?.trim() ?? "");
        if (subject && predicate && object) lines.push(`${toTerm(subject)} ${toTerm(predicate)} ${toTerm(object, true)} .`);
      }
      if (!lines.length) { toast.add({ title: "No DESCRIBE triples are available to download.", type: "error" }); return; }
      // RDF terms from the FCT projection have been normalized for display.
      // URI-looking objects are emitted as IRIs; all others as plain literals.
      const file = new Blob([`# Maestro Record DESCRIBE snapshot\n# Source: ${selectedUri}\n${snapshot.incomplete ? "# WARNING: Virtuoso reported an incomplete DESCRIBE.\n" : ""}${lines.join("\n")}\n`], { type: "application/n-triples;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${encodeURIComponent(selectedUri.split(/[\/#]/).pop() || "record")}-describe.nt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.add({ title: "Could not export the Record DESCRIBE", description: error instanceof Error ? error.message : "Could not export the Record DESCRIBE.", type: "error" });
    }
  }
  const [recordDescriptionPage, setRecordDescriptionPage] = useState(0);
  const [recordDescriptionPageSize, setRecordDescriptionPageSize] = useState<number>(20);
  const [recordDescriptionQueryLimit, setRecordDescriptionQueryLimit] = useState<number>(10000);
  const [pendingRecordDescriptionLimit, setPendingRecordDescriptionLimit] = useState<number | null>(null);
  const [pendingCenterBatchLimit, setPendingCenterBatchLimit] = useState<number | null>(null);
  const [pendingLeftPanelLimit, setPendingLeftPanelLimit] = useState<number | null>(null);
  const [pendingGroupsBatchLimit, setPendingGroupsBatchLimit] = useState<number | null>(null);
  const previousSettingsRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (previousSettingsRevisionRef.current === null) {
      previousSettingsRevisionRef.current = queryRevision;
      return;
    }
    if (previousSettingsRevisionRef.current === queryRevision) return;
    previousSettingsRevisionRef.current = queryRevision;
    if (pendingRecordDescriptionLimit !== null) {
      setRecordDescriptionQueryLimit(pendingRecordDescriptionLimit);
      setPendingRecordDescriptionLimit(null);
    }
    if (pendingCenterBatchLimit !== null) {
      setPendingCenterBatchLimit(null);
      // Apply the preference to the live view when another query change occurs.
      setResultsPage(pendingCenterBatchLimit, 0);
    }
    if (pendingLeftPanelLimit !== null) {
      setLeftPanelLimitState(pendingLeftPanelLimit);
      setGraphsPage(0);
      setPendingLeftPanelLimit(null);
    }
    if (pendingGroupsBatchLimit !== null) {
      setGroupBatchSize(pendingGroupsBatchLimit);
      setGroupBatchOffset(0);
      setGroupUiPage(0);
      setPendingGroupsBatchLimit(null);
    }
  }, [queryRevision, pendingRecordDescriptionLimit, pendingCenterBatchLimit, pendingLeftPanelLimit, pendingGroupsBatchLimit, setResultsPage]);
  const [panelLimitsOpen, setPanelLimitsOpen] = useState(false);
  const RECORD_DESCRIPTION_PAGE_SIZE = recordDescriptionPageSize;
  
  // Group the DESCRIBE triples by predicate and direction: outgoing properties
// and incoming roles (property-of) share the same paging sequence.
const describedProperties = Array.from(
  describedRecord.reduce((grouped, item) => {
    const key = `${item.direction}\u0000${item.property}`;
    const values = grouped.get(key) ?? { property: item.property, direction: item.direction, values: [] as RecordValueTerm[] };
    values.values.push(item);
    grouped.set(key, values);
    return grouped;
  }, new Map<string, { property: string; direction: "property" | "property-of"; values: RecordValueTerm[] }>()),
  ([, item]) => item,
);
const describedPropertyPage = describedProperties.slice(
  recordDescriptionPage * RECORD_DESCRIPTION_PAGE_SIZE,
  (recordDescriptionPage + 1) * RECORD_DESCRIPTION_PAGE_SIZE,
);
const describedPropertyRows = describedPropertyPage.filter((item) => item.direction === "property");
const describedRoleRows = describedPropertyPage.filter((item) => item.direction === "property-of");
const describedPropertyCount = describedProperties.filter((item) => item.direction === "property").length;
const describedRoleCount = describedProperties.filter((item) => item.direction === "property-of").length;
  
  const [isDescribing, setIsDescribing] = useState(false);
  const [recordDescriptionError, setRecordDescriptionError] = useState("");
  const [isCountingResults, setIsCountingResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [resultsRawResponse, setResultsRawResponse] = useState("# No Results FCT response received yet.");
  const [searchError, setSearchError] = useState("");
  const [searchPipelineRun, setSearchPipelineRun] = useState(0);
  const [initialBrowseTriggered, setInitialBrowseTriggered] = useState(false);
  const [widgetTimeouts, setWidgetTimeouts] = useState<Record<MaestroTimeoutCategory, number>>(() => readMaestroWidgetTimeouts());
  const [timeoutEditorOpen, setTimeoutEditorOpen] = useState(false);
  const [recordDescribeIncomplete, setRecordDescribeIncomplete] = useState(false);
  const currentRecordIdentity = results.find((item) => item.uri === selectedUri)
    ?? groupValues.find((item) => item.uri === selectedUri);
  const currentRecordDescriptionKey = [selectedUri, currentRecordIdentity?.termType ?? "uri", currentRecordIdentity?.datatype ?? "", currentRecordIdentity?.lang ?? "", selectedEndpointId, queryTree.attributes.addr ?? "",
    queryTree.attributes.graph ?? "", queryTree.attributes.inference ?? "", queryTree.attributes["same-as"] ?? "",
    selectedRecordGraph, selectedRecordAuthor, recordDescriptionQueryLimit].join("\u0000");


  const resultsCountSparql = buildFctCountSparql(queryTree);
  const rootUriWithoutPath = queryTree.children.some((node) => node.name === "value" && node.attributes.datatype === "uri") &&
    !queryTree.children.some((node) => node.name === "property" || node.name === "property-of");
  const resultsRequestXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
    type: rootUriWithoutPath ? FCT_VIEW_TYPES.LIST : FCT_VIEW_TYPES.TEXT,
    limit: String(resultsBatchSize),
    offset: String(resultsOffset),
    badges: "no", // list-values independently enriches the paginated Results page.
    order: orderResults ? "yes" : "no",
  }));
  const resultsCountRequestIdentity = `${selectedEndpointId}\u0000${resultsCountSparql ?? ""}`;
  const latestResultsCountRequestIdentityRef = useRef(resultsCountRequestIdentity);
  // Update during render, not in an effect, so a response from an older query
  // cannot win the small interval between a new render and effect cleanup.
  latestResultsCountRequestIdentityRef.current = resultsCountRequestIdentity;

  useEffect(() => {
    const endpointReady = endpointReadyForQuery;
    if (!endpointReady) {
      setResultsTotalCount(null);
      setIsCountingResults(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadTotalCount() {
      if (cancelled) return;
      setIsCountingResults(true);
      try {
        if (!resultsCountSparql) {
          throw new Error("The current FCT query tree contains a condition that cannot be compiled safely to SPARQL.");
        }
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("results-total-count", "ResultsTotalCount") },
          body: JSON.stringify({ facetValueCount: { sparql: resultsCountSparql } }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Virtuoso SPARQL count query failed.");
        const total = Number(data.count);
        if (!Number.isSafeInteger(total) || total < 0) {
          throw new Error("Virtuoso returned an invalid scalar count.");
        }
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setResultsTotalCount(total);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        console.warn("SPARQL result count query failed:", error);
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setResultsTotalCount(null);
        }
      } finally {
        if (!cancelled && latestResultsCountRequestIdentityRef.current === resultsCountRequestIdentity) {
          setIsCountingResults(false);
        }
      }
    }

    // Query-tree operations can emit several intermediate revisions during one
    // user action. Debounce the scalar count so Virtuoso only receives the
    // settled query; cleanup also prevents a late response from replacing the
    // count belonging to a newer query.
    const timer = window.setTimeout(() => { void loadTotalCount(); }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [resultsCountSparql, resultsCountRequestIdentity, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Hydrate from the existing Maestro IndexedDB store (not the live query XML).
  useEffect(() => {
    let disposed = false;
    void initializeMaestroStorage().then(() => {
      if (!disposed) setWidgetTimeouts(readMaestroWidgetTimeouts());
    });
    return () => { disposed = true; };
  }, []);

  function changeWidgetTimeout(category: MaestroTimeoutCategory, seconds: number) {
    const next = { ...widgetTimeouts, [category]: seconds };
    setWidgetTimeouts(next);
    writeMaestroWidgetTimeouts(next);
  }

  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);

  // The authoritative <query> revision, not the asynchronous facet effects,
  // starts both Configure spinners. Keep a short visible interval even when
  // cached FCT responses complete before the next browser paint.
  const [configureQueryTransition, setConfigureQueryTransition] = useState(false);
  const previousConfigureQueryRevisionRef = useRef(queryRevision);
  const previouslyVisibleConfigureButtonsRef = useRef({ properties: false, roles: false });
  useLayoutEffect(() => {
    if (previousConfigureQueryRevisionRef.current === queryRevision) return;
    previousConfigureQueryRevisionRef.current = queryRevision;
    setConfigureQueryTransition(true);
    const timer = window.setTimeout(() => setConfigureQueryTransition(false), 450);
    return () => window.clearTimeout(timer);
  }, [queryRevision]);

  // Facet arrays can be cleared synchronously with a query change. Retain only
  // the buttons that were visible before that change until the spinner settles.
  if (propertyFacets.length > 0) previouslyVisibleConfigureButtonsRef.current.properties = true;
  if (roleFacets.length > 0) previouslyVisibleConfigureButtonsRef.current.roles = true;
  useEffect(() => {
    if (!configureQueryTransition && !isLoadingProperties) {
      previouslyVisibleConfigureButtonsRef.current.properties = propertyFacets.length > 0;
    }
    if (!configureQueryTransition && !isLoadingRoles) {
      previouslyVisibleConfigureButtonsRef.current.roles = roleFacets.length > 0;
    }
  }, [configureQueryTransition, isLoadingProperties, isLoadingRoles, propertyFacets.length, roleFacets.length]);
  const showConfigureProperties = propertyFacets.length > 0 ||
    (configureQueryTransition && previouslyVisibleConfigureButtonsRef.current.properties);
  const showConfigureRoles = roleFacets.length > 0 ||
    (configureQueryTransition && previouslyVisibleConfigureButtonsRef.current.roles);
  const showPropertiesSpinner = configureQueryTransition || isLoadingProperties;
  const showRolesSpinner = configureQueryTransition || isLoadingRoles;

  // Start the Configure count spinners as soon as the authoritative facet
  // requests change, before the next paint. Waiting for the asynchronous
  // request effects can briefly show counts from the previous query.
  const pendingConfigureFacetIdentityRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const identity = `${selectedEndpointId}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}\u0000${propertyFacetQueryXml}\u0000${roleFacetQueryXml}`;
    if (pendingConfigureFacetIdentityRef.current === identity) return;
    pendingConfigureFacetIdentityRef.current = identity;
    if (endpointReadyForQuery) {
      setIsLoadingProperties(true);
      setIsLoadingRoles(true);
    }
  }, [selectedEndpointId, endpointReadyForQuery, propertyFacetQueryXml, roleFacetQueryXml]);

  // Scroll to the active Group by facet when that widget's own request settles.
  // Other facet widgets load independently and must not delay this scroll.
  useEffect(() => {
    const facetLoadKey = `${queryXml}\u0000${selectedEndpointId}\u0000${search}`;
    const targetLoading = isGroupByCategory
      ? isLoadingClasses
      : groupedRoleUri
        ? isLoadingRoles
        : isLoadingProperties;

    if (facetListsLoadKeyRef.current !== facetLoadKey) {
      facetListsLoadKeyRef.current = facetLoadKey;
      // A view change may already have set this widget's loading state before
      // this effect sees the new key. Remember that in-flight request so its
      // completion still triggers the scroll.
      facetListsLoadingObservedRef.current = targetLoading;
      return;
    }

    // Scroll as soon as the active Group by widget settles; unrelated facet
    // widgets must not delay it.
    if (targetLoading) {
      facetListsLoadingObservedRef.current = true;
      return;
    }
    if (!facetListsLoadingObservedRef.current || !groupedFacetActive || defaultLeftTab !== "personal") return;

    const target = isGroupByCategory
      ? categoriesWidgetRef.current
      : groupedRoleUri
        ? roleWidgetCardRefs.current.get(groupedRoleUri)
        : personalWidgetCardRefs.current.get(groupedPersonalFacetUri!);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [
    groupedFacetActive,
    isGroupByCategory,
    groupedPersonalFacetUri,
    groupedRoleUri,
    defaultLeftTab,
    queryXml,
    selectedEndpointId,
    search,
    personalWidgets.map((widget) => widget.uri).join("|"),
    roleFacets.map((facet) => facet.uri).join("|"),
    isLoadingClasses,
    isLoadingProperties,
    isLoadingRoles,
    isLoadingGraphs,
  ]);

  const [propertyFacetError, setPropertyFacetError] = useState("");
  const [classFacetError, setClassFacetError] = useState("");

const [propertyFacetWarning, setPropertyFacetWarning] = useState("");
const [classFacetWarning, setClassFacetWarning] = useState("");
const [categoriesIncomplete, setCategoriesIncomplete] = useState(false);
const [roleFacetWarning, setRoleFacetWarning] = useState("");  
  
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());

  useEffect(() => {
    // URL restoration must finish before the initial browse decision is made.
    // In particular, never clear search text here: it may have been restored
    // from the shared URL or typed while the endpoint health check was running.
    if (!urlStateInitialized || !endpointReadyForQuery || initialBrowseTriggered) return;

    setInitialBrowseTriggered(true);

    // An empty initial search needs an explicit run token because its text value
    // has not changed. A restored or user-entered search runs through the normal
    // search dependency instead, without being cleared or needlessly restarted.
    if (!search.trim()) {
      setSearchPipelineRun((current) => current + 1);
    }
  }, [urlStateInitialized, selectedEndpointId, endpointReadyForQuery, initialBrowseTriggered, search]);

  useEffect(() => {
    const query = search.trim();
    let cancelled = false;
    // One controller owns both stages of this Results run. When the query,
    // endpoint, or page changes, cleanup aborts any in-flight client requests.
    const controller = new AbortController();
    const requestQueryIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;

    // Empty text is a valid initial browse query once an endpoint has passed its health check.
    const endpointReady = endpointReadyForQuery;
    if (!query && !endpointReady) return;
    setSearchError("");

    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError("");

      try {
        console.info("Maestro Results FCT request starting", {
          queryFingerprint: proxyDebugFingerprint(resultsRequestXml),
          queryLength: resultsRequestXml.length,
        });
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            ...proxyDebugHeaders("results-search", `ResultsSearch:${proxyDebugFingerprint(resultsRequestXml)}`),
          },
          body: resultsRequestXml,
          signal: controller.signal,
        });
        // Preserve the actual FCT transport response for diagnosing discrepancies
        // between standalone SPARQL execution and Maestro's displayed records.
        const rawResponse = await response.clone().text();
        if (!cancelled) setResultsRawResponse(rawResponse.slice(0, 200_000));
        const data = await readFctResponse(response);
        if (cancelled) return;
        rememberShortforms(data?.shortforms);
        const rawResults: FctResult[] = Array.isArray(data.results) ? data.results : [];
        const uniqueResults = new Map<string, FctResult>();
        for (const item of rawResults) {
          const previous = uniqueResults.get(item.uri);
          uniqueResults.set(item.uri, previous
            ? { ...previous, ...item, matches: [...previous.matches, ...item.matches] }
            : { ...item, matches: [...item.matches] });
        }
        const enrichmentScopeForPage = `list-values-movie-year-v2\u0000${selectedEndpointId}\u0000${resultBadgePropertiesKey}\u0000${resultBadgeRolesKey}\u0000`;
        const nextResults = Array.from(uniqueResults.values()).map((item) => {
          const saved = showResultBadges ? resultsEnrichmentCacheRef.current.get(enrichmentScopeForPage + item.uri) : undefined;
          return saved ? { ...item, scopeValues: saved } : item;
        });

        // Enrichment may take much longer than the FCT response. Never allow
        // a completed request for an older breadcrumb/endpoint to repopulate
        // the widgets after the coordinated transition has cleared them.
        if (cancelled || requestQueryIdentity !== activeQueryIdentityRef.current) return;

        resultsLoadedQueryIdentityRef.current = requestQueryIdentity;
        setSparqlQuery(data.sparql || "");
        setResultsPageMatchCount(nextResults.length);
        setResultsPageComplete(!data.incomplete && rawResults.length < resultsBatchSize);
        setMaestroIncompleteResults("results", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
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
        resultsLoadedQueryIdentityRef.current = "";
        setResultsPageMatchCount(0);
        setSelectedUri("");
        setSearchError(
          presentServerError(error instanceof Error ? error.message : "Search failed."),
        );
      } finally {
        resultsBatchRequestPending.current = false;
        if (!cancelled) setIsSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, resultsRequestXml, resultsBatchSize, queryCountXml, resultsOffset, selectedEndpointId, endpointReadyForQuery, searchPipelineRun]);

  // Result badges are optional SPARQL enrichment. Keep this separate from the
  // FCT search pipeline so toggling badges never reloads/flickers the result set.
  // Enrichment values are server data, not transient loading UI. Retain them when
  // the same records reappear on another page or an unrelated facet rerenders.
  const resultBadgeUrisKey = results.map((item) => item.uri).join("\u0000");
  const resultBadgePropertiesKey = getActiveViewPropertyFilters(queryTree)
    .map((node) => node.attributes.iri)
    .filter((iri): iri is string => typeof iri === "string" && Boolean(iri))
    .filter((iri, index, all) => all.indexOf(iri) === index)
    .join("\u0000");
  const resultBadgeRolesKey = getActiveViewRoleFilters(queryTree)
    .map((node) => node.attributes.iri)
    .filter((iri): iri is string => typeof iri === "string" && Boolean(iri))
    .filter((iri, index, all) => all.indexOf(iri) === index)
    .join("\u0000");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Every Results card needs rdf:type for its Category banner, regardless of
    // which Properties the user has chosen to show as additional badges.
    const selectedForward = [...new Set([
      ...(showResultBadges ? [RDF_TYPE_URI, ...MOVIE_RELEASE_PROPERTIES] : []),
      ...(resultBadgePropertiesKey ? resultBadgePropertiesKey.split("\u0000") : []),
    ])];
    const selectedReverse = resultBadgeRolesKey ? resultBadgeRolesKey.split("\u0000") : [];

    if (!showResultBadges || !endpointReadyForQuery || !results.length ||
        (!selectedForward.length && !selectedReverse.length)) {
      setResults((current) => {
        if (!current.some((item) => (item.scopeValues?.length ?? 0) > 0)) return current;
        return current.map((item) => ({ ...item, scopeValues: [] }));
      });
      return () => controller.abort();
    }

    // Even if the Results SELECT projects an rdf:type column, that projection
    // may carry only one of a resource's classes. Fetch all selected property
    // values so the class banner can display every rdf:type.

    const resourceUris = [...new Set(results.map((item) => item.uri).filter(Boolean))];
    const relationships: ScopeValue[] = [
      ...selectedForward.map((property) => ({
        property,
        label: toLabel(property),
        direction: "forward" as const,
        values: [{ value: "-" }],
      })),
      ...selectedReverse.map((property) => ({
        property,
        label: toLabel(property),
        direction: "reverse" as const,
        values: [{ value: "-" }],
      })),
    ];

    const enrichmentScope = `list-values-movie-year-v2\u0000${selectedEndpointId}\u0000${resultBadgePropertiesKey}\u0000${resultBadgeRolesKey}\u0000`;
    const cache = resultsEnrichmentCacheRef.current;
    setResults((current) => current.map((item) => {
      const saved = cache.get(enrichmentScope + item.uri);
      // Do not replace a successfully enriched card with placeholder values.
      if (saved) return { ...item, scopeValues: saved };
      if ((item.scopeValues ?? []).some((scope) => scope.values.some((v) => v.value !== "-"))) return item;
      return {
        ...item,
        scopeValues: relationships.map((relationship) => ({
          ...relationship, values: relationship.values.map((value) => ({ ...value })),
        })),
      };
    }));

    void (async () => {
      try {
        const queryXml = listValuesQueryClone(serializeFctQuery(queryTree), [
          ...selectedForward.map((property) => ({ property, direction: "forward" as const })),
          ...selectedReverse.map((property) => ({ property, direction: "reverse" as const })),
        ]);
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...proxyDebugHeaders("results-enrichment", `ResultsListValues:${proxyDebugFingerprint(`${resultBadgeUrisKey}:${resultBadgePropertiesKey}:${resultBadgeRolesKey}`)}`),
          },
          body: JSON.stringify({ queryXml, resources: resourceUris }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        const xml = await response.text();
        if (!response.ok) throw new Error(`list-values returned HTTP ${response.status}: ${xml.slice(0, 300)}`);
        const parsed = parseListValuesXml(xml);
        const grouped = new Map<string, Map<string, ScopeValue>>();
        for (const item of results) {
          const resourceGroups = new Map<string, ScopeValue>();
          const projected = parsed.get(item.uri) ?? [];
          for (const relationship of relationships) {
            const key = `${item.uri}\u0000${relationship.direction}\u0000${relationship.property}`;
            resourceGroups.set(key, projected.find((v) => v.direction === relationship.direction && v.property === relationship.property) ?? {
              ...relationship, values: [{ value: "-" }],
            });
          }
          grouped.set(item.uri, resourceGroups);
        }
        if (cancelled) return;
        for (const uri of resourceUris) {
          cache.set(enrichmentScope + uri, [...(grouped.get(uri)?.values() ?? [])]);
        }
        // Keep the cache bounded across long browsing sessions.
        if (cache.size > 2500) {
          for (const key of Array.from(cache.keys()).slice(0, cache.size - 2000)) cache.delete(key);
        }
        setResults((current) => current.map((item) => {
          const saved = cache.get(enrichmentScope + item.uri);
          return saved ? { ...item, scopeValues: saved } : item;
        }));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.warn("Results badge enrichment failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [showResultBadges, resultBadgeUrisKey, resultBadgePropertiesKey, resultBadgeRolesKey, selectedEndpointId, endpointReadyForQuery, propertyFacets, roleFacets]);

  // Some Virtuoso endpoints return a successful grouped A-Z response while
  // omitting an initial visibly represented in the Results list. Verify such
  // missing initials with an independent scalar distinct-record count, rather
  // than guessing the count from page data or advertising an invented total.
  const alphabetProbeAttemptedRef = useRef(new Set<string>());
  const latestAlphabetProbeQueryRef = useRef(alphabetQueryXml);
  latestAlphabetProbeQueryRef.current = alphabetQueryXml;
  useEffect(() => {
    if (!endpointReadyForQuery || isLoadingAlphabet || !results.length || !alphabetError) return;
    const candidateLetters = Array.from(new Set(results.flatMap((item) =>
      [item.title, toLabel(item.uri, "Class")].map((label) => label?.trim().charAt(0).toUpperCase() ?? "")
    ))).filter((letter) => /^[A-Z]$/.test(letter) && !alphabetCounts[letter]).slice(0, 5);
    if (!candidateLetters.length) return;
    const whereIndex = alphabetSparql.indexOf("WHERE {");
    const groupIndex = alphabetSparql.lastIndexOf("\nGROUP BY");
    const targetMatch = alphabetSparql.match(/COUNT\(DISTINCT (\?[a-zA-Z0-9_]+)\)/);
    if (whereIndex < 0 || groupIndex < 0 || !targetMatch) return;
    const whereBlock = alphabetSparql.slice(whereIndex, groupIndex);
    const closingBrace = whereBlock.lastIndexOf("}");
    if (closingBrace < 0) return;
    const controller = new AbortController();
    for (const letter of candidateLetters) {
      const probeKey = `${selectedEndpointId}\u0000${alphabetQueryXml}\u0000${letter}`;
      if (alphabetProbeAttemptedRef.current.has(probeKey)) continue;
      alphabetProbeAttemptedRef.current.add(probeKey);
      const constrainedWhere = `${whereBlock.slice(0, closingBrace)}  FILTER (STRSTARTS(UCASE(STR(?maestroLabel)), "${letter}"))\n${whereBlock.slice(closingBrace)}`;
      const scalarSparql = `SELECT (COUNT(DISTINCT ${targetMatch[1]}) AS ?ct)\n${constrainedWhere}`;
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("alphabet-missing-letter", `AlphabetProbe:${letter}`) },
            body: JSON.stringify({ facetValueCount: { sparql: scalarSparql } }),
          });
          const payload = await response.json();
          const count = Number(payload.count);
          if (response.ok && Number.isSafeInteger(count) && count > 0 && !controller.signal.aborted && latestAlphabetProbeQueryRef.current === alphabetQueryXml) {
            setAlphabetCounts((current) => ({ ...current, [letter]: Math.max(current[letter] ?? 0, count) }));
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn(`Alphabet verification for ${letter} failed`, error);
        }
      })();
    }
    // Let already-issued independent probes complete; their results are only
    // applied when the same alphabet query remains active.
  }, [results, alphabetCounts, alphabetQueryXml, alphabetSparql, alphabetError, isLoadingAlphabet, selectedEndpointId, endpointReadyForQuery]);

  useEffect(() => {
    setGroupUiPage(0);
    setGroupBatchOffset(0);
    setGroupHasMoreBatches(false);
    setGroupValues([]);
    setGroupMembers({});
    groupMemberRequestStates.current.clear();
    setGroupValuesError("");
  }, [queryCountXml, selectedGroupByOption?.key, queryRefreshRevision]);

  // Load group values through FCT itself. This query is a clone of the current
  // tree with the selected relationship used to enumerate its values.
  useEffect(() => {
    let cancelled = false;
    if (centralTab !== "groups" || !selectedGroupByOption) {
      setGroupValuesLoading(false);
      setGroupValuesError("");
      return;
    }
    const controller = new AbortController();
    setGroupValuesLoading(true);
    setGroupValuesError("");
    (async () => {
      try {
        // Same query the Personal facet runs for this property/role/category (count-sorted),
        // so each group heading count equals the count shown in that facet.
        const groupTree = createGroupValuesQuery(queryTree, selectedGroupByOption, {
          limit: groupBatchSize, offset: groupBatchOffset,
        });
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-values-fct", "GroupsValues") },
          body: serializeFctQuery(groupTree),
          signal: controller.signal,
        });
        const data = await readFctResponse(response);
        rememberShortforms(data?.shortforms);
        if (!cancelled) setMaestroIncompleteResults("groups", { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        if (!cancelled) {
          // Column 1 is the value, column 2 the facet's own distinct count (ct / n).
          const nextGroupValues: FctResult[] = (Array.isArray(data.results) ? data.results : []).filter((item) => Boolean(item.uri) && (item.columns?.length ?? 0) >= 2);
          setGroupHasMoreBatches(nextGroupValues.length >= groupBatchSize);
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
        setGroupValuesError(presentServerError(error instanceof Error ? error.message : "Failed to load group values."));
      } finally {
        if (!cancelled) setGroupValuesLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [centralTab, search, queryCountXml, groupByPropertyUri, selectedGroupByOption?.key, groupBatchSize, groupBatchOffset, queryRefreshRevision]);

  // Each group member list is another FCT request: clone the complete source
  // query, bind only this group's value to the selected relationship, and keep
  // the view and all other filters exactly as they are.
  useEffect(() => {
    if (!selectedGroupByOption || groupValues.length === 0) {
      setGroupMembers({});
      return;
    }
    // Do not populate the Groups tab while another tab is active, and do not
    // fetch members for group cards that are not currently visible.
    if (centralTab !== "groups" || visibleGroupValues.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const requestKeys: string[] = [];
    for (const groupValue of pageGroupValues) {
      const key = `${selectedGroupByOption.key}::${groupValueKey(groupValue)}`;
      const requestState = groupMemberRequestStates.current.get(key);
      if (requestState === "loaded" || requestState === "loading") continue;
      requestKeys.push(key);
      groupMemberRequestStates.current.set(key, "loading");
      setGroupMembers((current) => ({ ...current, [key]: { results: current[key]?.results ?? [], loading: true, error: "" } }));
      void (async () => {
        try {
          const memberTree = createGroupMemberQuery(queryTree, selectedGroupByOption, groupValue);
          const memberXml = serializeFctQuery(setQueryViewAttributes(memberTree, {
            type: FCT_VIEW_TYPES.TEXT, limit: String(resultsBatchSize), offset: "0",
          }));
          const request = (body: string, label: string) => cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("group-members-fct", label) },
            body,
            signal: controller.signal,
          }).then(readFctResponse);
          // The SPARQL translator does not implement FCT's `count` view.
          // Use the distinct member rows returned by the supported `text` view
          // for the group count instead of issuing a request that always errors.
          const data = await request(memberXml, "GroupsMembers");
          if (!cancelled) {
            rememberShortforms(data?.shortforms);
            const rawResults: FctResult[] = Array.isArray(data.results) ? data.results : [];
            const uniqueResults = new Map<string, FctResult>();
            for (const item of rawResults) {
              const previous = uniqueResults.get(item.uri);
              uniqueResults.set(item.uri, previous ? { ...previous, ...item, matches: [...previous.matches, ...item.matches] } : { ...item, matches: [...item.matches] });
            }
            groupMemberRequestStates.current.set(key, "loaded");
            setGroupMembers((current) => ({ ...current, [key]: { results: Array.from(uniqueResults.values()), count: uniqueResults.size, loading: false, error: "" } }));
          }
        } catch (error) {
          // Cleanup already releases this request's loading marker. An aborted
          // older request must not delete the marker for a newer request that
          // has since started for the same group key.
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          groupMemberRequestStates.current.delete(key);
          setGroupMembers((current) => ({ ...current, [key]: { results: [], loading: false, error: error instanceof Error ? error.message : "Failed to load group items." } }));
        }
      })();
    }
    return () => {
      cancelled = true;
      for (const key of requestKeys) {
        if (groupMemberRequestStates.current.get(key) === "loading") groupMemberRequestStates.current.delete(key);
      }
      controller.abort();
    };
  }, [centralTab, search, queryXml, selectedGroupByOption?.key, pageGroupValues.map(groupValueKey).join("|"), resultsBatchSize, queryRefreshRevision]);

  // Scope-wide side effects are separate from facet fetching. A facet request
  // must never cancel, wait for, or determine another facet's request lifecycle.
  useEffect(() => {
    const query = search.trim();
    if (!query && !endpointReadyForQuery) {
      // Do not discard previously loaded Configure lists during a transient
      // not-ready state; the next successful facet response replaces them.
      setClassFacets([]); setClassTreeEdges([]);
      setGraphFacets([]);
      setPropertyFacetSparql("");
      setRoleFacetSparql("");
      replaceFacetAutofillCandidates("property", []);
      replaceFacetAutofillCandidates("property-in", []);
      setFacetAutofillCandidates({ property: [], "property-in": [] });
      setFocusWidgetsSuppressed(false);
      return;
    }

    setFocusWidgetsSuppressed(false);
    // Graph pagination and Autofill are query-scope state, not facet request state.
    setGraphsPage(0);
    setGraphFacets([]);
    replaceFacetAutofillCandidates("property", []);
    replaceFacetAutofillCandidates("property-in", []);
    setFacetAutofillCandidates({ property: [], "property-in": [] });
  }, [search, queryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Categories owns its own request, debounce, cancellation, data, error and
  // loading state. It does not wait for Properties or Roles.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      setClassFacets([]); setClassTreeEdges([]);
      setClassFacetError("");
      setCategoriesIncomplete(false);
      setIsLoadingClasses(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingClasses(true);
    setClassFacetError("");
    setCategoriesIncomplete(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const loadCategories = async (xml: string, source: string) => {
            const response = await cachedFetchFct("/proxy/api/fct", {
              method: "POST",
              headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", source) },
              body: xml,
              signal: controller.signal,
            });
            const data = await readFctResponse(response);
            if (!response.ok || data.error) throw new Error(data.error ?? `Categories query failed with HTTP ${response.status}.`);
            return data;
          };
          let data: ParsedFctResponse | undefined;
          let usedSampleFallback = false;
          let originalIncomplete = false;
          let originalWarning = "";
          const isAnytimeError = (error: unknown) => /ANYTIME|S1TAT|time.?limit|incomplete results/i.test(error instanceof Error ? error.message : String(error));
          try {
            data = await loadCategories(classFacetQueryXml, "FacetLoader:classes");
            originalIncomplete = data.incomplete;
            originalWarning = data.warning || data.sqlMessage || "";
            // Preserve partial class rows. Only retry when none were returned.
          } catch (firstError) {
            if (!isAnytimeError(firstError)) throw firstError;
            originalIncomplete = true;
            originalWarning = firstError instanceof Error ? firstError.message : String(firstError);
            // Tree and flat aggregation can both be interrupted before producing
            // the first grouped result. Fall through to the bounded sample below.
          }
          if (!data || (data.classes.length === 0 && (data.incomplete || originalIncomplete))) {
            // A limited unaggregated scan can return class/resource pairs before
            // Virtuoso manages to complete a global GROUP BY. Counts are
            // sample frequencies, never represented as exact totals.
            const sampleXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
              type: FCT_VIEW_TYPES.CLASSES, sample: "yes", tree: "", sort: "", offset: "0", limit: "500",
            }));
            const sampled = await loadCategories(sampleXml, "FacetLoader:classes-sample-fallback");
            const classSamples = new Map<string, { label: string; members: Set<string> }>();
            for (const columns of sampled.rows) {
              const iri = columns[0]?.value;
              const resource = columns[1]?.value;
              if (!iri || !resource) continue;
              const entry = classSamples.get(iri) ?? { label: columns[0]?.label || columns[0]?.shortform || toLabel(iri, "Class"), members: new Set<string>() };
              entry.members.add(resource);
              classSamples.set(iri, entry);
            }
            data = { ...sampled, classes: Array.from(classSamples, ([uri, item]) => ({ uri, label: item.label, count: item.members.size })) };
            usedSampleFallback = true;
          }
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          const classRows: FacetItem[] = Array.isArray(data.classes) ? data.classes : [];
          // Facet items and counts come exclusively from the flat Categories query.
          const uniqueClasses = new Map<string, FacetItem>();
          for (const row of classRows) if (!uniqueClasses.has(row.uri)) uniqueClasses.set(row.uri, row);
          setClassFacets(Array.from(uniqueClasses.values()));

		  setClassFacetWarning("");
          const incomplete = originalIncomplete || data.incomplete || usedSampleFallback;
          setCategoriesIncomplete(incomplete);
          const sampleNote = usedSampleFallback ? "Categories were recovered by a bounded non-aggregating scan. Counts reflect distinct resources in the returned sample, not complete class totals." : "";
          setMaestroIncompleteResults("categories", { incomplete, requestId: "", message: [originalWarning, data.warning || data.sqlMessage || "", sampleNote].filter(Boolean).join("; ") || "" });
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setCategoriesIncomplete(true);
          setMaestroIncompleteResults("categories", { incomplete: true, requestId: "", message: error instanceof Error ? error.message : String(error) });
          setClassFacetError(facetLoadErrorMessage(error, "Failed to load classes facets."));
        } finally {
          if (!cancelled) setIsLoadingClasses(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // A cancelled request skips its finally block; release this widget's
      // loading indicator during cleanup. A replacement effect sets it true.
      setIsLoadingClasses(false);
    };
  }, [search, classFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // The tree request supplies relationships only, never additional category items or counts.
  // Its output is intersected with the authoritative flat class list at render time.
  useEffect(() => {
    if (!categoriesTreeMode || (!search.trim() && !endpointReadyForQuery)) {
      setClassTreeEdges([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:classes-hierarchy") },
            body: queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, false, true),
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok || data.error) throw new Error(data.error ?? `Category hierarchy query failed with HTTP ${response.status}.`);
          if (cancelled) return;
          setClassTreeEdges((data.classes ?? []).flatMap((row) => "parent" in row && typeof row.parent === "string" && row.parent ? [{ uri: row.uri, parent: row.parent }] : []));
          if (data.incomplete) {
            const previous = getMaestroIncompleteResults("categories");
            setCategoriesIncomplete(true);
            setMaestroIncompleteResults("categories", {
              incomplete: true,
              requestId: "",
              message: [previous?.message, "Category hierarchy was incomplete; only relationships between classes in the flat Categories list are shown.", data.warning || data.sqlMessage || ""].filter(Boolean).join("; "),
            });
          }
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          // An unavailable hierarchy must never remove an item from the flat list.
          setClassTreeEdges([]);
          const previous = getMaestroIncompleteResults("categories");
          setCategoriesIncomplete(true);
          setMaestroIncompleteResults("categories", {
            incomplete: true,
            requestId: "",
            message: [previous?.message, "Superclass hierarchy unavailable; displaying only classes from the flat list.", error instanceof Error ? error.message : String(error)].filter(Boolean).join("; "),
          });
        }
      })();
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [categoriesTreeMode, classFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Properties has a completely separate request lifecycle from Categories and Roles.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      setIsLoadingProperties(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingProperties(true);
    setPropertyFacetError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:properties") },
            body: propertyFacetQueryXml,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok) throw new Error(data.error ?? "Failed to load properties facets.");
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          setPropertyFacets(Array.isArray(data.properties) ? data.properties.filter((item) => item.uri !== RDF_TYPE_URI) : []);
		  setPropertyFacetWarning("");
          setMaestroIncompleteResults("properties", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
          setPropertyFacetSparql(typeof data.sparql === "string" ? data.sparql : "");
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setPropertyFacetError(facetLoadErrorMessage(error, "Failed to load properties facets."));
        } finally {
          if (!cancelled) setIsLoadingProperties(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // The replacement request owns the loading flag; do not clear it on cancellation.
    };
  }, [search, propertyFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Roles has a completely separate request lifecycle from Categories and Properties.
  useEffect(() => {
    if (!search.trim() && !endpointReadyForQuery) {
      // Preserve the last successful Role facets until a new response arrives.
      setIsLoadingRoles(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingRoles(true);
    setRoleFacetError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST",
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("facet-load", "FacetLoader:roles") },
            body: roleFacetQueryXml,
            signal: controller.signal,
          });
          const data = await readFctResponse(response);
          if (!response.ok) throw new Error(data.error ?? "Failed to load roles facets.");
          if (cancelled) return;
          rememberShortforms(data?.shortforms);
          setRoleFacets(Array.isArray(data.roles) ? data.roles : []);
		  setRoleFacetWarning("");
          setMaestroIncompleteResults("roles", { incomplete: data.incomplete, requestId: "", message: data.warning || "" });
          setRoleFacetSparql(typeof data.sparql === "string" ? data.sparql : "");
        } catch (error) {
          if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
          setRoleFacetError(facetLoadErrorMessage(error, "Failed to load roles facets."));
        } finally {
          if (!cancelled) setIsLoadingRoles(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      // The replacement request owns the loading flag; do not clear it on cancellation.
    };
  }, [search, roleFacetQueryXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);

  // Fetch only the graph page the user requested; never scan the entire result set.
  useEffect(() => {
    if (!endpointReadyForQuery || !selectedEndpointId) {
      setGraphFacets([]);
      setGraphListSparql("");
      setGraphHasMore(false);
      setIsLoadingGraphs(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setIsLoadingGraphs(true);
    setGraphListSparql("");
    async function loadGraphPage() {
      try {
        const limit = FACET_PAGE_SIZE; //leftPanelLimit;
        const offset = graphsPage * limit;
        const graphQueryXml = serializeFctQuery(setQueryViewAttributes(queryTree, {
          type: FCT_VIEW_TYPES.GRAPHS, sort: graphSort, limit: String(limit), offset: String(offset),
        }));
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("graph-list", "GraphList") },
          body: graphQueryXml,
          signal: controller.signal,
        });
        const responseText = await response.text();
        const data = parseFctResponse(responseText);
        if (!cancelled) rememberShortforms(data?.shortforms);
        if (!cancelled) setGraphListSparql(data.sparql ?? "");
        if (!cancelled) setMaestroIncompleteResults("graphs", { incomplete: data.incomplete, requestId: "", message: data.warning || data.sqlMessage || "" });
        if (!response.ok && !data.incomplete) throw new Error(data.error ?? "Failed to load graphs for the current query.");
        if (data.error && !data.incomplete) throw new Error(data.error);
        if (cancelled) return;
        //const graphs = Array.isArray(data.graphs) ? [...new Set(data.graphs.filter((value: unknown): value is string => typeof value === "string"))] : [];
       // setGraphFacets(graphs.map((uri: string) => ({ uri, label: uri, count: 0 })));

const graphs: FacetItem[] = Array.isArray(data.graphs)
  ? Array.from(
      new Map<string, FacetItem>(
        (data.graphs as FacetItem[])
          .filter((item) => item && typeof item.uri === "string")
          .map((item) => [
            item.uri,
            createFacetItem(
              item.uri,
              item.label || toLabel(item.uri, "Class"),
              item.count,
            ),
          ]),
      ).values(),
    )
  : [];
setGraphFacets(graphs);

        setGraphHasMore(typeof data.rowCount === "number" ? data.rowCount >= limit : graphs.length >= limit);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Graph page load failed:", error);
          setGraphFacets([]);
          setGraphHasMore(false);
        }
      } finally {
        if (!cancelled) setIsLoadingGraphs(false);
      }
    }
    void loadGraphPage();
    return () => { cancelled = true; controller.abort(); };
  }, [graphsPage, graphSort, leftPanelLimit, queryWithoutPagingXml, selectedEndpointId, endpointReadyForQuery, queryRefreshRevision]);


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
  // Match excerpts/counts are meaningful only for the root-level live <view>.
  // A nested view represents a focused path, not a root text-search result set.
  const isRootView = queryTree.children.some((node) => node.id === "query-view");
  // The live query is the source of truth: without a <text> node there is no
  // text match to explain, whatever the search field happens to contain.
  const liveQueryHasText = queryTree.children.some((node) => node.name === "text");
  const visibleResultsPage = allLoadedResults.slice(resultsUiPage * resultsPageSize, (resultsUiPage + 1) * resultsPageSize);
  useEffect(() => {
    // Group members can be selected even when they are not on the ordinary
    // Results page. Do not let Results-page auto-selection override that pick
    // while the Groups tab is active; restore page-local selection on return.
    if (centralTab !== "groups" && visibleResultsPage.length > 0 && !visibleResultsPage.some((item) => item.uri === selectedUri)) {
      setSelectedUri(visibleResultsPage[0].uri);
    }
  }, [centralTab, resultsOffset, resultsPageSize, resultsUiPage, visibleResultsPage, selectedUri]);

  const selectedResult = visibleResultsPage.find((item) => item.uri === selectedUri);
  const selectedGroupRecord = groupValues.find((item) => item.uri === selectedUri);
  // Preserve RDF identity when Record is focused on a literal FCT result.
  const selectedRecordTerm = currentRecordIdentity ?? selectedResult ?? selectedGroupRecord;
  const selectedRecordTermType = selectedRecordTerm?.termType ?? "uri";
  const selectedRecordDatatype = selectedRecordTerm?.datatype;
  const selectedRecordLanguage = selectedRecordTerm?.lang;
  // A literal reached through a focused forward property is known to have
  // at least that incoming Role in the current query context. Retain this
  // predicate for a bounded fallback when a global Roles scan times out.
  const recordFocusNode = getPropertyPath().at(-1);
  const recordFocusPredicate = selectedRecordTermType === "literal" && recordFocusNode?.name === "property"
    ? recordFocusNode.uri : undefined;
  const recordFocusValueDatatype = selectedRecordDatatype && selectedRecordDatatype !== "string" ? selectedRecordDatatype : undefined;
  const recordRootDebugValue = `<value datatype="${escapeXmlText(selectedRecordTermType === "uri" ? "uri" : selectedRecordLanguage ? "string" : recordFocusValueDatatype ?? "string")}"${selectedRecordLanguage ? ` xml:lang="${escapeXmlText(selectedRecordLanguage)}"` : ""}>${escapeXmlText(selectedUri)}</value>`;
  const recordRootDebugQuery = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" addr="${escapeXmlText(queryTree.attributes.addr ?? "")}">${recordRootDebugValue}<view type="${FCT_VIEW_TYPES.DESCRIBE}" limit="${recordDescriptionQueryLimit}" offset="0"/></query>`;

  // The graph membership request is independent of optional author metadata.
  // Always send the authoritative query address; endpoint selection must not
  // race the fct_endpoint cookie when a share URL restores a different server.
  useEffect(() => {
    setRecordGraphs([]);
    setRecordGraphAuthors([]);
    setSelectedRecordGraph("");
    setSelectedRecordAuthor("");
    setRecordGraphError("");
    setRecordAuthorError("");
    if (!selectedUri || !selectedEndpointId || selectedRecordTermType !== "uri") { setLoadingRecordGraphs(false); return; }
    const controller = new AbortController();
    setLoadingRecordGraphs(true);
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/record-graphs", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-graph-discovery", "RecordGraphs") },
          body: JSON.stringify({ iri: selectedUri, addr: queryTree.attributes.addr, operation: "graphs" }),
        });
        const data = await response.json() as { graphs?: string[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not discover record graphs.");
        if (!controller.signal.aborted) setRecordGraphs(data.graphs ?? []);
      } catch (error) {
        if (!controller.signal.aborted) setRecordGraphError(error instanceof Error ? error.message : "Could not discover record graphs.");
      } finally {
        if (!controller.signal.aborted) setLoadingRecordGraphs(false);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, selectedRecordTermType, selectedEndpointId, queryTree.attributes.addr, queryRefreshRevision]);

  // Load author provenance only after the user selects a graph family.
  // Slow metadata queries must never delay the Graph dropdown.
  useEffect(() => {
    setRecordGraphAuthors([]);
    setRecordAuthorError("");
    setSelectedRecordAuthor("");
    if (!selectedRecordGraph || !graphsInSelectedFamily.length || !selectedUri) {
      setLoadingRecordAuthors(false);
      return;
    }
    const controller = new AbortController();
    setLoadingRecordAuthors(true);
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/record-graphs", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-author-discovery", "RecordAuthors") },
          body: JSON.stringify({ iri: selectedUri, addr: queryTree.attributes.addr, operation: "authors", graphs: graphsInSelectedFamily }),
        });
        const data = await response.json() as { authors?: RecordGraphAuthor[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not discover graph authors.");
        if (!controller.signal.aborted) setRecordGraphAuthors(data.authors ?? []);
      } catch (error) {
        if (!controller.signal.aborted) setRecordAuthorError(error instanceof Error ? error.message : "Could not discover graph authors.");
      } finally {
        if (!controller.signal.aborted) setLoadingRecordAuthors(false);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, selectedRecordGraph, recordGraphs, queryTree.attributes.addr, queryRefreshRevision]);

  // Membership discovery does not change an unfiltered DESCRIBE. Only selected
  // graph/author filters need the discovered list, avoiding a second record load.
  const filteredDescriptionGraphs = selectedRecordGraph || selectedRecordAuthor ? recordGraphs : null;

  // Load the selected resource once through Record SELECT; pagination is local to
  // the returned property/value pairs and does not trigger another server query.
  useEffect(() => {
    if (!selectedUri || !selectedEndpointId) {
      setDescribedRecord([]);
      setRecordDescriptionSnapshot(null);
      setRecordDescriptionPage(0);
      setIsDescribing(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDescribedRecord([]);
    setRecordDescriptionSnapshot(null);
    setRecordDescribeIncomplete(false);
    setRecordDescriptionError("");
    setDescribedRecordUri("");
    setRecordDescriptionPage(0);
    setFormattedRecordHtml("");
    setFormattedRecordButtonsHtml({});
    setRecordFormatError("");
    setRecordPolicyCheckedUri("");
    setIsDescribing(true);
    setRecordDebug({ xml: "", sparql: "", formatterXml: "", formatterSparql: "", policyDiscovery: "", templateLookup: "" });
    async function loadDescription() {
      try {
        let snapshotXml = "";
        let snapshotIncomplete = false;
        let rows: RecordValueTerm[] = [];
        let snapshotTerms: { subject: string; predicate: string; object: string; objectType: string; datatype?: string; lang?: string }[] = [];
        // The authoritative Record snapshot comes from one SPARQL SELECT.
        // A bounded inner SELECT fetches triples; the outer query adds URI labels
        // without changing the limit or duplicating Record triples.
        const selectedGraphs = selectedRecordAuthor
          ? [selectedRecordAuthor]
          : selectedRecordGraph
            ? (filteredDescriptionGraphs ?? []).filter((graph) => graph.split("#", 1)[0] === selectedRecordGraph)
            : [];
        if ((selectedRecordGraph || selectedRecordAuthor) && !selectedGraphs.length) {
          throw new Error("No named graphs are available for the selected Record graph or author.");
        }
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-select-labels", "RecordDescription") },
          body: JSON.stringify({ recordSelect: {
            iri: selectedUri, termType: selectedRecordTermType,
            ...(recordFocusPredicate ? { focusPredicate: recordFocusPredicate } : {}),
            ...(selectedRecordDatatype && selectedRecordDatatype !== "string" && selectedRecordTermType === "literal" ? { datatype: selectedRecordDatatype } : {}),
            ...(selectedRecordLanguage ? { lang: selectedRecordLanguage } : {}),
            limit: recordDescriptionQueryLimit, labelLookupVersion: 3,
            ...(selectedRecordGraph || selectedRecordAuthor ? { graphs: selectedGraphs } : {}),
          } }),
        });
        const data = await response.json() as {
          error?: string; incomplete?: boolean; query?: string;
          results?: { bindings?: Array<Record<string, {
            type: string; value: string; datatype?: string; "xml:lang"?: string;
          }>> };
        };
        if (!response.ok) throw new Error(data.error || "Record SELECT failed.");
        const fetchedBindings = data.results?.bindings ?? [];
        snapshotIncomplete = Boolean(data.incomplete);
        if (!cancelled) {
          setRecordDescribeIncomplete(snapshotIncomplete);
          setRecordDebug((current) => ({ ...current,
            xml: `POST /proxy/api/sparql\n${JSON.stringify({ recordSelect: { iri: selectedUri, termType: selectedRecordTermType, datatype: selectedRecordDatatype, lang: selectedRecordLanguage, limit: recordDescriptionQueryLimit, labelLookupVersion: 3, graphs: selectedGraphs } }, null, 2)}`,
            sparql: data.query ?? "Record SELECT query unavailable.",
          }));
        }
        const queryAddrForLabels = queryTree.attributes.addr || (selectedEndpointId ? `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}` : "");
        const cachedLabels = recordUriLabelCacheRef.current;
        // The previous SELECT version could have assigned a subject's label
        // to unrelated wikiPageWikiLink objects. Replace those stale entries
        // for the resources in this fresh SELECT response.
        const refreshedLabelUris = new Set<string>();
        for (const binding of fetchedBindings) {
          if (binding.labelResource?.type === "uri") refreshedLabelUris.add(binding.labelResource.value);
        }
        for (const uri of refreshedLabelUris) cachedLabels.delete(`${queryAddrForLabels}\u0000${uri}`);
        // Resolve each URI to one preferred label from the same SELECT rows.
        // Ranking is independent of Virtuoso's row order: vocabulary first,
        // then English ahead of untagged, then a deterministic text tie-break.
        const labelPredicates = [
          "http://www.w3.org/2000/01/rdf-schema#label",
          "http://www.w3.org/2004/02/skos/core#prefLabel",
          "http://schema.org/name", "https://schema.org/name",
          "http://xmlns.com/foaf/0.1/name",
          "http://purl.org/dc/terms/title",
        ];
        const preferredLabels = new Map<string, { rank: number; text: string }>();
        for (const binding of fetchedBindings) {
          const labelUri = binding.labelResource?.type === "uri" ? binding.labelResource.value : "";
          const label = binding.label;
          if (!labelUri || !label?.value || label.type !== "literal") continue;
          const predicateRank = labelPredicates.indexOf(binding.labelPredicate?.value ?? "");
          if (predicateRank < 0) continue;
          const lang = (label["xml:lang"] ?? "").toLowerCase();
          // Use any language when no English/untagged label exists rather than
          // silently falling back to the URI's local name (common for schema:author).
          const languageRank = lang === "en" || lang.startsWith("en-") ? 0 : lang === "" ? 1 : 2;
          const rank = predicateRank * 3 + languageRank;
          const current = preferredLabels.get(labelUri);
          if (!current || rank < current.rank ||
              (rank === current.rank && label.value.localeCompare(current.text) < 0)) {
            preferredLabels.set(labelUri, { rank, text: label.value });
          }
        }
        for (const binding of fetchedBindings) {
          const subject = binding.subject, predicate = binding.predicate, object = binding.object;
          if (!subject?.value || !predicate?.value || !object?.value) continue;
          const objectType = object.type === "uri" ? "uri" : object.type === "bnode" ? "bnode" : "literal";
          const objectValue = objectType === "bnode" ? `_:${object.value}` : object.value;
          snapshotTerms.push({ subject: subject.value, predicate: predicate.value,
            object: objectValue, objectType, ...(object.datatype ? { datatype: object.datatype } : {}),
            ...(object["xml:lang"] ? { lang: object["xml:lang"] } : {}) });
          const matchesRecordObject = object.value === selectedUri &&
            (selectedRecordTermType === "uri" ? object.type === "uri" :
             selectedRecordTermType === "literal" ? object.type === "literal" &&
               (object["xml:lang"] ?? "").toLowerCase() === (selectedRecordLanguage ?? "").toLowerCase() &&
               (!selectedRecordDatatype || !object.datatype || object.datatype === selectedRecordDatatype) :
             object.type === "bnode");
          const direction: "property" | "property-of" | null = selectedRecordTermType === "uri" && subject.value === selectedUri
            ? "property" : matchesRecordObject ? "property-of" : null;
          if (direction) rows.push({ property: predicate.value,
            value: direction === "property" ? objectValue : subject.value, direction,
            termType: direction === "property" ? objectType : "uri",
            ...(direction === "property" && object.datatype ? { datatype: object.datatype } : {}),
            ...(direction === "property" && object["xml:lang"] ? { lang: object["xml:lang"] } : {}),
          });
          if (binding.labelResource?.type === "uri") {
            // Use only the explicit join target, never the Record's own label.
            const labelUri = binding.labelResource.value;
            const expectedUri = subject.value === selectedUri && objectType === "uri"
              ? object.value : matchesRecordObject ? subject.value : "";
            const preferred = preferredLabels.get(labelUri);
            if (labelUri === expectedUri && preferred && /^https?:\/\//i.test(labelUri)) {
              cachedLabels.set(`${queryAddrForLabels}\u0000${labelUri}`, preferred.text);
            }
          }
        }
        // Multiple labels can correspond to one URI. Keep one authoritative
        // Record triple per term, independent of auxiliary label bindings.
        snapshotTerms = [...new Map(snapshotTerms.map((term) => [
          [term.subject, term.predicate, term.object, term.objectType, term.datatype ?? "", term.lang ?? ""].join("\u0000"), term,
        ])).values()];
        rows = [...new Map(rows.map((row) => [
          [row.direction, row.property, row.value, row.termType, row.datatype ?? "", row.lang ?? ""].join("\u0000"), row,
        ])).values()];
        // The inner SELECT limit counts triples; outer label joins may add
        // multiple rows. Judge completeness using distinct Record triples.
        snapshotIncomplete = snapshotIncomplete || snapshotTerms.length >= recordDescriptionQueryLimit;
        if (!cancelled) setRecordDescribeIncomplete(snapshotIncomplete);
        // Normalize the actual Default-viewer rows for both filtered and unfiltered
        // requests. Never feed a different/raw server representation to XSLT.
        {
          const fctNs = "http://openlinksw.com/services/facets/1.0/";
          const triplesXml = snapshotTerms
            .filter((triple) => selectedRecordTermType === "uri" ? triple.subject === selectedUri || triple.object === selectedUri : triple.object === selectedUri)
            .map((triple) => {
              const attrs = ` termType="${escapeXmlText(triple.objectType)}"${triple.datatype ? ` datatype="${escapeXmlText(triple.datatype)}"` : ""}${triple.lang ? ` xml:lang="${escapeXmlText(triple.lang)}"` : ""}`;
              return `<fct:row><fct:column termType="uri">${escapeXmlText(triple.subject)}</fct:column><fct:column termType="uri">${escapeXmlText(triple.predicate)}</fct:column><fct:column${attrs}>${escapeXmlText(triple.object)}</fct:column></fct:row>`;
            }).join("");
          snapshotXml = `<fct:facets xmlns:fct="${fctNs}"><fct:complete>${snapshotIncomplete ? "no" : "yes"}</fct:complete><fct:result type="describe">${triplesXml}</fct:result></fct:facets>`;
        }
        if (!cancelled) {
          setRecordDescriptionSnapshot({ key: currentRecordDescriptionKey, uri: selectedUri, xml: snapshotXml, incomplete: snapshotIncomplete });
          setDescribedRecord(rows);
          setDescribedRecordUri(selectedUri);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Record SELECT failed:", error);
          const message = error instanceof Error ? error.message : String(error);
          setRecordDescriptionError(`Record SELECT failed: ${message}`);
          setRecordFormatError(`Record SELECT failed: ${message}`);
          setDescribedRecord([]);
          setRecordDescriptionSnapshot(null);
          setRecordDescribeIncomplete(false);
        }
      } finally {
        if (!cancelled) setIsDescribing(false);
      }
    }
    void loadDescription();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedUri, selectedRecordTermType, selectedRecordDatatype, selectedRecordLanguage, recordFocusPredicate, selectedEndpointId, selectedRecordGraph, selectedRecordAuthor, filteredDescriptionGraphs, queryTree.attributes.addr, queryTree.attributes.graph, queryTree.attributes.inference, queryTree.attributes["same-as"], currentRecordDescriptionKey, recordDescriptionQueryLimit, queryRefreshRevision]);

  // The separate Record graph dropdown loader already knows which named graphs
  // contain this resource. Reuse that list for a single background label query;
  // never enumerate named graphs inside the initial Record SELECT or delay it.
  useEffect(() => {
    if (!selectedUri || describedRecordUri !== selectedUri || isDescribing ||
        !recordGraphs.length || !describedRecord.length || !selectedEndpointId) return;
    const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
    const labelCache = recordUriLabelCacheRef.current;
    const valueUris = [...new Set(describedRecord
      .filter((row) => /^https?:\/\//i.test(row.value))
      .map((row) => row.value))];
    const missing = valueUris.filter((uri) => !labelCache.has(`${addr}\u0000${uri}`)).slice(0, 128);
    if (!missing.length) return;
    const graphIris = selectedRecordAuthor
      ? [selectedRecordAuthor]
      : selectedRecordGraph
        ? recordGraphs.filter((graph) => graph.split("#", 1)[0] === selectedRecordGraph)
        : recordGraphs;
    if (!graphIris.length) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-value-labels", "RecordValueLabels") },
          body: JSON.stringify({ recordValueLabels: { uris: missing, graphs: graphIris, version: 1 } }),
        });
        const data = await response.json() as {
          error?: string;
          results?: { bindings?: Array<Record<string, { type: string; value: string; "xml:lang"?: string }>> };
        };
        if (!response.ok) throw new Error(data.error || "Record URI label lookup failed.");
        if (controller.signal.aborted) return;
        const predicates = [
          "http://www.w3.org/2000/01/rdf-schema#label",
          "http://www.w3.org/2004/02/skos/core#prefLabel",
          "http://schema.org/name", "https://schema.org/name",
          "http://xmlns.com/foaf/0.1/name", "http://purl.org/dc/terms/title",
        ];
        const requested = new Set(missing);
        const best = new Map<string, { rank: number; text: string }>();
        for (const binding of data.results?.bindings ?? []) {
          const uri = binding.labelResource?.value ?? "";
          const label = binding.label;
          if (!requested.has(uri) || binding.labelResource?.type !== "uri" ||
              label?.type !== "literal" || !label.value.trim()) continue;
          const predicate = predicates.indexOf(binding.labelPredicate?.value ?? "");
          if (predicate < 0) continue;
          const lang = (label["xml:lang"] ?? "").toLowerCase();
          const rank = predicate * 3 + (lang === "en" || lang.startsWith("en-") ? 0 : !lang ? 1 : 2);
          const current = best.get(uri);
          if (!current || rank < current.rank ||
              (rank === current.rank && label.value.localeCompare(current.text) < 0)) {
            best.set(uri, { rank, text: label.value });
          }
        }
        if (controller.signal.aborted) return;
        let updated = false;
        for (const [uri, label] of best) {
          const key = `${addr}\u0000${uri}`;
          if (labelCache.get(key) !== label.text) {
            labelCache.set(key, label.text);
            updated = true;
          }
        }
        if (updated) setRecordLabelRevision((value) => value + 1);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Record named-graph label enrichment failed:", error);
      }
    })();
    return () => controller.abort();
  }, [selectedUri, describedRecordUri, describedRecord, isDescribing, recordGraphs,
      selectedRecordGraph, selectedRecordAuthor, selectedEndpointId,
      queryTree.attributes.addr, queryTree.attributes.graph]);

  // The formatted card may already be on screen when named-graph labels arrive.
  // Update only its URI link text; do not rerun SHACL, XSLT, or the Record SELECT.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    if (!root || !formattedRecordHtml) return;
    const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-maestro-record-uri]"))) {
      const uri = element.getAttribute("data-maestro-record-uri") ?? "";
      const label = recordUriLabelCacheRef.current.get(`${addr}\u0000${uri}`);
      if (label) element.textContent = label;
    }
  }, [recordLabelRevision, formattedRecordHtml, selectedUri, selectedEndpointId,
      queryTree.attributes.addr, queryTree.attributes.graph]);

  // Discover a record's class policy from the personal SPARQL server after its DESCRIBE data identifies rdf:type values.
  useEffect(() => {
    if (!authSession) { setRecordPolicy(null); setRecordPolicies([]); setSelectedRecordTemplateUri(""); setRecordPolicyError(""); setIsLoadingRecordPolicy(false); setRecordPolicyCheckedUri(selectedUri); return; }
    if (!selectedUri || !personalSparqlEndpoint) {
      setRecordPolicy(null);
      setRecordPolicies([]);
      setSelectedRecordTemplateUri("");
      setRecordPolicyError("");
      setRecordValidation(null);
      setFormattedRecordHtml("");
      setRecordFormatError("");
      setIsLoadingRecordPolicy(false);
      setRecordPolicyCheckedUri("");
      return;
    }
    // Wait for this record's DESCRIBE before deciding its formatter. Do not
    // clear the prior policy during a temporary empty/loading transition.
    if (isDescribing || describedRecordUri !== selectedUri || !describedRecord.length) return;
    const rdfTypeUri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const knownResultClassIris = (selectedResult?.uri === selectedUri || selectedGroupRecord?.uri === selectedUri)
      ? getClassesAtNode(getPropertyPath().at(-1)?.id ?? null)
      : [];
    // A Work with an ISBN is an identifiable book even if the source omits
    // dbo:Book from rdf:type. This is policy-discovery evidence only: never
    // modify the authoritative live query or assert a new RDF triple.
    const bookPredicates = new Set([
      "http://dbpedia.org/ontology/isbn",
      "http://dbpedia.org/property/isbn",
      "http://schema.org/isbn",
      "https://schema.org/isbn",
      "http://purl.org/ontology/bibo/isbn",
      "http://purl.org/ontology/bibo/isbn10",
      "http://purl.org/ontology/bibo/isbn13",
    ]);
    const hasBookIdentifier = describedRecord.some((item) =>
      item.direction === "property" && bookPredicates.has(item.property) &&
      /[0-9Xx]{9,13}/.test(item.value.replace(/[\s-]/g, "")),
    );
    const actualRecordTypes = Array.from(new Set(describedRecord
      .filter((item) => item.direction === "property" && item.property === rdfTypeUri && /^[a-z][a-z0-9+.-]*:/i.test(item.value))
      .map((item) => item.value)));
    const recordTypes = Array.from(new Set([
      ...actualRecordTypes,
      // When the partial DESCRIBE does not include rdf:type, the current
      // Results query's class constraint still identifies this matched record.
      ...knownResultClassIris,
      ...(hasBookIdentifier ? ["http://dbpedia.org/ontology/Book"] : []),
    ]));
    if (!recordTypes.length) {
      setRecordPolicy(null);
      setRecordPolicies([]);
      setSelectedRecordTemplateUri("");
      setRecordPolicyError("");
      setIsLoadingRecordPolicy(false);
      setRecordPolicyCheckedUri(selectedUri);
      return;
    }
    const controller = new AbortController();
    setIsLoadingRecordPolicy(true);
    // Retain the current selection while the next record's policy is resolved;
    // the record-keyed render guard prevents showing stale formatted HTML.
    setRecordPolicyError("");
    maestroQueryFetch("/proxy/api/policies", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-discover", "RecordPolicyDiscovery") },
      body: JSON.stringify({ action: "discover", recordTypes }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { policies?: { uri: string; label: string; recordShape: string; matchedClasses?: string[]; templates: { uri: string; label: string }[] }[]; error?: string; debugSparql?: string };
      if (!controller.signal.aborted) setRecordDebug((current) => ({ ...current, policyDiscovery: payload.debugSparql ?? `POST /proxy/api/policies\n${JSON.stringify({ action: "discover", recordTypes }, null, 2)}` }));
      if (!response.ok) throw new Error(payload.error || `Policy lookup returned HTTP ${response.status}.`);
      if (!controller.signal.aborted) {
        const hasSavedHistoryQuery = describedRecord.some((item) => item.property === "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML" && item.value.trim().length > 0);
        const policies = (payload.policies ?? []).map((item) => {
          // The query-results format is meaningful only for records that actually carry a saved FCT query.
          const templates = (item.templates ?? []).filter((template) =>
            !template.uri.endsWith("BookmarkQueryResultsTemplate") || hasSavedHistoryQuery,
          );
          return { ...item, matchedClasses: item.matchedClasses ?? [], templates, template: templates[0]?.uri ?? null };
        }).filter((item) => item.templates.length > 0);
        setRecordPolicies(policies);
        let preferredPolicy = policies[0] ?? null;
        let preferredTemplate = preferredPolicy?.templates[0]?.uri ?? "";
        try {
          const db = queryTreeHeightDbRef.current;
          if (db && selectedUri) {
            const store = db.transaction("preferences", "readonly").objectStore("preferences");
            const policyKey = recordFormatPreferenceKey("policy");
            const templateKey = recordFormatPreferenceKey("template");
            const readPreference = (key: string) => new Promise<string>((resolve) => {
              if (!key) { resolve(""); return; }
              const req = store.get(key);
              req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : "");
              req.onerror = () => resolve("");
            });
            // Schedule both IndexedDB reads before awaiting either one so
            // the readonly transaction cannot auto-close between requests.
            const [savedPolicy, savedTemplate] = await Promise.all([
              readPreference(policyKey), readPreference(templateKey),
            ]);
            preferredPolicy = policies.find((item) => item.uri === savedPolicy) ?? preferredPolicy;
            preferredTemplate = preferredPolicy?.templates.some((item) => item.uri === savedTemplate) ? savedTemplate : (preferredPolicy?.templates[0]?.uri ?? "");
          }
        } catch { /* Use the first available policy/format when no saved preference is available. */ }
        // The XML query is authoritative. Only classes directly in the active
        // view scope participate; never consult classes from unrelated branches.
        // Test every scoped class against every actual rdf:type, then prefer a
        // discovered policy whose mui:forClass matches that shared class.
        const activePath = getPropertyPath();
        const scopeClasses = getClassesAtNode(activePath.at(-1)?.id ?? null);
        const recordTypeSet = new Set(actualRecordTypes);
        const matchingClass = scopeClasses.find((iri) =>
          recordTypeSet.has(iri) && policies.some((policy) => policy.matchedClasses.includes(iri)));
        const queryClassPolicy = matchingClass
          ? policies.find((policy) => policy.matchedClasses.includes(matchingClass)) ?? null
          : null;
        const explicitSelection = manualRecordFormatSelectionRef.current;
        const manualPolicy = explicitSelection?.recordUri === selectedUri && explicitSelection.queryXml === queryXml
          ? policies.find((policy) => policy.uri === explicitSelection.policyUri &&
              policy.templates.some((template) => template.uri === explicitSelection.templateUri)) ?? null
          : null;
        if (manualPolicy && explicitSelection) {
          preferredPolicy = manualPolicy;
          preferredTemplate = explicitSelection.templateUri;
        } else if (queryClassPolicy) {
          preferredPolicy = queryClassPolicy;
          preferredTemplate = queryClassPolicy.templates[0]?.uri ?? "";
        }
        if (controller.signal.aborted) return;
        setRecordPolicy(preferredPolicy);
        setSelectedRecordTemplateUri(preferredTemplate);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        setRecordPolicyError(error instanceof Error ? error.message : "Could not look up the record policy.");
      }
    }).finally(() => { if (!controller.signal.aborted) { setIsLoadingRecordPolicy(false); setRecordPolicyCheckedUri(selectedUri); } });
    return () => controller.abort();
  }, [selectedUri, personalSparqlEndpoint, describedRecord, describedRecordUri, isDescribing, recordFormatPreferenceLoaded, authSession, selectedResult?.uri, selectedGroupRecord?.uri, queryXml]);

  type RecordValidationReport = {
    conforms: boolean;
    complete: boolean;
    violations: { path: string; message: string; value?: string }[];
    optionalMissing?: { path: string; name: string }[];
    unsupportedConstraints: string[];
    message: string;
  };

  /** The validator and XSLT consume the same record/graph/author snapshot. */
  async function validateRecordSnapshot(
    policy: RecordPolicyOption,
    snapshot: { key: string; uri: string; xml: string; incomplete: boolean },
  ): Promise<RecordValidationReport> {
    const xml = new DOMParser().parseFromString(snapshot.xml, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Cannot validate malformed Record DESCRIBE XML.");
    const ns = "http://openlinksw.com/services/facets/1.0/";
    const triples = Array.from(xml.getElementsByTagNameNS(ns, "row")).flatMap((row) => {
      const cells = Array.from(row.getElementsByTagNameNS(ns, "column"));
      if (cells.length < 3) return [];
      const [subject, predicate, object] = cells.slice(0, 3).map((cell) => cell.textContent?.trim() ?? "");
      if (!subject || !predicate) return [];
      // The viewer snapshot is normalized text-only FCT XML. Use the value's
      // lexical form for term-kind checks until term metadata is retained.
      const objectType = cells[2].getAttribute("termType") || (object.startsWith("_:") ? "bnode" : /^(?:https?:|gttp:|urn:)/i.test(object) ? "uri" : "literal");
      const datatype = cells[2].getAttribute("datatype") || undefined;
      return [{ subject, predicate, object, objectType, ...(datatype ? { datatype } : {}) }];
    });
    const response = await maestroQueryFetch("/proxy/api/policies", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-validate", "RecordPolicyValidation") },
      body: JSON.stringify({ action: "validate", recordUri: snapshot.uri, recordShape: policy.recordShape, triples }),
    });
    const payload = await response.json() as { report?: RecordValidationReport; error?: string };
    if (!response.ok || !payload.report) throw new Error(payload.error || `SHACL validation returned HTTP ${response.status}.`);
    // An incomplete description cannot establish full conformance: missing
    // values may reflect LIMIT/timeout rather than actual absence in the graph.
    if (snapshot.incomplete) return {
      ...payload.report,
      conforms: false,
      complete: false,
      message: "The Record DESCRIBE is incomplete. Increase the Right panel DESCRIBE limit or Record timeout, reload, and validate again. " + payload.report.message,
    };
    return payload.report;
  }

  async function validateSelectedRecord(policyOverride: RecordPolicyOption | null = recordPolicy) {
    if (!selectedUri || !policyOverride) return;
    setIsValidatingRecord(true);
    setRecordValidation(null);
    setRecordPolicyError("");
    try {
      // Validate the *same* immutable DESCRIBE snapshot used by the formatter.
      // A second query would allow validation to pass a different dataset.
      const snapshot = recordDescriptionSnapshot;
      if (!snapshot || snapshot.key !== currentRecordDescriptionKey || snapshot.uri !== selectedUri || isDescribing) {
        throw new Error("The record description must finish loading before validation.");
      }
      const report = await validateRecordSnapshot(policyOverride, snapshot);
      setRecordValidation(report);
      // Validate is the sole trigger for ingesting SHACL-discovered Personal facets.
      // Query clones preserve the live scope but cannot mutate its view.
      try {
        const candidateClasses = classFacets.map((item) => item.uri);
        const candidateProperties = propertyFacets.map((item) => item.uri);
        const candidateRoles = roleFacets.map((item) => item.uri);
        const facetResponse = await maestroQueryFetch("/proxy/api/policies", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-shacl-facet-ingestion", "RecordShaclFacets") },
          body: JSON.stringify({
            action: "facet-discover", recordShape: policyOverride.recordShape,
            classes: candidateClasses, properties: candidateProperties, roles: candidateRoles,
            classQuery: classFacetQueryXml, propertyQuery: propertyFacetQueryXml, roleQuery: roleFacetQueryXml,
          }),
        });
        const facetPayload = await facetResponse.json() as { facets?: { uri: string; direction: "forward" | "reverse"; label: string }[]; graph?: string; propertyShapes?: number; rawPaths?: number; error?: string };
        if (!facetResponse.ok) throw new Error(facetPayload.error || `SHACL facet discovery returned HTTP ${facetResponse.status}.`);
        // Collect the complete SHACL path set before touching the live query.
        // Direction + IRI is the identity; preserve order and deduplicate.
        const queuedFacets = Array.from(new Map((facetPayload.facets ?? [])
          .filter((facet) => facet && /^https?:\/\/|^gttps?:\/\/|^[a-z][a-z0-9+.-]*:/i.test(facet.uri))
          .map((facet) => [`${facet.direction}:${facet.uri}`, facet])).values());
        if (!queuedFacets.length) {
          setRecordPolicyError(`Validation completed, but no Personal facets could be derived from ${policyOverride.recordShape} in ${facetPayload.graph ?? "the configured shapes graph"}. Discovered ${facetPayload.propertyShapes ?? "unknown"} property shapes and ${facetPayload.rawPaths ?? "unknown"} paths. ${facetPayload.propertyShapes === 0 ? "Check whether the SHACL policy document is loaded into your personal graph server." : "Check the shape paths and supported forward/inverse property forms."}`);
        } else {
          // Use the *current* authoritative snapshot, not the tree captured
          // before the asynchronous validation and SHACL requests began.
          const liveTree = fctQueryTreeApi.getTree();
          const scopePath = getPropertyPath();
          const scopeId = scopePath[scopePath.length - 1]?.id ?? null;
          const findScope = (tree: FctQueryTree): FctQueryNode[] | null => {
            if (!scopeId) return tree.children;
            const find = (nodes: FctQueryNode[]): FctQueryNode | null => {
              for (const node of nodes) {
                if (node.id === scopeId) return node;
                const nested = find(node.children);
                if (nested) return nested;
              }
              return null;
            };
            return find(tree.children)?.children ?? null;
          };
          const scopeChildren = findScope(liveTree);
          if (!scopeChildren || !scopeChildren.some((node) => node.id === "query-view")) {
            throw new Error("The current FCT view changed while SHACL facets were being discovered. Please Validate again.");
          }
          let queuedTree = liveTree;
          let changed = false;
          for (const facet of queuedFacets) {
            const nodeName = facet.direction === "reverse" ? "property-of" : "property";
            const existing = findScope(queuedTree)?.find((node) =>
              node.name === nodeName && node.attributes.iri === facet.uri,
            );
            if (existing) {
              if (existing.attributes.src !== "shacl") {
                queuedTree = fctQueryTreeApi.setNodeAttribute(queuedTree, existing.id, "src", "shacl");
                changed = true;
              }
              continue;
            }
            const newNode: FctQueryNode = {
              id: facet.direction === "reverse"
                ? `role-filter-${scopeId ? `${encodeURIComponent(scopeId)}-` : "root-"}${encodeURIComponent(facet.uri)}`
                : `property-filter-${scopeId ? `${encodeURIComponent(scopeId)}-` : "root-"}${encodeURIComponent(facet.uri)}`,
              name: nodeName,
              attributes: { iri: facet.uri, src: "shacl" },
              children: [],
            };
            queuedTree = fctQueryTreeApi.insertNode(queuedTree, scopeId, newNode);
            changed = true;
          }
          // Exactly one authoritative publication for all queued relationships.
          if (changed) replaceQueryTree(queuedTree);
          setFocusWidgetsSuppressed(false);
          setDefaultLeftTab("personal");
        }
      } catch (facetError) {
        console.warn("SHACL facet ingestion failed after record validation:", facetError);
        setRecordPolicyError(facetError instanceof Error ? `Validation completed, but SHACL facet ingestion failed: ${facetError.message}` : "SHACL facet ingestion failed.");
      }
    } catch (error) {
      setRecordPolicyError(error instanceof Error ? error.message : "Could not validate this record.");
    } finally {
      setIsValidatingRecord(false);
    }
  }

  // A formatter result belongs to one record and one selected template. Async
  // responses for older selections may finish later and must never repaint it.
  const currentRecordFormatKey = `${currentRecordDescriptionKey}\u0000${recordPolicy?.uri ?? ""}\u0000${selectedRecordTemplateUri}`;
  const latestRecordFormatKeyRef = useRef(currentRecordFormatKey);
  latestRecordFormatKeyRef.current = currentRecordFormatKey;
  const activeFormatterRequestRef = useRef("");
  const [formattedRecordKey, setFormattedRecordKey] = useState("");
  const currentFormattedRecordHtml = formattedRecordKey === currentRecordFormatKey ? formattedRecordHtml : "";

  async function formatSelectedRecord(templateOverride?: string, preview = false, enrichBookReviews = false): Promise<string | null> {
    if (!recordPolicy) return null;
    const templateUri = templateOverride || selectedRecordTemplateUri || recordPolicy.template;
    if (!templateUri) {
      if (!preview) { setRecordFormatError("This policy does not identify an XSLT template yet."); setFormattedRecordHtml(""); }
      return null;
    }
    if (!recordDescriptionSnapshot || recordDescriptionSnapshot.uri !== selectedUri ||
        recordDescriptionSnapshot.key !== currentRecordDescriptionKey ||
        describedRecordUri !== selectedUri || isDescribing) return null;
    const requestKey = currentRecordFormatKey;
    const isCurrentRequest = () => latestRecordFormatKeyRef.current === requestKey;
    if (!preview && !enrichBookReviews && isCurrentRequest()) { setRecordFormatError(""); setFormattedRecordHtml(""); setFormattedRecordButtonsHtml({}); setFormattedRecordKey(""); }
    try {
      if (!preview && !enrichBookReviews) {
        const checked = await validateRecordSnapshot(recordPolicy, recordDescriptionSnapshot);
        if (!isCurrentRequest()) return null;
        setRecordValidation(checked);
        if (!checked.complete || !checked.conforms) {
          throw new Error(`The selected format was not loaded because its SHACL validation did not pass. ${checked.message} ${checked.violations.map((v) => v.message).join(" ")}`.trim());
        }
      }
      const templateResponse = await maestroQueryFetch("/proxy/api/policies", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-template", "RecordPolicyTemplate") },
        body: JSON.stringify({ action: "template", template: templateUri }),
      });
      const templatePayload = await templateResponse.json() as { templateXslt?: string; nextName?: string; nextVersion?: string; error?: string; debugSparql?: string };
      if (!preview && isCurrentRequest()) setRecordDebug((current) => ({ ...current, templateLookup: templatePayload.debugSparql ?? `POST /proxy/api/policies\n${JSON.stringify({ action: "template", template: templateUri }, null, 2)}` }));
      if (!templateResponse.ok || typeof templatePayload.templateXslt !== "string") throw new Error(templatePayload.error || `Template reload returned HTTP ${templateResponse.status}.`);
      // Formatting never issues a second DESCRIBE. The snapshot is exactly the
      // data the default Record table received, including its completion status.
      // Do not transform a previous resource/graph selection while the new one loads.
      const snapshot = recordDescriptionSnapshot;
      if (!snapshot || snapshot.uri !== selectedUri || snapshot.key !== currentRecordDescriptionKey ||
          describedRecordUri !== selectedUri || isDescribing) {
        if (!preview && isCurrentRequest()) setRecordFormatError("The record description is not ready yet.");
        return null;
      }
      const sourceXml = new DOMParser().parseFromString(snapshot.xml, "application/xml");
      if (sourceXml.querySelector("parsererror") || sourceXml.documentElement.localName !== "facets") {
        throw new Error("The Record viewer's DESCRIBE snapshot is not valid FCT XML.");
      }
      if (!preview && isCurrentRequest()) {
        setRecordDebug((current) => ({ ...current,
          formatterXml: current.xml,
          formatterSparql: current.sparql,
        }));
      }
      const sourceRows = Array.from(sourceXml.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0/", "row"));
      const sourceValues = (predicate: string): string[] => sourceRows.flatMap((row) => {
        const columns = Array.from(row.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0/", "column"));
        if (columns.length < 3 || columns[1].textContent?.trim() !== predicate) return [];
        const value = columns[2].textContent?.trim() ?? "";
        return value ? [value] : [];
      });
      const isPersonTemplate = templateUri.includes("DbpediaPersonRecordTemplate");
      const subjectUris = isPersonTemplate ? Array.from(new Set([
        ...sourceValues("http://purl.org/dc/terms/subject"),
        ...describedRecord.filter((row) => row.property === "http://purl.org/dc/terms/subject").map((row) => row.value),
      ])) : [];
      // Like the Bookmark XSLT results slot, expand linked resources through the
      // existing bounded FCT sandbox, never through a custom unrestricted SPARQL
      // request. This XML is formatter-only; the validated Record snapshot stays
      // untouched. A Review's reviewRating is itself a separate RDF resource.
      if (templateUri.includes("DbpediaBookRecordTemplate") && !preview && enrichBookReviews) {
        const reviewPredicates = new Set([
          "http://schema.org/review", "https://schema.org/review",
          "http://schema.org/reviews", "https://schema.org/reviews",
        ]);
        const bookReviewPredicates = sourceRows.flatMap((row) => {
          const columns = Array.from(row.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0/", "column"));
          const property = columns[1]?.textContent?.trim() ?? "";
          return columns[0]?.textContent?.trim() === selectedUri && reviewPredicates.has(property) ? [property] : [];
        });
        if (bookReviewPredicates.length) {
          // Execute the Book policy's graph-stored XSLT 3.0 pivot with the
          // same server-side SaxonJS sandbox used by the Bookmark formatter.
          // No browser XSLTProcessor or inline browser stylesheet is involved.
          const pivotTemplateUri = "gttp://ggg.maestro.ecosys/shacl/template#DbpediaBookReviewQueryPivot";
          const pivotTemplateResponse = await fetch("/proxy/api/policies", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-book-review-xslt", "BookReviewPivotTemplate") },
            body: JSON.stringify({ action: "template", template: pivotTemplateUri }),
          });
          const pivotTemplatePayload = await pivotTemplateResponse.json() as { templateXslt?: string; error?: string };
          if (!pivotTemplateResponse.ok || !pivotTemplatePayload.templateXslt) {
            throw new Error(pivotTemplatePayload.error || `Book review pivot XSLT unavailable (${pivotTemplateResponse.status}).`);
          }
          const reviewQueryDoc = await transformMaestroQueryXslt(
            pivotTemplatePayload.templateXslt, sourceXml, serializeFctQuery(queryTree), selectedUri,
          );
          const reviewRoot = reviewQueryDoc.documentElement;
          if (!reviewRoot || reviewRoot.localName !== "query") throw new Error("Book review pivot did not produce an FCT query.");
          const activeGraph = selectedRecordAuthor || (selectedRecordGraph
            ? recordGraphs.find((uri) => uri.split("#", 1)[0] === selectedRecordGraph) ?? selectedRecordGraph
            : recordGraphs[0]);
          const originalAddr = reviewRoot.getAttribute("addr") || queryTree.attributes.addr || "";
          const delimiter = originalAddr.indexOf("@");
          if (activeGraph && delimiter >= 0) reviewRoot.setAttribute("addr", `${activeGraph}@${originalAddr.slice(delimiter + 1)}`);
          // ASK preflight: the Book card is already on screen, but its Reviews
          // section is deliberately absent until existence is established.
          const askDoc = reviewQueryDoc.cloneNode(true) as Document;
          const askView = Array.from(askDoc.getElementsByTagName("*")).find((node) => node.localName === "view");
          if (!askView) throw new Error("The Review pivot has no FCT view.");
          askView.setAttribute("type", FCT_VIEW_TYPES.ASK);
          askView.removeAttribute("offset");
          askView.removeAttribute("limit");
          const askResponse = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-book-review-ask", "RecordBookReviewAsk") },
            body: new XMLSerializer().serializeToString(askDoc),
          });
          const askXml = await askResponse.text();
          if (!askResponse.ok) throw new Error(`Book review ASK returned HTTP ${askResponse.status}: ${askXml.slice(0, 300)}`);
          const askResult = new DOMParser().parseFromString(askXml, "application/xml");
          if (askResult.querySelector("parsererror")) throw new Error("Invalid Book review ASK response XML.");
          const askBoolean = Array.from(askResult.getElementsByTagName("*")).find((node) => node.localName === "boolean")?.textContent?.trim();
          if (askBoolean !== "true" && askBoolean !== "false") throw new Error("The Book review ASK response has no valid boolean.");
          if (askBoolean === "false") return null;
          if (!isCurrentRequest()) return null;
          setFormattedRecordHtml((previous) => {
            if (!previous) return previous;
            const html = new DOMParser().parseFromString(previous, "text/html");
            const target = html.getElementById("maestro-record-viewer");
            if (!target) return previous;
            const section = html.createElement("section");
            section.id = "book-reviews-ratings";
            section.className = "border-t border-[#c5b59d]/60 bg-[#f1ece3] px-6 py-7 dark:border-stone-700 dark:bg-[#29251f] sm:px-9";
            const heading = html.createElement("h3");
            heading.id = "book-reviews-title";
            heading.className = "mb-4 font-serif text-2xl font-semibold";
            heading.textContent = "Reviews & ratings";
            const loading = html.createElement("p");
            loading.id = "book-review-loading";
            loading.className = "text-sm text-muted-foreground";
            loading.textContent = "Loading...";
            section.append(heading, loading);
            // Keep Reviews in its original Book-card position before shopping links.
            const bookLinks = html.getElementById("book-links");
            if (bookLinks?.parentElement === target) target.insertBefore(section, bookLinks);
            else target.appendChild(section);
            return html.body.innerHTML;
          });
          const reviewQueryXml = new XMLSerializer().serializeToString(reviewQueryDoc);
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: AbortSignal.timeout(12000),
            headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-book-review-sandbox", "RecordBookReviewListValues") },
            body: reviewQueryXml,
          });
          const responseXml = await response.text();
          if (!response.ok) throw new Error(`Book review list-values returned HTTP ${response.status}: ${responseXml.slice(0, 300)}`);
          const fetched = new DOMParser().parseFromString(responseXml, "application/xml");
          if (fetched.querySelector("parsererror")) throw new Error("Invalid list-values Book review XML.");
          const namespace = "http://openlinksw.com/services/facets/1.0/";
          const targetResult = Array.from(sourceXml.getElementsByTagNameNS(namespace, "result"))
            .find((element) => element.getAttribute("type") === FCT_VIEW_TYPES.DESCRIBE);
          if (targetResult) {
            const insertTriple = (subject: string, predicate: string, object: Element) => {
              if (!subject || !predicate || !object.textContent?.trim()) return;
              const row = sourceXml.createElementNS(namespace, "fct:row");
              const colSubject = sourceXml.createElementNS(namespace, "fct:column");
              colSubject.setAttribute("datatype", "uri"); colSubject.textContent = subject;
              const colPredicate = sourceXml.createElementNS(namespace, "fct:column");
              colPredicate.setAttribute("datatype", "uri"); colPredicate.textContent = predicate;
              const colObject = sourceXml.createElementNS(namespace, "fct:column");
              for (const attribute of Array.from(object.attributes)) colObject.setAttribute(attribute.name, attribute.value);
              colObject.textContent = object.textContent;
              row.append(colSubject, colPredicate, colObject);
              targetResult.appendChild(row);
            };
            const reviewRows = Array.from(fetched.getElementsByTagNameNS(namespace, "row")).slice(0, 5);
            // A linked review must yield focus rows. Never silently present a
            // header-only table when the sandbox query returned no reviews.
            if (!reviewRows.length) {
              throw new Error("The Book review list-values query returned no Review rows. Inspect RecordBookReviewListValues in Network for its generated SPARQL and graph scope.");
            }
            for (const row of reviewRows) {
              const columns = Array.from(row.children).filter((node) => node.localName === "column");
              const reviewUri = columns[0]?.textContent?.trim() || "";
              if (!reviewUri) continue;
              const byPath = new Map<string, Element[]>();
              for (const column of columns.slice(2)) {
                const path = column.getAttribute("path") || "";
                if (!path) continue;
                byPath.set(path, Array.from(column.children).filter((node) => node.localName === "value"));
              }
              for (const [path, values] of byPath) {
                const segments = path.split(/\s+/);
                if (segments.length !== 1) continue;
                for (const value of values) insertTriple(reviewUri, segments[0], value);
              }
              for (const [path, values] of byPath) {
                const segments = path.split(/\s+/);
                if (segments.length !== 2) continue;
                const parentUris = byPath.get(segments[0])?.map((node) => node.textContent?.trim() ?? "").filter(Boolean) ?? [];
                // A nested projected predicate belongs to its linked Rating
                // or Author resource, not to the Review itself.
                for (const parentUri of parentUris) for (const value of values)
                  insertTriple(parentUri, segments[1], value);
              }
            }
          }
        }
      }
      const document = await transformMaestroRecordXslt(
        templatePayload.templateXslt,
        sourceXml,
        serializeFctQuery(queryTree),
        selectedUri,
      );
      const templateRoot = document.body.firstElementChild;
      if (!templateRoot || templateRoot.tagName.toLowerCase() !== "section" || templateRoot.id !== "maestro-record-viewer") {
        throw new Error('The XSLT result must have a root <section id="maestro-record-viewer"> so it can replace the default Record viewer content.');
      }
      // Use the same npm package/version notation used by registry dependency metadata.
      const frameworkRequirement = (templateRoot.getAttribute("mui:framework") ?? "").trim();
      const frameworkMatch = /^([a-z0-9@/._-]+)@\^(\d+)\.(\d+)\.(\d+)$/.exec(frameworkRequirement);
      if (!frameworkMatch) throw new Error('The template must declare a package requirement such as mui:framework="next@^16.4.0".');
      if (frameworkMatch[1] !== templatePayload.nextName) throw new Error(`Template framework package "${frameworkMatch[1]}" does not match the installed package "${templatePayload.nextName || "(unknown)"}".`);
      const installedVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(templatePayload.nextVersion ?? "");
      if (!installedVersion) throw new Error("Maestro could not determine the installed Next.js version to check this template.");
      const requiredVersion = frameworkMatch.slice(2).map(Number);
      const actualVersion = installedVersion.slice(1).map(Number);
      const versionIsOlder = actualVersion[0] !== requiredVersion[0]
        ? actualVersion[0] < requiredVersion[0]
        : actualVersion[1] !== requiredVersion[1]
          ? actualVersion[1] < requiredVersion[1]
          : actualVersion[2] < requiredVersion[2];
      if (actualVersion[0] !== requiredVersion[0] || versionIsOlder) {
        throw new Error(`This template requires ${frameworkRequirement}; the installed version is ${templatePayload.nextVersion}.`);
      }
      // A DBpedia Person often has dbp:/schema:/FOAF properties absent from
      // the starter stylesheet's small dbo: field list. Preserve those values
      // in a supplemental section of the *same* formatted card/snapshot.
      if (isPersonTemplate && !preview) {
        const reserved = new Set([
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          "http://www.w3.org/2000/01/rdf-schema#label",
          "http://xmlns.com/foaf/0.1/depiction",
          "http://dbpedia.org/ontology/thumbnail",
          "http://purl.org/dc/terms/subject",
        ]);
        const supplementary = new Map<string, string[]>();
        // Work directly from the exact XML document passed to the XSLT.
        // describedRecord is another React state value and may lag behind
        // recordDescriptionSnapshot during an automatic format transition.
        for (const row of sourceRows) {
          const columns = Array.from(row.getElementsByTagNameNS("http://openlinksw.com/services/facets/1.0/", "column"));
          if (columns.length < 3) continue;
          const subject = columns[0].textContent?.trim() ?? "";
          const property = columns[1].textContent?.trim() ?? "";
          const value = columns[2].textContent?.trim() ?? "";
          if (subject !== selectedUri || !property || !value || reserved.has(property)) continue;
          const values = supplementary.get(property) ?? [];
          if (!values.includes(value)) values.push(value);
          supplementary.set(property, values);
        }
        if (supplementary.size) {
          const section = document.createElement("section");
          section.id = "maestro-person-additional-fields";
          section.className = "border-t px-5 py-4";
          const heading = document.createElement("h3");
          heading.id = "maestro-person-additional-heading";
          heading.className = "mb-3 text-sm font-semibold";
          heading.textContent = "Additional details";
          section.appendChild(heading);
          const list = document.createElement("dl");
          list.id = "maestro-person-additional-list";
          list.className = "space-y-2";
          Array.from(supplementary.entries()).slice(0, 80).forEach(([property, values], index) => {
            const row = document.createElement("div"); row.id = `maestro-person-extra-${index}`;
            row.className = "grid grid-cols-[minmax(7rem,35%)_1fr] gap-2 text-sm";
            const term = document.createElement("dt"); term.id = `maestro-person-extra-term-${index}`;
            term.className = "break-words text-muted-foreground"; term.textContent = toLabel(property);
            const description = document.createElement("dd"); description.id = `maestro-person-extra-value-${index}`;
            description.className = "break-words";
            values.slice(0, 20).forEach((value, valueIndex) => {
              if (valueIndex) {
                const separator = document.createElement("span"); separator.id = `maestro-person-extra-sep-${index}-${valueIndex}`;
                separator.textContent = " · "; description.appendChild(separator);
              }
              if (/^https?:\/\//i.test(value)) {
                const link = document.createElement("a"); link.id = `maestro-person-extra-link-${index}-${valueIndex}`;
                link.setAttribute("href", "#"); link.setAttribute("data-maestro-record-uri", value);
                link.textContent = value; description.appendChild(link);
              } else {
                const literal = document.createElement("span"); literal.id = `maestro-person-extra-literal-${index}-${valueIndex}`;
                literal.textContent = value; description.appendChild(literal);
              }
            });
            row.append(term, description); list.appendChild(row);
          });
          section.appendChild(list);
          templateRoot.querySelector("#record-footer")?.before(section);
          if (!section.parentElement) templateRoot.appendChild(section);
        }
      }
      // Older loaded Person templates may omit subject badges or depictions.
      // Reconcile their output with the SAME authoritative DESCRIBE snapshot.
      if (isPersonTemplate && !preview) {
        const subjects = Array.from(new Set(subjectUris.filter(Boolean)));
        if (subjects.length && !templateRoot.querySelector("#record-subject-badges")) {
          const badges = document.createElement("div");
          badges.id = "record-subject-badges";
          badges.className = "flex flex-wrap gap-1.5 border-t px-5 py-3";
          subjects.forEach((value, index) => {
            const item = document.createElement(/^https?:\/\//i.test(value) ? "a" : "span");
            item.id = `record-subject-${index + 1}`;
            item.className = "inline-flex rounded-full border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground hover:bg-accent";
            item.textContent = /^https?:\/\//i.test(value) ? toLabel(value) : value;
            if (item.tagName === "A") {
              item.setAttribute("href", "#");
              item.setAttribute("data-maestro-record-uri", value);
            }
            badges.appendChild(item);
          });
          (templateRoot.querySelector("#record-footer") ?? templateRoot.lastElementChild)?.before(badges);
        }
        const picturePredicates = ["http://xmlns.com/foaf/0.1/depiction", "http://dbpedia.org/ontology/thumbnail", "http://dbpedia.org/ontology/depiction", "http://schema.org/image", "https://schema.org/image"];
        const pictures = Array.from(new Set(picturePredicates.flatMap(sourceValues).filter((value) => /^https?:\/\//i.test(value))));
        if (pictures.length && !templateRoot.querySelector("#record-depictions")) {
          const gallery = document.createElement("section");
          gallery.id = "record-depictions";
          gallery.className = "border-b bg-muted/20 p-3";
          const track = document.createElement("div");
          track.id = "record-carousel-track";
          track.className = "mx-auto flex max-w-xs snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth rounded-lg";
          pictures.forEach((uri, index) => {
            const img = document.createElement("img");
            img.id = `record-photo-${index + 1}`;
            img.src = uri;
            img.alt = `Depiction ${index + 1} of ${pictures.length}`;
            img.loading = "lazy";
            img.referrerPolicy = "no-referrer";
            img.className = "h-56 min-w-full shrink-0 snap-center rounded-md object-contain";
            track.appendChild(img);
          });
          gallery.appendChild(track);
          if (pictures.length > 1) {
            const controls = document.createElement("div");
            controls.id = "record-carousel-controls";
            controls.className = "mt-2 flex items-center justify-between gap-2";
            for (const [direction, title] of [["previous", "Previous"], ["next", "Next"]] as const) {
              const button = document.createElement("button");
              button.id = `record-carousel-${direction}`;
              button.type = "button";
              button.setAttribute("data-maestro-carousel", direction);
              button.className = "rounded-md border px-3 py-1 text-xs hover:bg-accent";
              button.textContent = title;
              controls.appendChild(button);
            }
            gallery.appendChild(controls);
          }
          (templateRoot.querySelector("#record-header") ?? templateRoot.firstElementChild)?.after(gallery);
        }
      }
      // Resolve URI-valued card fields to RDF labels using the same graph server,
      // while preserving the URI for Maestro's root-value navigation.
      // Some older templates emit URI objects as plain <dd> text. Promote
      // those individual values to URI-aware links instead of requiring every
      // graph-stored stylesheet to be rewritten for Maestro navigation.
      for (const field of Array.from(document.body.querySelectorAll<HTMLElement>("dd[id]"))) {
        if (field.querySelector("[data-maestro-record-uri]")) continue;
        const text = (field.textContent ?? "").trim();
        if (!/^https?:\/\//i.test(text)) continue;
        const values = text.split(/,\s+(?=https?:\/\/)/i).filter(Boolean);
        if (!values.every((value) => /^https?:\/\//i.test(value))) continue;
        field.replaceChildren(...values.flatMap((value, index) => {
          const anchor = document.createElement("a");
          anchor.id = `${field.id}-link-${index + 1}`;
          anchor.setAttribute("data-maestro-record-uri", value);
          anchor.setAttribute("href", "#");
          anchor.textContent = value;
          if (index === 0) return [anchor];
          const separator = document.createElement("span");
          separator.id = `${field.id}-separator-${index + 1}`;
          separator.textContent = " · ";
          return [separator, anchor];
        }));
      }
      const uriTargets = Array.from(document.body.querySelectorAll<HTMLElement>("[data-maestro-record-uri]"));
      // URI labels are already returned in the Record SELECT response and cached
      // before formatting; no follow-up FCT DESCRIBE requests are required.
      const queryAddrForLabels = queryTree.attributes.addr || (selectedEndpointId ? `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}` : "");
      const cachedLabels = recordUriLabelCacheRef.current;
      for (const target of uriTargets) {
        const uri = target.getAttribute("data-maestro-record-uri") ?? "";
        if (!uri) continue;
        target.textContent = cachedLabels.get(`${queryAddrForLabels}\u0000${uri}`) ?? toLabel(uri);
        target.setAttribute("title", uri);
        target.setAttribute("href", "#");
        target.classList.add("cursor-pointer", "text-sky-700", "hover:underline", "dark:text-sky-400");
      }
      // Both views share this snapshot. Surface partial DESCRIBE responses rather
      // than imply that an omitted profile field was absent from the graph.
      if (recordDescriptionSnapshot.incomplete) {
        const warning = document.createElement("p");
        warning.id = "maestro-record-partial-warning";
        warning.className = "border-t bg-muted/40 px-5 py-2 text-xs text-muted-foreground";
        warning.textContent = "This record description is incomplete. Some fields may be missing.";
        templateRoot.querySelector("#record-fields")?.insertAdjacentElement("afterend", warning);
      }
      const sourceIds = new Set<string>();
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const id = element.getAttribute("id");
        if (!id) throw new Error(`Template element <${element.tagName.toLowerCase()}> is missing its required id.`);
        if (sourceIds.has(id)) throw new Error(`Template contains duplicate id \"${id}\".`);
        sourceIds.add(id);
      }
      const queryDefinitions = new Map<string, Element>();
      document.querySelectorAll("query[id]").forEach((element) => {
        const id = element.getAttribute("id");
        if (id) queryDefinitions.set(id, element);
      });
      // Keep XML query definitions and all their IDs in a hidden template area so repeated HTML components do not duplicate those IDs.
      const queryDefinitionContainer = document.createElement("div");
      queryDefinitionContainer.hidden = true;
      queryDefinitionContainer.setAttribute("aria-hidden", "true");
      queryDefinitionContainer.setAttribute("data-maestro-query-definitions", "true");
      for (const queryDefinition of queryDefinitions.values()) queryDefinitionContainer.appendChild(queryDefinition);
      if (queryDefinitions.size > 0) document.body.appendChild(queryDefinitionContainer);
      const xpathValues = (xml: XMLDocument, expression: string): string[] => {
        const resolver = (prefix: string | null) => prefix === "fct" ? "http://openlinksw.com/services/facets/1.0/" : null;
        try {
          const result = xml.evaluate(expression, xml.documentElement, resolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const values: string[] = [];
          for (let index = 0; index < result.snapshotLength; index += 1) {
            const node = result.snapshotItem(index);
            const value = node?.nodeType === Node.ATTRIBUTE_NODE ? node.nodeValue : node?.textContent;
            if (value?.trim()) values.push(value.trim());
          }
          if (values.length) return values;
          const scalar = xml.evaluate(expression, xml.documentElement, resolver, XPathResult.STRING_TYPE, null).stringValue;
          return scalar.trim() ? [scalar.trim()] : [];
        } catch {
          // A malformed or unmatched template XPath must never leak into the rendered record.
          return [];
        }
      };
      const sanitize = (root: Element) => {
        root.querySelectorAll("script, iframe, object, embed, form, base, link, style, meta[http-equiv]").forEach((element) => element.remove());
        for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
          for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (/^on/i.test(name) || name === "srcdoc") element.removeAttribute(attribute.name);
            else if (["href", "src", "action", "formaction", "xlink:href"].includes(name) && /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
          }
        }
      };
      const setBoundValue = (element: Element, values: string[]) => {
        let value = values.join(", ");
        // Render bookmark creation timestamps as a readable local date/time.
        if (element.getAttribute("mui:data") === "http://purl.org/dc/terms/created" && values[0]) {
          const parsedDate = new Date(values[0]);
          if (!Number.isNaN(parsedDate.getTime())) {
            value = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsedDate);
          }
        }
        const tagName = element.tagName.toLowerCase();
        if (tagName === "input") element.setAttribute("value", value);
        else if (tagName === "a" && element.hasAttribute("mui:data")) {
          const safeUrl = values[0] ?? "";
          if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(safeUrl)) {
            element.setAttribute("href", safeUrl);
            element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          } else element.removeAttribute("href");
          element.textContent = value;
        } else if (element.getAttribute("mui:data") === "maestro:bookmark-tags") {
          element.replaceChildren(...values.map((tag) => {
            const badge = document.createElement("span");
            badge.className = "inline-flex items-center rounded-full border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground";
            badge.textContent = tag;
            return badge;
          }));
        } else element.textContent = value;
      };
      const bindingExpression = (binding: string): string => {
        if (binding.startsWith("xpath:")) return binding.slice(6).trim();
        // Backward compatibility for existing templates that still bind by predicate IRI.
        const escaped = binding.replace(/&/g, "&amp;").replace(/'/g, "&apos;");
        // Match the predicate wherever it appears in a DESCRIBE row and read the row's final column as its object.
      // This avoids assuming that every FCT response shape places predicate/object in columns 2 and 3.
      return `/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='${escaped}']]/fct:column[last()]`;
      };
      const bindValues = (root: Element, xml: XMLDocument) => {
        for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
          const binding = element.getAttribute("mui:data");
          if (binding) setBoundValue(element, xpathValues(xml, bindingExpression(binding)));
          const hrefBinding = element.getAttribute("mui:href");
          if (hrefBinding) {
            const href = xpathValues(xml, bindingExpression(hrefBinding))[0] ?? "";
            element.removeAttribute("mui:href");
            if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(href)) {
              element.setAttribute("href", href);
              element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
              element.setAttribute("rel", "noopener noreferrer");
            } else {
              element.setAttribute("href", "");
            }
          }
        }
      };

      // Templates may declare controls with mui:parent="<id>". Remove those controls
      // from the record body and render them into the matching application button bar.
      const templateButtonsByParent: Record<string, string[]> = {};
      for (const button of Array.from(document.body.querySelectorAll("[mui\\:parent]"))) {
        const parentId = (button.getAttribute("mui:parent") ?? "").trim();
        button.removeAttribute("mui:parent");
        if (!parentId) throw new Error("A template control with mui:parent must name its target element id.");
        if (parentId === "record_title_icon" && (button.localName !== "svg" || button.namespaceURI !== "http://www.w3.org/2000/svg")) {
          throw new Error("The Record title icon slot only accepts SVG artwork.");
        }
        sanitize(button);
        (templateButtonsByParent[parentId] ??= []).push(button.outerHTML);
        button.remove();
      }

      const queryComponents = Array.from(document.body.querySelectorAll("[mui\\:query]"))
        .filter((element) => !element.closest("[data-maestro-query-definitions]"));
      const elementDepth = (element: Element) => { let depth = 0; for (let parent = element.parentElement; parent; parent = parent.parentElement) depth += 1; return depth; };
      queryComponents.sort((left, right) => elementDepth(right) - elementDepth(left));
      let queryInstanceCounter = 0;
      const makeInstanceIdsUnique = (root: Element) => {
        const elements = [root, ...Array.from(root.querySelectorAll("*"))];
        const replacements = new Map<string, string>();
        for (const element of elements) {
          const id = element.getAttribute("id");
          if (!id) continue;
          const uniqueId = `${id}--maestro-instance-${++queryInstanceCounter}`;
          replacements.set(id, uniqueId);
          element.setAttribute("id", uniqueId);
        }
        for (const element of elements) {
          for (const attributeName of ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "headers", "list", "form"]) {
            const value = element.getAttribute(attributeName);
            if (!value) continue;
            const rewritten = value.split(/\s+/).map((id) => replacements.get(id) ?? id).join(" ");
            element.setAttribute(attributeName, rewritten);
          }
          const href = element.getAttribute("href");
          if (href?.startsWith("#") && replacements.has(href.slice(1))) element.setAttribute("href", `#${replacements.get(href.slice(1))}`);
        }
      };
      for (const component of queryComponents) {
        const queryId = component.getAttribute("mui:query") ?? "";
        const queryDefinition = queryDefinitions.get(queryId);
        if (!queryDefinition) throw new Error(`Template component references missing query id \"${queryId}\".`);
        const queryXml = queryDefinition.outerHTML;
        if (queryXml.length > 100000 || !/^\s*<query\b/i.test(queryXml) || !/openlinksw\.com\/services\/facets\/1\.0/.test(queryXml)) {
          throw new Error(`Embedded query \"${queryId}\" is not a valid bounded Maestro FCT query.`);
        }
        const queryResponse = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-template-query", "RecordTemplateQuery") },
          body: queryXml,
        });
        const queryData = await readFctResponse(queryResponse);
        const results = queryData.results.slice(0, 100);
        const replacements: Element[] = [];
        for (const result of results) {
          if (!result.uri || result.termType !== "uri") continue;
          const clone = component.cloneNode(true) as Element;
          clone.removeAttribute("mui:query");
          clone.setAttribute("data-result-uri", result.uri);
          clone.setAttribute("data-maestro-query-instance", "true");
          makeInstanceIdsUnique(clone);
          // The removed per-resource DESCRIBE helper is not available here.
          // Bind from the already loaded Record snapshot instead.
          bindValues(clone, sourceXml);
          sanitize(clone);
          replacements.push(clone);
        }
        if (replacements.length) component.replaceWith(...replacements);
        else component.replaceWith(document.createTextNode(""));
      }

      // Evaluate XPath bindings against the actual fct:facets XML returned by DESCRIBE.
      const currentDocument = sourceXml;
      // Run the exact saved FCT query with a five-row window, then clone that XML
      // and change only the view type to count so the count uses identical filters.
      const historyQueryXml = xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#historyQueryXML']]/fct:column[last()]" )[0];
      const historyCountElement = document.body.querySelector("[mui\\:history-query-count]");
      const historyResultsElement = document.body.querySelector("[mui\\:history-query-results]");
      if ((historyCountElement || historyResultsElement) && historyQueryXml && /^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(historyQueryXml)) {
        const savedQueryDocument = new DOMParser().parseFromString(historyQueryXml, "application/xml");
        if (savedQueryDocument.querySelector("parsererror")) throw new Error("The Bookmark's saved FCT query XML is malformed.");
        // addr is authoritative: its first @ separates graph from graph
        // server, and any later @ belongs to the graph-server portion.
        const savedQueryRoot = savedQueryDocument.documentElement;
        const existingAddress = savedQueryRoot.getAttribute("addr") ?? "";
        const addressDelimiter = existingAddress.indexOf("@");
        const endpointHint = addressDelimiter >= 0 ? existingAddress.slice(addressDelimiter + 1).trim() : "";
        const savedEndpoint = endpointHint
          ? fctEndpoints.find((endpoint) => endpoint.id === endpointHint || endpoint.url === endpointHint || endpoint.label === endpointHint)
          : fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId);
        if (!savedEndpoint) throw new Error("The Bookmark's query addr does not identify a configured graph server.");
        const graph = addressDelimiter >= 0
          ? existingAddress.slice(0, addressDelimiter).trim()
          : (savedQueryRoot.getAttribute("graph")?.trim() ?? "");
        savedQueryRoot.setAttribute("addr", `${graph}@${savedEndpoint.url}`);
        savedQueryRoot.removeAttribute("graph");
        //if (savedEndpoint.id !== selectedEndpointId) await synchronizeFctEndpointSelection(savedEndpoint.id);
		
		
        const savedView = Array.from(savedQueryDocument.getElementsByTagName("*")).find((element) => element.localName === "view");
        if (!savedView) throw new Error("The Bookmark's saved FCT query has no view element.");
        savedView.setAttribute("limit", "5");
        savedView.setAttribute("offset", "0");
        const boundedQuery = new XMLSerializer().serializeToString(savedQueryDocument);
        const countQueryDocument = savedQueryDocument.cloneNode(true) as XMLDocument;
        const countView = Array.from(countQueryDocument.getElementsByTagName("*")).find((element) => element.localName === "view");
        if (!countView) throw new Error("Could not clone the saved FCT query's view for counting.");
        // The SPARQL translator does not support view type="count". Count via a
        // text-view clone with a larger bounded window instead, while preserving
        // the exact saved query filters and bindings.
        countView.setAttribute("type", FCT_VIEW_TYPES.TEXT);
        countView.setAttribute("limit", "100000");
        countView.setAttribute("offset", "0");
        const countQuery = new XMLSerializer().serializeToString(countQueryDocument);
        const [queryResponse, countResponse] = await Promise.all([
          cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("bookmark-history-query-results", "BookmarkHistoryQueryResults") }, body: boundedQuery }),
          cachedFetchFct("/proxy/api/fct", { method: "POST", cache: "no-store", headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("bookmark-history-query-count", "BookmarkHistoryQueryCount") }, body: countQuery }),
        ]);
        const [queryResponseText, countResponseText] = await Promise.all([queryResponse.clone().text(), countResponse.clone().text()]);
        const queryData = await readFctResponse(queryResponse);
        // A count failure must not discard successful result rows. The fallback
        // count is the number returned by the expanded text query (capped at 100k).
        let countData: ParsedFctResponse | null = null;
        try { countData = await readFctResponse(countResponse); } catch { /* show bounded results even if counting fails */ }
        const sparqlMatch = queryResponseText.match(/<fct:sparql>([\s\S]*?)<\/fct:sparql>/i);
        setBookmarkQueryDebug({ xml: boundedQuery, sparql: sparqlMatch ? sparqlMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&") : "SPARQL was not included in the FCT response.", response: queryResponseText, countResponse: countResponseText });
        if (historyCountElement) {
          historyCountElement.removeAttribute("mui:history-query-count");
          const total = countData?.results.length;
          historyCountElement.textContent = typeof total === "number"
            ? `${shortenCount(total)} matching result${total === 1 ? "" : "s"}${total >= 100000 ? " (count capped at 100k)" : ""}; showing up to five.`
            : `${shortenCount(queryData.results.length)} result${queryData.results.length === 1 ? "" : "s"} returned; showing up to five (count unavailable).`;
        }
        if (historyResultsElement) {
          historyResultsElement.removeAttribute("mui:history-query-results");
          const itemTemplate = historyResultsElement.querySelector("li");
          historyResultsElement.replaceChildren();
          for (const result of queryData.results.slice(0, 5)) {
            const item = itemTemplate?.cloneNode(true) as HTMLLIElement | undefined ?? document.createElement("li");
            item.textContent = result.title || result.uri;
            item.removeAttribute("id");
            if (result.uri && result.termType === "uri") {
              const link = document.createElement("a");
              link.href = result.uri; link.target = "_blank"; link.rel = "noopener noreferrer";
              link.textContent = result.title || result.uri; link.className = "underline underline-offset-2";
              item.replaceChildren(link);
            }
            historyResultsElement.appendChild(item);
          }
          if (!queryData.results.length) {
            const item = document.createElement("li"); item.textContent = "No results returned.";
            historyResultsElement.appendChild(item);
          }
        }
      } else {
        if (historyCountElement) historyCountElement.textContent = historyQueryXml ? "The saved query could not be run." : "No saved FCT query is stored on this Bookmark.";
        if (historyResultsElement) historyResultsElement.replaceChildren();
      }
      for (const element of Array.from(document.body.querySelectorAll("[mui\\:data], [mui\\:href]"))) {
        if (element.closest("[data-maestro-query-instance]")) continue;
        const binding = element.getAttribute("mui:data");
        if (binding === "maestro:bookmark-tags") {
          const tagValues = [
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://purl.org/dc/terms/subject']]/fct:column[last()]"),
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://rdfs.org/scot/ns#has_tag']]/fct:column[last()]"),
            ...xpathValues(currentDocument, "/fct:facets/fct:result[@type='describe']/fct:row[fct:column[.='http://www.w3.org/2004/02/skos/core#prefLabel']]/fct:column[last()]"),
          ].filter((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value));
          setBoundValue(element, [...new Set(tagValues)]);
        } else if (binding) setBoundValue(element, xpathValues(currentDocument, bindingExpression(binding)));
        const hrefBinding = element.getAttribute("mui:href");
        if (hrefBinding) {
          const href = xpathValues(currentDocument, bindingExpression(hrefBinding))[0] ?? "";
          element.removeAttribute("mui:href");
          if (/^(https?:\/\/|\/(?!\/)|\.{1,2}\/|\?|#)/i.test(href)) {
            element.setAttribute("href", href);
            element.setAttribute("target", element.id === "bookmark-title-link" ? "_self" : "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          } else {
            // Do not expose unresolved XPath expressions or retain a stale destination.
            element.setAttribute("href", "");
          }
        }
      }
      // XSLT may emit declarative template calls. Interpret them against query
      // clones, not the authoritative live tree. A live-scope call is queued
      // until the full stylesheet and all sandbox queries have completed.
      // Grammar:
      //   <mui:template-call scope="sandbox" action="fctQueryTreeApi.setSearchText(undefined, 'cat')"
      //                      execute="true" target="template-results" />
      //   <mui:template-call scope="live" action="fctQueryTreeApi.addClass(undefined, null, 'http://example.org/Cat')" />
      // Optional direct <query> children of a sandbox call may be emitted by
      // xsl:copy-of from /mctx:context/mctx:live-query/fct:query.
      const templateCalls = Array.from(document.body.querySelectorAll("mui\\:template-call"));
      if (templateCalls.length > 64) throw new Error("The XSLT template exceeds the limit of 64 query calls.");
      const templateApi = fctQueryTreeApi as unknown as Record<string, (...args: unknown[]) => unknown>;
      let sandboxTree = fctQueryTreeApi.getTree(queryTree);
      let queuedLiveTree = fctQueryTreeApi.getTree(queryTree);
      const liveSnapshots: string[] = [];
      let executedSandboxQueries = 0;
      for (const call of templateCalls) {
        const scope = (call.getAttribute("scope") ?? "sandbox").trim();
        if (scope !== "sandbox" && scope !== "live") throw new Error("XSLT template call scope must be sandbox or live.");
        const action = (call.getAttribute("action") ?? "").trim();
        const explicitQuery = call.querySelector("query");
        if (scope === "live" && explicitQuery) throw new Error("Live template calls must use the approved query-edit API, not raw query XML.");
        if (action) {
          const parsedAction = parsePolicyQueryAction(action, call, selectedUri);
          const startingTree = scope === "live" ? queuedLiveTree : sandboxTree;
          const result = templateApi[parsedAction.method](startingTree, ...parsedAction.args.slice(1));
          if (!result || typeof result !== "object") throw new Error(`Template operation ${parsedAction.method} did not produce a query tree.`);
          const nextTree = fctQueryTreeApi.getTree(result as typeof startingTree);
          if (scope === "live") {
            queuedLiveTree = nextTree;
            liveSnapshots.push(serializeFctQuery(nextTree));
          } else sandboxTree = nextTree;
        } else if (!explicitQuery) {
          throw new Error("An XSLT template call must have an approved action or a cloned query.");
        }

        if (call.getAttribute("execute") === "true") {
          if (scope !== "sandbox") throw new Error("Only sandboxed template queries may execute before the live queue is flushed.");
          if (++executedSandboxQueries > 4) throw new Error("The XSLT template exceeds four sandbox query executions.");
          let queryXml = explicitQuery ? explicitQuery.outerHTML : serializeFctQuery(sandboxTree);
          const isolatedQuery = new DOMParser().parseFromString(queryXml, "application/xml");
          if (isolatedQuery.querySelector("parsererror") || isolatedQuery.documentElement.localName !== "query") {
            throw new Error("Sandbox template query is not a valid FCT XML query.");
          }
          const address = isolatedQuery.documentElement.getAttribute("addr") ?? "";
          const currentAddress = queryTree.attributes.addr ?? "";
          // Templates may change filters and view settings, but must not
          // silently redirect credentials/requests to a different graph server.
          if (!address || address.slice(address.indexOf("@") + 1) !== currentAddress.slice(currentAddress.indexOf("@") + 1)) {
            throw new Error("A sandbox query must use the live query's graph server.");
          }
          for (const view of Array.from(isolatedQuery.getElementsByTagName("*")).filter((element) => element.localName === "view")) {
            const limit = Number(view.getAttribute("limit") ?? 30);
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) view.setAttribute("limit", "100");
            view.setAttribute("offset", "0");
          }
          queryXml = new XMLSerializer().serializeToString(isolatedQuery);
          if (queryXml.length > 100000) throw new Error("Sandbox FCT query is too large.");
          if (!preview) {
            const response = await cachedFetchFct("/proxy/api/fct", {
              method: "POST", cache: "no-store",
              headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("record-xslt-sandbox", "RecordXsltSandbox") },
              body: queryXml,
            });
            const results = (await readFctResponse(response)).results.slice(0, 100);
            const targetId = (call.getAttribute("target") ?? "").trim();
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) {
              // Preserve the first child as a styled result prototype when present.
              const prototype = target.firstElementChild?.cloneNode(true) as Element | undefined;
              target.replaceChildren();
              for (const result of results) {
                const child = prototype?.cloneNode(true) as Element | undefined ?? document.createElement("div");
                child.removeAttribute("id");
                child.textContent = result.title || result.uri;
                target.appendChild(child);
              }
            }
          }
        }
        call.remove();
      }

      if (!preview && !isCurrentRequest()) return null;
      if (!preview && liveSnapshots.length) {
        // Save every intermediate History snapshot in queue order, but do not
        // publish any intermediate tree. Only the final replaceTree notifies
        // Maestro's FCT subscribers and causes a query to execute.
        const finalXml = liveSnapshots[liveSnapshots.length - 1];
        if (authSession) {
          templateHistoryFlushRef.current = true;
          try {
            await historyWriteQueueRef.current;
            let previousXml = serializeFctQuery(queryTree);
            for (const snapshot of liveSnapshots) {
              if (snapshot === previousXml) continue;
              const url = new URL(window.location.href);
              url.searchParams.set("q", snapshot);
              await writeHistoryVisit(snapshot, url.toString(), deriveHistoryAction(previousXml, snapshot));
              previousXml = snapshot;
            }
            historyVisitQueryRef.current = finalXml;
          } catch (cause) {
            console.warn("Could not persist every queued template edit to History", cause);
            // Let Maestro's ordinary History effect record the final query if
            // an intermediate History write fails.
            historyVisitQueryRef.current = "";
          } finally {
            templateHistoryFlushRef.current = false;
          }
        }
        replaceQueryTree(queuedLiveTree);
      }

      sanitize(document.body);
      // Embedded XML query definitions remain present with their IDs in the hidden template area.
      document.querySelectorAll("query").forEach((element) => { element.setAttribute("hidden", ""); element.setAttribute("aria-hidden", "true"); });
      if (preview) {
        const previewRoot = document.body.firstElementChild;
        if (previewRoot) {
          previewRoot.querySelectorAll("[id]").forEach((element) => element.setAttribute("id", `preview-${templateUri.replace(/[^a-z0-9]/gi, "-")}-${element.id}`));
          if (previewRoot.id) previewRoot.id = `preview-${templateUri.replace(/[^a-z0-9]/gi, "-")}-${previewRoot.id}`;
        }
        return document.body.innerHTML;
      }
      if (!isCurrentRequest()) return null;
      setFormattedRecordButtonsHtml(Object.fromEntries(Object.entries(templateButtonsByParent).map(([parentId, buttons]) => [parentId, buttons.join("")])));
      // Review rows in the initial XSLT are only placeholders until the
      // asynchronous ASK/list-values pipeline has verified and loaded them.
      // Keep the rest of the Book card visible immediately.
      if (templateUri.includes("DbpediaBookRecordTemplate") && !enrichBookReviews) {
        document.getElementById("book-reviews-ratings")?.remove();
      }
      const initialRecordHtml = document.body.innerHTML;
      setFormattedRecordHtml(initialRecordHtml);
      setFormattedRecordKey(requestKey);
      setRecordControlsOpen(false);
      return initialRecordHtml;
    } catch (error) {
      if (!preview && !enrichBookReviews && isCurrentRequest()) { setRecordFormatError(error instanceof Error ? error.message : "Could not format this record."); setFormattedRecordHtml(""); setFormattedRecordKey(""); setFormattedRecordButtonsHtml({}); }
      if (enrichBookReviews) {
        console.warn("Book review enrichment failed; original Book card is preserved.", error);
        // Deferred enrichment must not erase the already formatted Book. Give
        // users a visible failure instead of leaving a deceptively empty table.
        if (isCurrentRequest()) {
          const message = error instanceof Error ? error.message : "The Review query could not be completed.";
          setFormattedRecordHtml((previous) => {
            if (!previous) return previous;
            const html = new DOMParser().parseFromString(previous, "text/html");
            const tableBody = html.getElementById("book-review-table-body");
            const pending = html.getElementById("book-review-loading");
            if (pending) {
              pending.id = "book-review-load-error";
              pending.className = "text-sm text-destructive";
              pending.textContent = `Reviews could not be loaded: ${message}`;
              return html.body.innerHTML;
            }
            if (!tableBody) return previous;
            const row = html.createElement("tr");
            row.id = "book-review-load-error-row";
            const cell = html.createElement("td");
            cell.id = "book-review-load-error";
            cell.colSpan = 3;
            cell.className = "px-4 py-3 text-sm text-destructive";
            cell.textContent = `Reviews could not be loaded: ${message}`;
            row.appendChild(cell);
            tableBody.replaceChildren(row);
            return html.body.innerHTML;
          });
        }
      }
      return null;
    }
  }

  // Render the validated Book card first. Linked reviews and ratings are optional
  // enrichment: run a second sandbox pass only after the initial card is visible.
  // One attempt per record/template avoids repeated network work on rerenders.
  const attemptedBookReviewEnrichmentRef = useRef("");
  useEffect(() => {
    if (!currentFormattedRecordHtml || !selectedRecordTemplateUri.includes("DbpediaBookRecordTemplate") ||
        !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey ||
        !selectedUri || isDescribing) return;
    const key = currentRecordFormatKey;
    if (attemptedBookReviewEnrichmentRef.current === key) return;
    attemptedBookReviewEnrichmentRef.current = key;
    void formatSelectedRecord(undefined, false, true);
  }, [currentFormattedRecordHtml, currentRecordFormatKey, selectedRecordTemplateUri, recordDescriptionSnapshot, currentRecordDescriptionKey, selectedUri, isDescribing]);

  useEffect(() => {
    if (!recordFormatMenuOpen || !recordPolicy || !selectedUri || recordPolicyCheckedUri !== selectedUri || recordPolicies.flatMap((policy) => policy.templates).length < 1) { setRecordFormatPreviews({}); return; }
    let cancelled = false;
    void (async () => {
      const previews: Record<string, string> = {};
      for (const template of recordPolicy.templates) {
        const html = await formatSelectedRecord(template.uri, true);
        if (html) previews[template.uri] = html;
        if (cancelled) return;
      }
      if (!cancelled) setRecordFormatPreviews(previews);
    })();
    return () => { cancelled = true; };
  }, [recordFormatMenuOpen, recordPolicy?.uri, recordPolicies.map((policy) => `${policy.uri}:${policy.templates.map((template) => template.uri).join(",")}`).join("|"), selectedUri, personalSparqlEndpoint, recordPolicyCheckedUri]);

  useEffect(() => {
    if (!recordFormatPreferenceLoaded || !recordFormatEnabled || !recordPolicy || !selectedUri || isDescribing || isLoadingRecordPolicy || recordPolicyCheckedUri !== selectedUri || currentFormattedRecordHtml || !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || describedRecordUri !== selectedUri) return;
    const requestKey = currentRecordFormatKey;
    if (activeFormatterRequestRef.current === requestKey) return;
    activeFormatterRequestRef.current = requestKey;
    void formatSelectedRecord().finally(() => {
      if (activeFormatterRequestRef.current === requestKey) activeFormatterRequestRef.current = "";
    });
  }, [recordFormatPreferenceLoaded, recordFormatEnabled, recordPolicy?.uri, selectedRecordTemplateUri, selectedUri, isDescribing, isLoadingRecordPolicy, recordPolicyCheckedUri, currentFormattedRecordHtml, recordDescriptionSnapshot, currentRecordDescriptionKey, describedRecordUri]);

  // Read service metadata from the SHACL policy graph. The formatter never
  // contains a list of APIs, and there are no service-specific branches here.
  useEffect(() => {
    const key = `${selectedUri}\u0000${currentRecordDescriptionKey}\u0000${selectedRecordTemplateUri}`;
    activeServiceRecordRef.current = key;
    setRecordServices([]);
    setRecordServiceTab("");
    setRecordServiceArguments({});
    setRecordServiceResults({});
    if (!authSession || !selectedUri || describedRecordUri !== selectedUri || isDescribing ||
        !selectedRecordTemplateUri.includes("DbpediaBookRecordTemplate") ||
        recordDescriptionSnapshot?.key !== currentRecordDescriptionKey) return;
    const recordTypes = Array.from(new Set(describedRecord.filter((item) =>
      item.direction === "property" && item.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      /^https?:\/\//i.test(item.value)).map((item) => item.value)));
    // A class constrained by the authoritative query remains valid scope
    // context if the Record SELECT was partial and omitted its rdf:type row.
    const scopeTypes = getClassesAtNode(getPropertyPath().at(-1)?.id ?? null);
    const types = Array.from(new Set([...recordTypes, ...scopeTypes]));
    if (!types.length) return;
    const controller = new AbortController();
    void maestroQueryFetch("/proxy/api/services", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-service-discover", "RecordServices") },
      body: JSON.stringify({ action: "discover", recordTypes: types }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { services?: RecordService[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Service discovery failed (${response.status}).`);
      if (!controller.signal.aborted && activeServiceRecordRef.current === key) setRecordServices(payload.services ?? []);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) console.warn("Record service discovery unavailable:", error);
    });
    return () => controller.abort();
  }, [selectedUri, currentRecordDescriptionKey, selectedRecordTemplateUri, describedRecordUri, isDescribing, authSession, recordDescriptionSnapshot?.key]);

  // The Book stylesheet owns this insertion point. Portals preserve the
  // standard React event model and do not overwrite XSLT-produced properties.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    const tabs = root?.querySelector<HTMLElement>("#book-service-tablist");
    const host = root?.querySelector<HTMLElement>("#book-services-host");
    if (!root || !tabs || !host || !currentFormattedRecordHtml) { setRecordServiceDom(null); return; }
    setRecordServiceDom((previous) => previous?.tabs === tabs && previous?.host === host ? previous : {tabs,host});
    const props = root.querySelector<HTMLElement>("#book-properties-panel");
    const propsButton = root.querySelector<HTMLButtonElement>("#book-properties-tab");
    if (props) props.hidden = Boolean(recordServiceTab);
    if (propsButton) {
      propsButton.setAttribute("aria-selected", String(!recordServiceTab));
      propsButton.classList.toggle("bg-accent", !recordServiceTab);
      propsButton.onclick = () => setRecordServiceTab("");
    }
    return () => { if (propsButton) propsButton.onclick = null; };
  }, [currentFormattedRecordHtml, recordServiceTab]);

  async function invokeRecordService(service: RecordService, operation: RecordService["operations"][number]) {
    const snapshot = recordDescriptionSnapshot;
    if (!snapshot || snapshot.uri !== selectedUri || snapshot.key !== currentRecordDescriptionKey ||
        describedRecordUri !== selectedUri) return;
    const key = `${selectedUri}\u0000${currentRecordDescriptionKey}\u0000${selectedRecordTemplateUri}`;
    const argumentsForService = recordServiceArguments[service.uri] ?? {};
    if (operation.requires.some((name) => !argumentsForService[name])) return;
    setRecordServiceResults((previous) => ({...previous,[service.uri]:{html:"",error:"",loading:true,name:operation.label}}));
    try {
      const response = await maestroQueryFetch("/proxy/api/services", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-service-execute", "RecordServiceInvocation") },
        body: JSON.stringify({action:"invoke", service:service.uri, operation:operation.uri,
          recordUri:selectedUri, queryXml, fctXml:snapshot.xml, arguments:argumentsForService}),
      });
      const result = await response.json() as {html?:string; values?:Record<string,string>; error?:string};
      if (!response.ok) throw new Error(result.error || `Service failed (${response.status}).`);
      if (activeServiceRecordRef.current !== key) return;
      if (result.values) setRecordServiceArguments((previous) => ({...previous,
        [service.uri]:{...previous[service.uri],...result.values}}));
      // Sanitize graph-authored response HTML before it reaches React's
      // dangerouslySetInnerHTML: no script, embedded resources, handlers or URLs.
      const doc = new DOMParser().parseFromString(result.html ?? "", "text/html");
      const allowed = new Set(["SECTION","DIV","SPAN","P","H3","H4","TABLE","THEAD","TBODY","TR","TH","TD","UL","LI","OL","DETAILS","SUMMARY","STRONG","EM","PRE","CODE","BR"]);
      const clean = (node: Node): void => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const element = child as HTMLElement;
          if (!allowed.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes).filter((item) => item.nodeType === Node.TEXT_NODE)); continue; }
          for (const attr of Array.from(element.attributes)) if (attr.name !== "class") element.removeAttribute(attr.name);
          clean(element);
        }
      };
      clean(doc.body);
      setRecordServiceResults((previous) => ({...previous,[service.uri]:{html:doc.body.innerHTML,error:"",loading:false,name:operation.label}}));
    } catch (error) {
      if (activeServiceRecordRef.current === key) setRecordServiceResults((previous) => ({...previous,
        [service.uri]:{html:"",error:error instanceof Error?error.message:"Service failed.",loading:false,name:operation.label}}));
    }
  }

  // Template actions are parsed as a restricted API-call grammar, then dispatched through Maestro's existing query-update API.
  useEffect(() => {
    const root = formattedRecordContainerRef.current;
    if (!root || !formattedRecordHtml) return;
    const handleTemplateAction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const carouselButton = target.closest("[data-maestro-carousel]");
      if (carouselButton) {
        event.preventDefault();
        const carousel = carouselButton.closest("#record-carousel");
        const track = carousel?.querySelector<HTMLElement>("#record-carousel-track");
        if (track) {
          const direction = carouselButton.getAttribute("data-maestro-carousel") === "previous" ? -1 : 1;
          track.scrollBy({ left: track.clientWidth * direction, behavior: "smooth" });
        }
        return;
      }
      // Record-formatter chips can request the same property navigation as
      // result-card badges, with an explicit lexical contains comparison.
      const propertyChip = target.closest("[data-maestro-filter-property]");
      if (propertyChip) {
        event.preventDefault();
        const predicate = propertyChip.getAttribute("data-maestro-filter-property") ?? "";
        const value = propertyChip.getAttribute("data-maestro-filter-value") ?? "";
        const operator = propertyChip.getAttribute("data-maestro-filter-op") === "contains" ? "contains" : "=";
        if (/^https?:\/\//.test(predicate) && value.trim()) {
          navigateResultBadge(predicate, { value, type: "literal" }, "forward", false, operator);
        }
        return;
      }
      // Explicit formatter actions always win over the default hyperdata link.
      // In particular: Bookmark's saved-query link, Movie's Year chip, custom
      // mui:action calls, carousel controls, and ordinary external links that
      // do not represent a value in this Record.
      if (target.closest("#bookmark-title-link, [mui\\:href], [data-maestro-filter-property]")) return;

      // A formatted Record has the same semantic default as a Results badge:
      // navigate to the things sharing this *predicate/value*, not to the
      // object URI itself. Derive the RDF term from the authoritative Record
      // SELECT, not from the display label, so datatypes/languages survive.
      const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
      const explicitAction = target.closest("[mui\\:action]");
      const link = explicitAction ? null : target.closest<HTMLAnchorElement>("a[href]");
      const recordUriLink = target.closest<HTMLElement>("[data-maestro-record-uri]");
      const linkedUri = recordUriLink?.getAttribute("data-maestro-record-uri")?.trim() ?? "";
      const href = link?.getAttribute("href") ?? "";
      const hrefIsResource = /^https?:\/\//i.test(href);
      // Do not hijack external actions (shopping, source links, share links).
      if (link && !recordUriLink && href !== "#" && !hrefIsResource) return;

      const candidates = describedRecord.filter((row) => row.termType !== "bnode" &&
        (row.direction === "property" || row.direction === "property-of"));
      const addr = queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`;
      const matchesFor = (text: string, explicitUri: string) => candidates.filter((row) => {
        if (explicitUri) return row.termType === "uri" && row.value === explicitUri;
        if (normalize(row.value) === text) return true;
        if (row.termType !== "uri") return false;
        const label = recordUriLabelCacheRef.current.get(`${addr}\u0000${row.value}`);
        return (label && normalize(label) === text) ||
          normalize((row.value.split(/[\/#]/).pop() ?? "").replace(/_/g, " ")) === text;
      });
      // Start with the smallest visible value element. Never treat a whole
      // paragraph/table/section as a value merely because it contains one.
      let clickedValue: Element | null = explicitAction ? null : recordUriLink || link || target;
      let matches: typeof candidates = [];
      while (clickedValue && clickedValue !== root) {
        const name = clickedValue.tagName.toLowerCase();
        // Leaf divs sometimes contain a literal directly; container divs are
        // not values and must never become click targets wholesale.
        if (["section", "article", "table", "tbody", "tr", "dl"].includes(name) ||
            (name === "div" && clickedValue.children.length > 0)) break;
        const display = normalize(clickedValue.textContent ?? "");
        const valueUri = clickedValue === recordUriLink ? linkedUri :
          clickedValue === link && hrefIsResource ? href : "";
        if (display || valueUri) matches = matchesFor(display, valueUri);
        if (matches.length) break;
        clickedValue = clickedValue.parentElement;
      }
      // When the same lexical value occurs under multiple predicates, use
      // the nearest property label where possible. Never guess an RDF relation.
      if (matches.length > 1) {
        const row = target.closest("dd, td, li");
        const labelText = normalize(row?.previousElementSibling?.textContent ??
          row?.parentElement?.querySelector("dt, th")?.textContent ?? "").toLowerCase();
        if (labelText) {
          const compact = (iri: string) => iri.split(/[\/#]/).pop()?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase() ?? "";
          const narrowed = matches.filter((candidate) =>
            labelText === normalize(toLabel(candidate.property)).toLowerCase() ||
            labelText === compact(candidate.property));
          if (narrowed.length) matches = narrowed;
        }
      }
      const unique = new Map(matches.map((row) => [
        `${row.direction}\u0000${row.property}\u0000${row.value}\u0000${row.datatype ?? ""}\u0000${row.lang ?? ""}`, row,
      ]));
      if (unique.size === 1) {
        const row = [...unique.values()][0];
        event.preventDefault();
        navigateResultBadge(row.property, {
          value: row.value, type: row.termType,
          ...(row.datatype ? { datatype: row.datatype } : {}),
          ...(row.lang ? { lang: row.lang } : {}),
        }, row.direction === "property-of" ? "reverse" : "forward",
          row.direction === "property" && row.property === RDF_TYPE_URI);
        return;
      }
      // Preserve the existing fallback for URI links not in the Record's
      // predicate/value bindings. Never replace an explicit specialized action.
      if (recordUriLink) {
        if (/^https?:\/\//i.test(linkedUri)) { event.preventDefault(); openRecordPropertyUri(linkedUri); }
        return;
      }
      const actionElement = target.closest("[mui\\:action]");
      if (!actionElement) return;
      event.preventDefault();
      const source = actionElement.getAttribute("mui:action") ?? "";
      try {
        const { method, args } = parsePolicyQueryAction(source, actionElement, selectedUri);
        const api = fctQueryTreeApi as unknown as Record<string, (...values: unknown[]) => unknown>;
        api[method](...args);
        setRecordFormatError("");
      } catch (error) {
        setRecordFormatError(error instanceof Error ? error.message : "The template action was rejected.");
      }
    };
    root.addEventListener("click", handleTemplateAction);
    return () => root.removeEventListener("click", handleTemplateAction);
  }, [formattedRecordHtml, selectedUri, describedRecord, selectedEndpointId, queryTree.attributes.addr,
      queryTree.attributes.graph, navigateResultBadge]);

  // The active scope is the property-path node that currently contains the
  // authoritative <view>; at the root, scope is represented by null.
// The active scope is the property-path node that currently contains the
// authoritative <view>; at the root, scope is represented by null.
const activePropertyPath = getPropertyPath();

const activeLeafId: string | null =
  activePropertyPath.length > 0
    ? activePropertyPath[activePropertyPath.length - 1].id
    : null;

const displayedBreadcrumbPath =
  activePropertyPath.length <= breadcrumbTrail.length &&
  activePropertyPath.every(
    (crumb, index) => crumb.id === breadcrumbTrail[index]?.id,
  )
    ? breadcrumbTrail
    : activePropertyPath;

const activeBreadcrumbIndex = activePropertyPath.length - 1;
const tutorialBreadcrumbPath = tutorialMode && facetHoverPreview?.kind === "facet" && facetHoverPreview.successorNodeId
  ? [
      ...displayedBreadcrumbPath.slice(0, activeBreadcrumbIndex + 1),
      {
        id: facetHoverPreview.successorNodeId,
        uri: facetHoverPreview.uri,
        name: facetHoverPreview.direction === "forward" ? "property" : "property-of",
      },
    ]
  : displayedBreadcrumbPath;
const tutorialBreadcrumbTargetId = tutorialMode && facetHoverPreview?.kind === "facet"
  ? facetHoverPreview.successorNodeId ?? null
  : null;
const breadcrumbPreviewPathKey = `query-root|${displayedBreadcrumbPath.map((crumb) => crumb.id).join("|")}`;
const makeBreadcrumbScopedTree = (
  targetId: string,
  // Predecessor records the badge chain has already resolved. Each is bound as a
  // <value> on its own node, so the target scope can only return values reached
  // from that exact record (R0 -p1-> R1 -p2-> R2 ...).
  pins: { nodeId: string; uri: string }[] = [],
  viewType: typeof FCT_VIEW_TYPES.TEXT | typeof FCT_VIEW_TYPES.CLASSES = FCT_VIEW_TYPES.TEXT,
): FctQueryTree | null => {
  // Metadata queries are clones of the live query. Only the active <view> is
  // moved to the target scope and normalized to one result at offset zero.
  const cloned = JSON.parse(JSON.stringify(queryTree)) as FctQueryTree;
  const existingView = findQueryNode(queryTree.children, "query-view");
  const removeViews = (nodes: FctQueryNode[]) => {
    for (const node of nodes) {
      node.children = node.children.filter((child) => child.name !== "view");
      removeViews(node.children);
    }
  };
  cloned.children = cloned.children.filter((node) => node.name !== "view");
  removeViews(cloned.children);
  const pinValue = (nodeId: string, uri: string): FctQueryNode => ({
    id: `badge-pin-${nodeId}`,
    name: "value",
    attributes: { datatype: "uri" },
    text: uri,
    children: [],
  });
  const alreadyBound = (nodes: FctQueryNode[], uri: string) =>
    nodes.some((node) => node.name === "value" && node.text === uri);
  for (const pin of pins) {
    if (pin.nodeId === "query-root") {
      if (!alreadyBound(cloned.children, pin.uri)) cloned.children.push(pinValue(pin.nodeId, pin.uri));
      continue;
    }
    const pinTarget = (nodes: FctQueryNode[]): FctQueryNode | undefined => {
      for (const node of nodes) {
        if (node.id === pin.nodeId) return node;
        const nested = pinTarget(node.children);
        if (nested) return nested;
      }
      return undefined;
    };
    const target = pinTarget(cloned.children);
    if (target && !alreadyBound(target.children, pin.uri)) target.children.push(pinValue(pin.nodeId, pin.uri));
  }
  const viewNode: FctQueryNode = {
    id: "query-view",
    name: "view",
    attributes: { ...(existingView?.attributes ?? {}), type: viewType, limit: viewType === FCT_VIEW_TYPES.CLASSES ? "30" : "1", offset: "0" },
    children: [],
  };
  const attach = (nodes: FctQueryNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === targetId) {
        node.children.push(viewNode);
        return true;
      }
      if (attach(node.children)) return true;
    }
    return false;
  };
  if (targetId === "query-root") {
    cloned.children.push(viewNode);
    return cloned;
  }
  return attach(cloned.children) ? cloned : null;
};
const metadataRegistryKey = (tree: FctQueryTree) => `${selectedEndpointId}\u0000${serializeFctQuery(tree)}`;

// When the center-pane result set finishes loading, register its first item and
// total count under the same one-result scoped query used by breadcrumb metadata.
useEffect(() => {
  const expectedLoadedIdentity = `${selectedEndpointId}\u0000${queryCountXml}\u0000${endpointReadyForQuery ? "ready" : "not-ready"}`;
  if (!endpointReadyForQuery || isSearching || isCountingResults) return;
  if (resultsLoadedQueryIdentityRef.current !== expectedLoadedIdentity) return;
  // If the center pane did not obtain a usable total, leave the registry empty
  // so the breadcrumb fallback can fetch its own count rather than caching null.
  if (effectiveResultsTotalCount === null) return;
  const activeScopeId = activeLeafId ?? "query-root";
  const scopedTree = makeBreadcrumbScopedTree(activeScopeId);
  if (!scopedTree) return;
  const first = results[0];
  // A positive COUNT with no returned text row is an incomplete example lookup,
  // not proof that the result set is empty. Let the scoped preview retry.
  if (!first && effectiveResultsTotalCount > 0) return;
  const summary: FctUiResultSummary = {
    label: first ? (first.label?.trim() || first.title?.trim() || toLabel(first.uri)) : "—",
    count: effectiveResultsTotalCount,
    ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
  };
  metadataRegistryRef.current.set(metadataRegistryKey(scopedTree), summary);
  // Bound the in-memory registry so navigating across many queries cannot grow it indefinitely.
  if (metadataRegistryRef.current.size > 300) {
    const oldestKey = metadataRegistryRef.current.keys().next().value;
    if (oldestKey) metadataRegistryRef.current.delete(oldestKey);
  }
}, [activeLeafId, effectiveResultsTotalCount, endpointReadyForQuery, isCountingResults, isSearching, queryCountXml, queryTree, results, selectedEndpointId]);

useEffect(() => {
  if (!endpointReadyForQuery) {
    setBreadcrumbPreviewSummaries({});
    setBreadcrumbPreviewPendingIds(new Set());
    return;
  }
  const controller = new AbortController();
  let cancelled = false;
  const targetCrumbs = [{ id: "query-root", uri: "" }, ...displayedBreadcrumbPath.map((crumb) => ({ id: crumb.id, uri: crumb.uri }))];
  const activeScopeId = activeLeafId ?? "query-root";
  const centerPaneIsLoading = isSearching || isCountingResults;
  const cachedSummary = (tree: FctQueryTree) => metadataRegistryRef.current.get(metadataRegistryKey(tree));
  const request = async (xml: string, component: string) => {
    const response = await cachedFetchFct("/proxy/api/fct", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("breadcrumb-preview", component) },
      body: xml,
      signal: controller.signal,
    });
    return await readFctResponse(response);
  };
  // A positive count can coexist with an empty/partial text view on a busy
  // graph server. The simpler list view supplies an independent first resource
  // for the e.g. badge without inventing an example from the count.
  const firstExample = async (tree: FctQueryTree, textData: ParsedFctResponse, component: string): Promise<FctResult | undefined> => {
    if (textData.results[0]) return textData.results[0];
    if (controller.signal.aborted) return undefined;
    try {
      const listTree = setQueryViewAttributes(tree, { type: FCT_VIEW_TYPES.LIST, limit: "1", offset: "0", order: "no" });
      const listData = await request(serializeFctQuery(listTree), `${component}:list-fallback`);
      if (listData.error) return undefined;
      return listData.results[0];
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro e.g. badge list fallback failed", { component, error });
      return undefined;
    }
  };
  const recordSummary = (first: FctResult | undefined, count: number | null): FctUiResultSummary => ({
    label: first ? (first.label?.trim() || first.title?.trim() || toLabel(first.uri)) : count !== null && count > 0 ? "Example unavailable" : "—",
    count,
    ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
  });
  /** Whole-scope first record plus result count (the same query the center pane runs). */
  const fetchScopeSummary = async (tree: FctQueryTree, crumbId: string): Promise<FctUiResultSummary | null> => {
    try {
      const countSparql = buildFctCountSparql(tree);
      const [textData, countResponse] = await Promise.all([
        request(serializeFctQuery(tree), `BreadcrumbPreview:${crumbId}:text`),
        countSparql ? cachedFetchFct("/proxy/api/sparql", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("breadcrumb-preview-count", `BreadcrumbPreview:${crumbId}:count`) },
          body: JSON.stringify({ facetValueCount: { sparql: countSparql } }),
          signal: controller.signal,
        }) : Promise.resolve(null),
      ]);
      let count: number | null = null;
      if (countResponse?.ok) {
        const countPayload = await countResponse.json() as { count?: unknown };
        const parsedCount = Number(countPayload.count);
        if (Number.isSafeInteger(parsedCount) && parsedCount >= 0) count = parsedCount;
      }
      const first = count !== 0
        ? await firstExample(tree, textData, `BreadcrumbPreview:${crumbId}`)
        : textData.results[0];
      const summary = recordSummary(first, count);
      if (first || count === 0) metadataRegistryRef.current.set(metadataRegistryKey(tree), summary);
      return summary;
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro breadcrumb preview lookup failed", { crumb: crumbId, error });
      return null;
    }
  };
  /** First record only, for a scope whose predecessors are pinned to specific records. */
  const fetchChainRecord = async (tree: FctQueryTree, crumbId: string): Promise<FctUiResultSummary | null> => {
    try {
      const textData = await request(serializeFctQuery(tree), `BreadcrumbPreview:${crumbId}:chain`);
      const first = await firstExample(tree, textData, `BreadcrumbPreview:${crumbId}:chain`);
      const summary = recordSummary(first, null);
      if (first) metadataRegistryRef.current.set(metadataRegistryKey(tree), summary);
      return summary;
    } catch (error) {
      if (!controller.signal.aborted) console.info("Maestro breadcrumb chain lookup failed", { crumb: crumbId, error });
      return null;
    }
  };

  // Walk the breadcrumb left to right so every label comes from ONE record path:
  // the root badge shows record R0, and each next badge shows the first value of
  // that crumb's property (or property-of) on the previous badge's record. The ct
  // stays the size of the whole result set at that node. With fetchMissing=false
  // this only reads caches and never awaits, so it completes synchronously.
  const walkChain = async (fetchMissing: boolean, onStep?: (id: string, summary: FctUiResultSummary) => void) => {
    const resolved: Record<string, FctUiResultSummary> = {};
    if (breadcrumbBadgeMode === "classes") {
      for (let index = 0; index < targetCrumbs.length; index += 1) {
        const crumb = targetCrumbs[index];
        const scopeTree = makeBreadcrumbScopedTree(crumb.id, [], FCT_VIEW_TYPES.CLASSES);
        if (!scopeTree) continue;
        let scope = cachedSummary(scopeTree);
        if (!scope && fetchMissing) {
          try {
            const data = await request(serializeFctQuery(scopeTree), `BreadcrumbPreview:${crumb.id}:classes`);
            if (data.error) throw new Error(data.error);
            if (data.classes && data.classes.length > 0) {
              const firstClass = data.classes[0];
              scope = {
                label: firstClass.label || toLabel(firstClass.uri),
                count: firstClass.count,
                zeroClasses: false,
                uri: firstClass.uri,
                termType: "uri",
              };
            } else {
              scope = {
                label: "No category",
                count: 0,
                zeroClasses: true,
              };
            }
            metadataRegistryRef.current.set(metadataRegistryKey(scopeTree), scope);
          } catch (error) {
            if (!controller.signal.aborted) console.info("Maestro breadcrumb preview classes lookup failed", { crumb: crumb.id, error });
          }
        }
        if (cancelled || controller.signal.aborted) return resolved;
        if (scope) {
          resolved[crumb.id] = scope;
          onStep?.(crumb.id, scope);
        }
      }
      return resolved;
    }

    // undefined = not known yet, null = no usable record (empty set / not a resource).
    const records: Array<FctUiResultSummary | null | undefined> = [];
    for (let index = 0; index < targetCrumbs.length; index += 1) {
      const crumb = targetCrumbs[index];
      const scopeTree = makeBreadcrumbScopedTree(crumb.id);
      if (!scopeTree) { records[index] = undefined; continue; }
      let scope = cachedSummary(scopeTree);
      if (!scope && fetchMissing && !(crumb.id === activeScopeId && centerPaneIsLoading)) {
        // The center pane registers its own scope; don't race it with a duplicate request.
        scope = (await fetchScopeSummary(scopeTree, crumb.id)) ?? undefined;
      }
      if (cancelled || controller.signal.aborted) return resolved;

      if (index === 0) {
        records[0] = scope ?? undefined;
        if (scope) { resolved[crumb.id] = scope; onStep?.(crumb.id, scope); }
        continue;
      }
      const previous = records[index - 1];
      if (previous === undefined) { records[index] = undefined; continue; }
	  /*
      if (previous === null || previous.termType !== "uri" || !previous.uri) {
        // A literal or empty set has no properties to follow.
        records[index] = null;
        resolved[crumb.id] = { label: "—", count: scope?.count ?? null };
        onStep?.(crumb.id, resolved[crumb.id]);
        continue;
      }*/
	  if (previous === null || previous.termType !== "uri" || !previous.uri) {
  // The previous result cannot be used to follow this path.
  // Still display the first result from this crumb's own result set.
  records[index] = null;

  resolved[crumb.id] = scope?.uri
    ? scope
    : { label: "—", count: scope?.count ?? null };

  onStep?.(crumb.id, resolved[crumb.id]);
  continue;
}
      const pins: { nodeId: string; uri: string }[] = [];
      for (let earlier = 0; earlier < index; earlier += 1) {
        const record = records[earlier];
        if (record?.uri) pins.push({ nodeId: targetCrumbs[earlier].id, uri: record.uri });
      }
      const chainTree = makeBreadcrumbScopedTree(crumb.id, pins);
      if (!chainTree) { records[index] = undefined; continue; }
      let chained = cachedSummary(chainTree);
      if (!chained && fetchMissing) chained = (await fetchChainRecord(chainTree, crumb.id)) ?? undefined;
      if (cancelled || controller.signal.aborted) return resolved;
      if (!chained) { records[index] = undefined; continue; }
      records[index] = chained.uri ? chained : null;
      resolved[crumb.id] = { label: chained.label, count: scope?.count ?? null, ...(chained.uri ? { uri: chained.uri, termType: chained.termType } : {}) };
      onStep?.(crumb.id, resolved[crumb.id]);
    }
    return resolved;
  };

  // Show whatever the caches already resolve; only the rest is "Loading…".
  // With fetchMissing=false walkChain never reaches an await, so this callback
  // fills syncResolved synchronously, before the lines below read it.
  const syncResolved: Record<string, FctUiResultSummary> = {};
  void walkChain(false, (id, summary) => { syncResolved[id] = summary; });
  setBreadcrumbPreviewSummaries((current) => ({ ...current, ...syncResolved }));
  setBreadcrumbPreviewPendingIds(new Set(targetCrumbs.filter((crumb) => !syncResolved[crumb.id]).map((crumb) => crumb.id)));

  const timer = window.setTimeout(() => {
    void walkChain(true, (id, summary) => {
      if (cancelled || controller.signal.aborted) return;
      setBreadcrumbPreviewSummaries((current) => ({ ...current, [id]: summary }));
      setBreadcrumbPreviewPendingIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }).then((resolved) => {
      if (cancelled || controller.signal.aborted) return;
      // Drop summaries for crumbs that no longer exist or could not be resolved.
      setBreadcrumbPreviewSummaries(resolved);
      setBreadcrumbPreviewPendingIds(new Set(centerPaneIsLoading && !resolved[activeScopeId] ? [activeScopeId] : []));
    });
  }, 120);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    controller.abort();
  };
}, [activeLeafId, breadcrumbPreviewPathKey, effectiveResultsTotalCount, isCountingResults, isSearching, queryRevision, queryTree, results, selectedEndpointId, endpointReadyForQuery, breadcrumbBadgeMode]);

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
  // Keep query-selected Categories visible even if the classes endpoint omits
  // them from its current candidate list. Only current-scope <class> nodes are
  // considered; classes from another query-tree branch are deliberately ignored.
  const classDisplayFacets = [
    ...Array.from(selectedClasses)
      .filter((uri) => !classFacets.some((item) => item.uri === uri))
      .map((uri) => ({ uri, label: uri, count: 0 })),
    ...classFacets,
  ];
  // The classes FCT view returns each class and its grouped count together.
  // Do not run a per-class DistinctCount or remove classes on later count updates.
  const visibleClassDisplayFacets = classDisplayFacets;
  // Like Properties and Roles, Categories puts query-selected terms in a
  // dedicated pane above the paged list, so selected items do not appear twice.
  const selectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => selectedClasses.has(item.uri));
  const unselectedClassDisplayFacets = visibleClassDisplayFacets.filter((item) => !selectedClasses.has(item.uri));
  const categoryMetadataUrisKey = classDisplayFacets.map((item) => item.uri).sort().join("\n");
  useEffect(() => {
    if (!authSession) return;
    if (!categoryMetadataUrisKey) return;
    const controller = new AbortController();
    const uris = categoryMetadataUrisKey.split("\n").filter(Boolean);
    const batches: string[][] = [];
    for (let offset = 0; offset < uris.length; offset += 100) batches.push(uris.slice(offset, offset + 100));
    void (async () => {
      const discovered: OntologyClassMetadata[] = [];
      for (const batch of batches) {
        if (controller.signal.aborted) return;
        const response = await fetch("/proxy/api/ontology", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: batch }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Ontology discovery/ingestion returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        const payload = await response.json() as { items?: OntologyClassMetadata[] };
        discovered.push(...(payload.items ?? []));
      }
      if (controller.signal.aborted) return;
      setOntologyClassMetadata((current) => {
        const next = { ...current };
        for (const item of discovered) if (item?.uri && item.ontology) next[item.uri] = item;
        return next;
      });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.info("Maestro category ontology discovery or ingestion was incomplete; inspect the /proxy/api/ontology response and personal SPARQL store.", error);
    });
    return () => controller.abort();
  }, [categoryMetadataUrisKey, authSession]);
  useEffect(() => {
    if (!authSession) { setPersonalSparqlEndpoint(""); return; }
    const controller = new AbortController();
    void fetch("/proxy/api/ontology", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Personal SPARQL endpoint lookup returned HTTP ${response.status}.`);
        return await response.json() as { endpoint?: string };
      })
      .then((payload) => { if (!controller.signal.aborted) setPersonalSparqlEndpoint(payload.endpoint ?? ""); })
      .catch((error: unknown) => { if (!controller.signal.aborted) console.info("Could not read the personal SPARQL endpoint configuration.", error); });
    return () => controller.abort();
  }, [authSession]);

  const pagedUnselectedClasses = unselectedClassDisplayFacets.slice(classesPage * FACET_PAGE_SIZE, (classesPage + 1) * FACET_PAGE_SIZE);
  const categoryTreeItems = categoriesTreeMode ? unselectedClassDisplayFacets : pagedUnselectedClasses;
  const categoryTreeRoots: CategoryTreeNode[] = (() => {
    // The hierarchy comes from the query itself (rdfs:subClassOf edges of the result-set classes up to the
    // root). A class with several parents is listed under each of them, with its own subtree repeated.
    const itemByUri = new Map(categoryTreeItems.map((item) => [item.uri, item]));
    const parentsOf = new Map<string, Set<string>>();
    for (const edge of classTreeEdges) {
      if (edge.uri === edge.parent || !itemByUri.has(edge.uri) || !itemByUri.has(edge.parent)) continue;
      (parentsOf.get(edge.uri) ?? parentsOf.set(edge.uri, new Set()).get(edge.uri)!).add(edge.parent);
    }
    // Where the query returned no subclass edge, fall back to the ontology store's recorded parent.
    for (const item of categoryTreeItems) {
      if (parentsOf.has(item.uri)) continue;
      const fallback = ontologyClassMetadata[item.uri]?.parent;
      if (fallback && fallback !== item.uri && itemByUri.has(fallback)) parentsOf.set(item.uri, new Set([fallback]));
    }
    const childrenOf = new Map<string, string[]>();
    for (const [uri, parents] of parentsOf) for (const parent of parents) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(uri);
    const byLabel = (a: CategoryTreeNode, b: CategoryTreeNode) => toLabel(a.item.uri).localeCompare(toLabel(b.item.uri));
    // Repeating a multi-parent subtree can grow quickly; bound the total rendered nodes.
    let budget = 2000;
    const build = (uri: string, path: ReadonlySet<string>): CategoryTreeNode => {
      budget -= 1;
      const nextPath = new Set(path).add(uri);
      // Skipping ancestors on the current path breaks subclass cycles in malformed ontologies.
      const children = budget > 0 ? (childrenOf.get(uri) ?? []).filter((child) => !nextPath.has(child)).map((child) => build(child, nextPath)) : [];
      children.sort(byLabel);
      return { item: itemByUri.get(uri)!, children };
    };
    const roots = categoryTreeItems.filter((item) => !parentsOf.has(item.uri)).map((item) => build(item.uri, new Set()));
    // Classes that only occur inside a subclass cycle have no root; surface them rather than hiding them.
    const reachable = new Set<string>();
    const collect = (node: CategoryTreeNode) => { reachable.add(node.item.uri); node.children.forEach(collect); };
    roots.forEach(collect);
    for (const item of categoryTreeItems) {
      if (reachable.has(item.uri)) continue;
      const node = build(item.uri, new Set());
      collect(node);
      roots.push(node);
    }
    roots.sort(byLabel);
    return roots;
  })();
  const categoryTreePages = categoriesTreeMode ? paginateCategoryTree(categoryTreeRoots) : [];
  const categoryTreeParentKeys = categoriesTreeMode ? collectCategoryTreeParentKeys(categoryTreeRoots) : [];
  const categoryTreeAllCollapsed = categoryTreeParentKeys.length > 0 && categoryTreeParentKeys.every((key) => !expandedCategoryNodes.has(key));
  const categoryPageCount = categoriesTreeMode
    ? Math.max(1, categoryTreePages.length)
    : Math.max(1, Math.ceil(unselectedClassDisplayFacets.length / FACET_PAGE_SIZE));
  useEffect(() => {
    setClassesPage((current) => Math.min(current, categoryPageCount - 1));
  }, [categoryPageCount]);
  const autoConfigureFacetCount =
    facetAutofillCandidates.property.filter((uri) => uri !== RDF_TYPE_URI && !selectedProperties.has(uri)).length +
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
    setFacetAutofillCandidates((current) =>
      current.property.length === candidates.length &&
      current.property.every((uri, index) => uri === candidates[index])
        ? current
        : { ...current, property: candidates },
    );
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
    setFacetAutofillCandidates((current) =>
      current["property-in"].length === candidates.length &&
      current["property-in"].every((uri, index) => uri === candidates[index])
        ? current
        : { ...current, "property-in": candidates },
    );
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

  /**
   * Finds a node to highlight for a tutorial preview. Unlike path navigation,
   * this may return an ordinary relationship filter when no path node exists.
   */
  function findRelationshipPreviewNode(
    uri: string,
    direction: RelationshipDirection,
  ): FctQueryNode | null {
    const pathNode = findRelationshipPathNode(uri, direction);
    if (pathNode) return pathNode;
    const tag = direction === "forward" ? "property" : "property-of";
    function visit(nodes: FctQueryNode[]): FctQueryNode | null {
      for (const node of nodes) {
        if (node.name === tag && node.attributes.iri === uri) return node;
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

  function setAutoConfiguredFacet(kind: "property" | "property-in", uri: string, enabled: boolean) {
    const key = `${kind}::${uri}`;
    let next = new Set(autoConfiguredFacetKeys);
    try {
      const raw = window.localStorage.getItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) next = new Set(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      // Fall back to this session's state when browser storage is unavailable.
    }
    if (enabled) next.add(key);
    else next.delete(key);
    setAutoConfiguredFacetKeys(next);
    try {
      window.localStorage.setItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // The UI marker is still useful for this session if storage is unavailable.
    }
  }

  // Add every pending Auto-configure candidate. A facet whose registry exclude
  // boolean is true is written to the live query with exclude="yes".
  function runAutoConfigure() {
    const activePath = getPropertyPath();
    const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
    for (const uri of facetAutofillCandidates.property) {
      if (uri === RDF_TYPE_URI || selectedProperties.has(uri)) continue;
      const excluded = isFacetExcludeRecorded("property", uri);
      handlePropertyCheckboxChange(uri, true, false);
      setAutoConfiguredFacet("property", uri, true);
      if (excluded) setNodeAttribute(`property-filter-${encodeURIComponent(uri)}`, "exclude", "yes");
    }
    for (const uri of facetAutofillCandidates["property-in"]) {
      if (selectedRoles.has(uri)) continue;
      const excluded = isFacetExcludeRecorded("property-in", uri);
      handleRoleCheckboxChange(uri, true, false);
      setAutoConfiguredFacet("property-in", uri, true);
      if (excluded) setNodeAttribute(`role-filter-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, "exclude", "yes");
    }
  }

  // Single source of truth for both checkbox changes and property-label clicks.
  function handlePropertyCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    // rdf:type may still be needed in the authoritative query for Result Badges
    // and Group By Category, but must never create a Personal facet widget.
    if (uri === RDF_TYPE_URI && checked) {
      addProperty(activeLeafId, uri);
      return;
    }
    if (trackUsage) setAutoConfiguredFacet("property", uri, false);
    if (checked) {
      addProperty(activeLeafId, uri);
      const facet = propertyFacets.find((item) => item.uri === uri);
      setPersonalWidgets((current) =>
        current.some((widget) => widget.uri === uri)
          ? current
          : [
              ...current,
              {
                uri,
                label: toLabel(uri, "Property"),
                excluded: false,
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

  function handleFacetShiftClick(
    group: "Properties" | "Classes" | "Roles",
    uri: string,
    currentlySelected: boolean,
  ) {
    const activePath = getPropertyPath();
    const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
    const findNode = (nodes: FctQueryNode[], id: string): FctQueryNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const nested = findNode(node.children, id);
        if (nested) return nested;
      }
      return null;
    };
    const scopeParent = scopeParentId ? findNode(queryTree.children, scopeParentId) : null;
    const scopeNodes = scopeParent ? scopeParent.children : queryTree.children;
    const nodeName = group === "Properties" ? "property" : group === "Roles" ? "property-of" : "class";
    let facetNode = scopeNodes.find((node) =>
      node.name === nodeName && node.attributes.iri === uri &&
      (group !== "Properties" || node.id.startsWith("property-filter-")) &&
      (group !== "Roles" || node.id.startsWith("role-filter-")),
    );

    if (currentlySelected && facetNode) {
      setNodeAttribute(facetNode.id, "exclude", facetNode.attributes.exclude === "yes" ? null : "yes");
      return;
    }

    if (group === "Properties") {
      handlePropertyCheckboxChange(uri, true);
      facetNode = { id: `property-filter-${encodeURIComponent(uri)}`, name: "property", attributes: { iri: uri }, children: [] };
    } else if (group === "Classes") {
      toggleClass(uri, true);
      facetNode = { id: `class-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, name: "class", attributes: { iri: uri }, children: [] };
    } else {
      handleRoleCheckboxChange(uri, true);
      facetNode = { id: `role-filter-${scopeParentId ? `${encodeURIComponent(scopeParentId)}-` : "root-"}${encodeURIComponent(uri)}`, name: "property-of", attributes: { iri: uri }, children: [] };
    }
    setNodeAttribute(facetNode.id, "exclude", "yes");
  }

  function isFacetExcluded(group: "Properties" | "Classes" | "Roles", uri: string): boolean {
    const activePath = getPropertyPath();
    const scopeParentId = activePath[activePath.length - 1]?.id ?? null;
    const findNode = (nodes: FctQueryNode[], id: string): FctQueryNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const nested = findNode(node.children, id);
        if (nested) return nested;
      }
      return null;
    };
    const scopeParent = scopeParentId ? findNode(queryTree.children, scopeParentId) : null;
    const nodeName = group === "Properties" ? "property" : group === "Roles" ? "property-of" : "class";
    return (scopeParent ? scopeParent.children : queryTree.children).some((node) =>
      node.name === nodeName && node.attributes.iri === uri && node.attributes.exclude === "yes" &&
      (group !== "Properties" || node.id.startsWith("property-filter-")) &&
      (group !== "Roles" || node.id.startsWith("role-filter-")),
    );
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

  // `addr` is graphURI@graphserverURI. Only the user's graph-server
  // selection may change the latter. A first-use default or old ID is
  // normalized once when the login-time endpoint registry is available.
  useEffect(() => {
    const endpoint = fctEndpoints.find((item) => item.id === selectedEndpointId);
    if (!endpoint) return;
    const address = queryTree.attributes.addr ?? "";
    const separator = address.indexOf("@");
    // A missing graph attribute means no graph binding. Never recover an old
    // graphsite from addr after the user has explicitly cleared the field.
    const graph = queryTree.attributes.graph?.trim() ?? "";
    const server = separator >= 0 ? address.slice(separator + 1) : "";
    const resolved = fctEndpoints.find((item) => item.url === server);
    // Never rewrite a saved URI that points to a different graph server.
    if (server && !resolved && server !== endpoint.id) return;
    const normalized = `${graph}@${resolved?.url ?? endpoint.url}`;
    if (address !== normalized) setQueryAttribute("addr", normalized);
  }, [selectedEndpointId, fctEndpoints, queryTree.attributes.addr, queryTree.attributes.graph]);

  function bindGraph(uri: string) {
    setGraphText(uri);
    recordGraphNavigation(uri);
    setQueryAttribute("graph", uri);
    clearTutorialPreview();
  }

  function startHistoryActionHover(direction: "backward" | "forward") {
    if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current);
    historyHoverTimerRef.current = setTimeout(() => {
      setHistoryActionMenu(direction);
      setHistoryActionItems([]);
      void fetch("/proxy/api/query-favorites", {
        method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history-actions", "HistoryActionMenu") },
        // Radiate from the loaded History item: earlier items for Back, later items for Forward.
        body: JSON.stringify({ action: "recentActions", direction, historyId: historyVisitQueryRef.current === queryXml ? (historyVisitIdRef.current || historyBookmarkId || undefined) : (historyBookmarkId || undefined) }), cache: "no-store",
      }).then(async (response) => {
        const payload = await response.json() as { items?: Array<{ historyId: string; created: string; action: { operator: "+" | "-"; xpath: string; value?: string } | null }> };
        if (response.ok && Array.isArray(payload.items)) setHistoryActionItems(payload.items);
      }).catch((error) => console.info("Could not load recent History actions", error));
    }, 1500);
  }

  function stopHistoryActionHover() {
    if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current);
    historyHoverTimerRef.current = setTimeout(() => setHistoryActionMenu(null), 250);
  }

  async function restoreHistoryActionItem(historyId: string) {
    try {
      const response = await fetch("/proxy/api/query-favorites", { method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history-actions", "RestoreHistoryAction") }, body: JSON.stringify({ action: "getHistoryItem", historyId }), cache: "no-store" });
      const payload = await response.json() as { found?: boolean; queryXml?: string; stateUrl?: string; error?: string };
      if (!response.ok || !payload.found || !payload.queryXml) throw new Error(payload.error ?? "Could not load this History item.");
      const tree = parseFctQueryXml(payload.queryXml);
      if (!tree) throw new Error("The selected History item contains invalid FCT query XML.");
      const serverId = readGraphServerFromQueryXml(payload.queryXml);
      if (!serverId) throw new Error("The History item does not identify a graph server in addr.");
      // Destination selection must complete before the live query is published.
      await synchronizeFctEndpointSelection(serverId);
      const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
      const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
      historyVisitQueryRef.current = serializeFctQuery(tree);
      historyVisitIdRef.current = historyId;
      pendingHistoryVisitRef.current = null;
      setRootSearchExpanded(false);
      restoreQueryAndUiState(payload.queryXml, restoredUiState, historyId);
      setHistoryBookmarkId(historyId);
      const params = new URLSearchParams(window.location.search);
      params.set("q", payload.queryXml); params.set("history", historyId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      setHistoryActionMenu(null);
    } catch (error) {
      toast.add({ title: "Could not restore History item", description: error instanceof Error ? error.message : "The History item could not be restored.", type: "error" });
    }
  }

  function formatHistoryAction(action: { operator: "+" | "-"; xpath: string; value?: string } | null, direction: "backward" | "forward") {
    if (!action) return "Query state changed";
    const operator = direction === "backward" ? (action.operator === "+" ? "−" : "+") : action.operator;
    return `${operator} ${action.xpath}${operator === "+" && action.value ? ` = ${action.value}` : ""}`;
  }

  async function navigateQueryHistory(direction: "backward" | "forward") {
    if (historyNavigationPending !== null) return;
    setHistoryNavigationPending(direction);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-maestro-debug-component": direction === "backward" ? "HistoryBackButton" : "HistoryForwardButton",
        },
        body: JSON.stringify({ action: "navigate", direction, historyId: historyBookmarkId }), cache: "no-store",
      });
      const payload = await response.json() as { found?: boolean; stateUrl?: string; queryXml?: string; historyId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      if (!payload.found) {
        toast.add({ title: `No ${direction === "backward" ? "earlier" : "later"} query in History`, type: "info" });
        return;
      }
      if (!payload.queryXml || !payload.historyId) {
        throw new Error("The selected History item does not contain a saved query.");
      }

      // stateUrl is RDF-stored metadata, not a navigation target. Read its
      // serialized UI state, but apply the query XML returned by the RDF result
      // set as the authoritative query. The shared restore function updates the
      // query store and all related UI state without reloading the page.
      const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
      const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
      const restoredTree = parseFctQueryXml(payload.queryXml);
      if (!restoredTree) throw new Error("The selected History item contains invalid FCT query XML.");
      const graphServerId = readGraphServerFromQueryXml(payload.queryXml);
      if (!graphServerId) throw new Error("The History item does not identify a graph server in addr.");
      await synchronizeFctEndpointSelection(graphServerId);

      historyVisitQueryRef.current = serializeFctQuery(restoredTree);
      historyVisitIdRef.current = payload.historyId;
      pendingHistoryVisitRef.current = null;
      setRootSearchExpanded(false);
      restoreQueryAndUiState(payload.queryXml, restoredUiState, payload.historyId);

      // Keep the current browser URL synchronized without navigating. The URL
      // remains a reflection of app state; it is not the source used to restore it.
      const params = new URLSearchParams(window.location.search);
      params.set("q", payload.queryXml);
      params.set("history", payload.historyId);
      if (savedUrl?.searchParams.has("state")) params.set("state", savedUrl.searchParams.get("state")!);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not navigate query History.";
      toast.add({ title: "Could not navigate query History", description: message, type: "error" });
    } finally {
      setHistoryNavigationPending(null);
    }
  }

  async function loadHistoryQuery(includeFavorites = false) {
    if (isLoadingHistoryQuery) return;
    setIsLoadingHistoryQuery(true);
    try {
      // Use the server-resolved SITE_HISTORY graph rather than duplicating its
      // default in client code, so .env.local remains authoritative.
      const response = await fetch("/proxy/api/query-favorites/config", { cache: "no-store" });
      const payload = await response.json() as { historyGraph?: string; personalEndpointUrl?: string; error?: string };
      if (!response.ok || !payload.historyGraph || !payload.personalEndpointUrl) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      // History and Bookmarks live in the personal SPARQL store, so opening either
      // view selects the personal graph server in the toolbar (and the proxy cookie).
      // The addr-sync effect rewrites the query's addr from the selected server, so
      // leaving the previous server selected would silently redirect this query.
      const normalizeEndpointUrl = (value: string) => {
        const url = new URL(value);
        url.hash = "";
        url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
        return url.toString().replace(/\/$/u, "");
      };
      const personalEndpoint = fctEndpoints.find((endpoint) => {
        try {
          return normalizeEndpointUrl(endpoint.url) === normalizeEndpointUrl(payload.personalEndpointUrl!);
        } catch {
          return false;
        }
      });
      if (!personalEndpoint) {
        throw new Error(`The personal SPARQL endpoint (${payload.personalEndpointUrl}) is not present in the Graphs graph.`);
      }
      // Build the History query as a complete FCT query, then pass it through
      // the same restore path used by URL state. That path updates the live
      // query store through its API, notifying the query tree, breadcrumbs,
      // facets, results, and URL-state listeners together.
      // Health-checks the personal server, selects it, and throws if it is offline.
      await synchronizeFctEndpointSelection(personalEndpoint.url);
      const baseHistoryGraph = payload.historyGraph.replace(/#.*$/, "");
      const graphIri = `${baseHistoryGraph}#${includeFavorites ? "bookmarks" : "history"}`;
      const addrAttr = `${graphIri}@${personalEndpoint.url}`;
      const classIri = includeFavorites
        ? "http://www.w3.org/2002/01/bookmark#Bookmark"
        : "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit";

      const historyTree: FctQueryTree = {
        ...queryTree,
        attributes: {
          ...queryTree.attributes,
          graph: graphIri,
          addr: addrAttr,
          ...(orderResults ? { order: "yes" } : {}),
        },
        children: [
          { id: "history-bookmark-class", name: "class", attributes: { iri: classIri }, children: [] },
          ...(includeFavorites ? [{
            id: "favorites-hash-property",
            name: "property",
            attributes: { iri: "https://schema.org/identifier" },
            children: [],
          }] : []),
          { id: "query-view", name: "view", attributes: { type: FCT_VIEW_TYPES.TEXT, limit: "30", offset: "0" }, children: [] },
        ],
      };
      const historyQueryXml = serializeFctQuery(historyTree);
      if (!restoreQueryAndUiState(historyQueryXml, null)) {
        throw new Error("Could not restore the generated History query.");
      }

      setSearchDraft("");
      setSavedSearchDraft("");
      setGroupByPropertyUri("");
      setCentralTab("results");
      setControlsSheetOpen(false);
      toast.add({
        title: includeFavorites ? "Bookmarks loaded" : "History loaded",
        description: includeFavorites
          ? "Showing bookmarked records with a hash identifier from your personal graph server."
          : "Showing Query History Visit records from your personal graph server.",
        type: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load query History.";
      toast.add({ title: "Could not load query History", description: message, type: "error" });
    } finally {
      setIsLoadingHistoryQuery(false);
    }
  }

  async function deleteCurrentQueryHistory() {
    if (isDeletingCurrentHistory || !historyBookmarkId) return;
    setIsDeletingCurrentHistory(true);
    try {
      await historyWriteQueueRef.current;
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history", "DeleteCurrentHistory") },
        body: JSON.stringify({ action: "deleteCurrentHistory", historyId: historyBookmarkId }),
        cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; nextHistoryId?: string; queryXml?: string; stateUrl?: string; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      historyVisitQueryRef.current = "";
      historyVisitIdRef.current = "";
      pendingHistoryVisitRef.current = null;
      if (payload.nextHistoryId && payload.queryXml) {
        const savedUrl = payload.stateUrl ? new URL(payload.stateUrl, window.location.href) : null;
        const restoredTree = parseFctQueryXml(payload.queryXml);
        if (!restoredTree) throw new Error("The next earlier History item contains invalid FCT query XML.");
        historyVisitQueryRef.current = serializeFctQuery(restoredTree);
        historyVisitIdRef.current = payload.nextHistoryId;
        const restoredUiState = savedUrl ? readShareableUiState(savedUrl.search) : null;
        restoreQueryAndUiState(payload.queryXml, restoredUiState, payload.nextHistoryId);
        const params = new URLSearchParams(window.location.search);
        params.set("q", payload.queryXml);
        params.set("history", payload.nextHistoryId);
        if (savedUrl?.searchParams.has("state")) params.set("state", savedUrl.searchParams.get("state")!);
        else params.delete("state");
        window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      } else {
        setHistoryBookmarkId("");
      }
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "History item deleted", description: payload.nextHistoryId ? "Restored the next earlier History item." : "The current History item was deleted; no earlier item remains.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete History item", description: error instanceof Error ? error.message : "The History item could not be deleted.", type: "error" });
    } finally {
      setIsDeletingCurrentHistory(false);
    }
  }

  const [isExportingBookmarks, setIsExportingBookmarks] = useState(false);
  const [isImportingBookmarks, setIsImportingBookmarks] = useState(false);
  const bookmarkImportFileRef = useRef<HTMLInputElement | null>(null);

  async function exportBookmarks() {
    if (isExportingBookmarks) return;
    setIsExportingBookmarks(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "ExportBookmarks") },
        body: JSON.stringify({ action: "exportBookmarks" }),
      });
      const payload = await response.json() as { format?: string; error?: string; triples?: unknown[] };
      if (!response.ok || !Array.isArray(payload.triples)) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `maestro-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally { URL.revokeObjectURL(url); }
      toast.add({ title: "Bookmarks exported", description: `${payload.triples.length} RDF triples exported.`, type: "success" });
    } catch (error) {
      toast.add({ title: "Could not export Bookmarks", description: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setIsExportingBookmarks(false); }
  }

  async function importBookmarks(file: File) {
    if (isImportingBookmarks) return;
    setIsImportingBookmarks(true);
    try {
      if (file.size > 4_000_000) throw new Error("Bookmark import files must be smaller than 4 MB.");
      const imported = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "ImportBookmarks") },
        body: JSON.stringify({ action: "importBookmarks", archive: imported }),
      });
      const payload = await response.json() as { imported?: number; error?: string };
      if (!response.ok || typeof payload.imported !== "number") throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "Bookmarks imported", description: `${payload.imported} RDF triples imported into your personal Bookmarks graph.`, type: "success" });
    } catch (error) {
      toast.add({ title: "Could not import Bookmarks", description: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setIsImportingBookmarks(false); }
  }

  async function deleteBookmarks() {
    if (isDeletingHistory) return;
    setIsDeletingHistory(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST", headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "DeleteBookmarks") },
        body: JSON.stringify({ action: "deleteBookmarks" }), cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setBookmarkCheckRevision((revision) => revision + 1);
      toast.add({ title: "Bookmarks deleted", description: "Bookmark records were deleted. Ordinary History visits were preserved.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete Bookmarks", description: error instanceof Error ? error.message : "The Bookmark records could not be deleted.", type: "error" });
    } finally { setIsDeletingHistory(false); }
  }

  async function deleteQueryHistory() {
    if (isDeletingHistory) return;
    setIsDeletingHistory(true);
    try {
      const response = await fetch("/proxy/api/query-favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-history", "DeleteHistory") },
        body: JSON.stringify({ action: "deleteHistory" }),
        cache: "no-store",
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? `HTTP ${response.status}`);
      historyVisitQueryRef.current = "";
      historyVisitIdRef.current = "";
      pendingHistoryVisitRef.current = null;
      setHistoryBookmarkId("");
      const params = new URLSearchParams(window.location.search);
      params.delete("history");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
      setHistoryHasOlder(false);
      setHistoryHasNewer(false);
      setHistoryNavigationPending(null);
      setDeleteHistoryDialogOpen(false);
      toast.add({ title: "History deleted", description: "Query History visits were removed from your RDF store. Saved bookmarks were preserved.", type: "success" });
    } catch (error) {
      toast.add({ title: "Could not delete History", description: error instanceof Error ? error.message : "The History records could not be deleted.", type: "error" });
    } finally {
      setIsDeletingHistory(false);
    }
  }

  function navigateGraphHistory(nextIndex: number) {
    const graph = graphNavigationHistory[nextIndex];
    if (graph === undefined) return;
    setGraphNavigationIndex(nextIndex);
    setGraphText(graph);
    setQueryAttribute("graph", graph || null);
    clearTutorialPreview();
  }

  function recordGraphNavigation(graph: string) {
    const prefix = graphNavigationHistory.slice(0, graphNavigationIndex + 1);
    if (prefix[prefix.length - 1] === graph) {
      setGraphNavigationHistory(prefix);
      return;
    }
    const next = [...prefix, graph];
    setGraphNavigationHistory(next);
    setGraphNavigationIndex(next.length - 1);
  }

  async function openGraphInfo() {
    const graph = graphText.trim();
    const requestId = ++graphInfoRequestRef.current;
    const isCurrent = () => graphInfoRequestRef.current === requestId;
    setGraphInfoOpen(true);
    const validIri = /^https?:\/\/[^\s<>"{}|\\^`]+$/i.test(graph);
    if (!validIri) {
      setGraphInfo({ graph, subjectCount: null, subjectCountLoading: false, subjectCountError: graph ? "Not a valid graph IRI." : "Enter a graph URI first.", access: null, accessLoading: false, accessError: "" });
      return;
    }
    setGraphInfo({ graph, subjectCount: null, subjectCountLoading: true, subjectCountError: "", access: null, accessLoading: true, accessError: "" });

    const loadCount = async () => {
      try {
        const sparql = `SELECT (COUNT(DISTINCT ?s) AS ?ct) WHERE { GRAPH <${graph}> { ?s ?p ?o } }`;
        const response = await fetch("/proxy/api/sparql", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-info-count", "GraphInfo:count") },
          body: JSON.stringify({ facetValueCount: { sparql } }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || typeof data.count !== "number") throw new Error(data.error ?? `Subject count failed (HTTP ${response.status}).`);
        if (isCurrent()) setGraphInfo((current) => ({ ...current, subjectCount: data.count, subjectCountLoading: false }));
      } catch (error) {
        if (isCurrent()) setGraphInfo((current) => ({ ...current, subjectCountLoading: false, subjectCountError: facetLoadErrorMessage(error, "Subject count failed.") }));
      }
    };
    const loadAccess = async () => {
      try {
        const response = await fetch("/proxy/api/graph-access", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("graph-info-access", "GraphInfo:access") },
          body: JSON.stringify({ graph }),
        });
        const data = await response.json().catch(() => ({}));
        if (typeof data.access !== "boolean") throw new Error(data.error ?? `Access test failed (HTTP ${response.status}).`);
        if (isCurrent()) setGraphInfo((current) => ({ ...current, access: data.access, accessLoading: false, accessError: data.access ? "" : String(data.error ?? "") }));
      } catch (error) {
        if (isCurrent()) setGraphInfo((current) => ({ ...current, access: false, accessLoading: false, accessError: facetLoadErrorMessage(error, "Access test failed.") }));
      }
    };
    await Promise.all([loadCount(), loadAccess()]);
  }

  function applyGraphText() {
    const graph = graphText.trim();
    recordGraphNavigation(graph);
    setQueryAttribute("graph", graph || null);
    clearTutorialPreview();
  }

  function clearGraph() {
    setGraphText("");
    recordGraphNavigation("");
    setQueryAttribute("graph", null);
    clearTutorialPreview();
  }

  function handleRoleCheckboxChange(uri: string, checked: boolean, trackUsage = true) {
    if (trackUsage) setAutoConfiguredFacet("property-in", uri, false);
    setRoleFilter(uri, checked);
  }

  function navigateIntoRelationship(uri: string, direction: RelationshipDirection) {
    const existingPath = findRelationshipPathNode(uri, direction);
    if (existingPath) {
      navigateToPropertyPath(existingPath.id);
      return;
    }

    // Adding a relationship path relocates the active <view>, so clear all
    // query-scoped widget results as part of this explicit view transition.
    clearWidgetsForViewChange();
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

  const changeResultsPage = useCallback((delta: number) => {
    const nextPage = Math.max(0, resultsUiPage + delta);
    // An unknown total is not a one-page result set. Continue paging while a
    // loaded page is available or the server has not returned a final short batch.
    const knownTotalPages = effectiveResultsTotalCount === null
      ? null
      : Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize));
    const hasLoadedNextPage = results.length > nextPage * resultsPageSize;
    const canRequestNextBatch = !resultsPageComplete && results.length > 0;
    if (nextPage === resultsUiPage || (knownTotalPages !== null
      ? nextPage >= knownTotalPages
      : !hasLoadedNextPage && !canRequestNextBatch)) return;
    setResultsUiPage(nextPage);
    const requiredResultCount = (nextPage + 1) * resultsPageSize;
    if (requiredResultCount > results.length &&
        results.length < (effectiveResultsTotalCount ?? Number.POSITIVE_INFINITY) &&
        !resultsPageComplete && !isSearching && !resultsBatchRequestPending.current) {
      resultsBatchRequestPending.current = true;
      setResultsPage(resultsBatchSize, resultsOffset + Math.max(1, resultsPageMatchCount));
    }
  }, [resultsUiPage, effectiveResultsTotalCount, resultsPageSize, results.length, resultsPageComplete, isSearching, resultsBatchSize, resultsOffset, resultsPageMatchCount, setResultsPage]);

  useEffect(() => {
    if (centralTab !== "results") return;
    const handleResultsArrowKeys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest("input, textarea, select, [contenteditable='true']")
      )) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        changeResultsPage(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        changeResultsPage(1);
        return;
      }
      if (allLoadedResults.length === 0) return;
      const currentIndex = allLoadedResults.findIndex((item) => item.uri === selectedUri);
      const nextIndex = currentIndex < 0
        ? (event.key === "ArrowDown" ? 0 : allLoadedResults.length - 1)
        : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= allLoadedResults.length) return;
      setSelectedUri(allLoadedResults[nextIndex].uri);
      setResultsUiPage(Math.floor(nextIndex / resultsPageSize));
    };
    window.addEventListener("keydown", handleResultsArrowKeys);
    return () => window.removeEventListener("keydown", handleResultsArrowKeys);
  }, [centralTab, allLoadedResults, selectedUri, resultsPageSize, changeResultsPage]);

  useEffect(() => {
    if (centralTab !== "results") return;
    document.querySelector('[data-result-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [centralTab, selectedUri, resultsUiPage, visibleResultsPage]);


  function compactIri(value: string): string {
    return toLabel(value);
  }

  function classBreadcrumbLabels(parentId: string | null): string[] {
    return getClassesAtNode(parentId).map((iri) => toLabel(iri, "Class"));
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

    const parentChildren = "children" in targetParent ? targetParent.children : [];
    const parentSiblings = parentChildren.filter(
      (node, index, all) =>
        isRelationship(node) &&
        node.id !== targetId &&
        all.findIndex((candidate) => candidate.id === node.id) === index,
    );
    if (parentSiblings.length > 0) return parentSiblings;

    return [];

  }

  function breadcrumbSiblingLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri ?? node.attributes.property ?? node.attributes.role;
    const baseLabel = (iri ? toLabel(iri) : queryNodeLabel(node)) +
      (node.name === "property-of" ? " of" : "");
    return baseLabel;
  }

  /**
   * Pop the selected relationship from the displayed breadcrumb stack.
   * If this relationship has siblings, keep the stack slot and expose the
   * first remaining sibling there. This also handles auto-added ghost crumbs:
   * they represent real selected relationships even when the live <view> is
   * still at their parent.
   */
  function popBreadcrumbNode(crumb: { id: string; uri: string; name: string }) {
    const siblings = getBreadcrumbSiblings(crumb.id);
    const replacement = siblings[0];

    // Delete only this relationship (and its descendants) from the query.
    deleteNode(crumb.id);

    setBreadcrumbTrail((current) => {
      const crumbIndex = current.findIndex((entry) => entry.id === crumb.id);
      if (crumbIndex < 0) return current;

      // A sibling replaces the popped entry in the stack. Otherwise remove
      // this entry and the descendant suffix that belonged to it.
      const prefix = current.slice(0, crumbIndex);
      if (!replacement) return prefix;
      return [
        ...prefix,
        {
          id: replacement.id,
          uri: replacement.attributes.iri ?? "",
          name: replacement.name,
        },
      ];
    });
  }

  /** Bound <value> children of a relationship node, in query order. */
  function hasValueRange(value: FctQueryNode): boolean {
    return value.attributes.rangeStart !== undefined || value.attributes.rangeEnd !== undefined;
  }

  function boundValueNodes(node: FctQueryNode | undefined): FctQueryNode[] {
    return (node?.children ?? []).filter((child) => child.name === "value" && (Boolean(child.text) || hasValueRange(child)));
  }

  function boundValueLabel(value: FctQueryNode): string {
    if (hasValueRange(value)) {
      return `(${value.attributes.rangeStart ?? ""}, ${value.attributes.rangeEnd ?? ""})`;
    }
    const text = value.text ?? "";
    const lang = value.attributes["xml:lang"];
    const base = value.attributes.datatype === "uri" ? toLabel(text) : text;
    return lang ? `${base} @${lang}` : base;
  }

  /** Operator icon shared by breadcrumb bindings, menus, and Query Tree bindings. */
  function renderValueOperator(value: FctQueryNode, sizeClass = "size-3.5"): ReactNode {
    const op = (value.attributes.op ?? "=").trim().toLowerCase();
    const iconClass = `${sizeClass} shrink-0 self-center text-muted-foreground`;
    if (hasValueRange(value)) {
      return <ChevronsRightLeft className={iconClass} aria-label="inclusive range" />;
    }
    if (op === "regex") return <Regex className={iconClass} aria-label="regular expression" />;
    if (op === "contains") return <EqualApproximately className={iconClass} aria-label="contains" />;
    if (op === ">" || op === "gt") return <ChevronRight className={iconClass} aria-label="greater than" />;
    if (op === "<" || op === "lt") return <ChevronLeft className={iconClass} aria-label="less than" />;
    if ([">=", "gte", "<=", "lte"].includes(op)) {
      const Icon = op === ">=" || op === "gte" ? ChevronRight : ChevronLeft;
      return <span className="inline-flex shrink-0 items-center gap-0" aria-label={op === ">=" || op === "gte" ? "greater than or equal" : "less than or equal"}>
        <Icon className={iconClass} aria-hidden="true" />
        <Equal className={iconClass} aria-hidden="true" />
      </span>;
    }
    return <Equal className={iconClass} aria-label="equals" />;
  }

  /** Lazy, real example/count for a submenu node, never the predicate display name. */
  async function loadBreadcrumbMenuPreview(nodeId: string) {
    if (breadcrumbPreviewSummaries[nodeId] || breadcrumbMenuPreviewSummaries[nodeId] || breadcrumbMenuPreviewPendingRef.current.has(nodeId)) return;
    const scoped = makeBreadcrumbScopedTree(nodeId);
    if (!scoped || !endpointReadyForQuery) return;
    breadcrumbMenuPreviewPendingRef.current.add(nodeId);
    try {
      const sparql = buildFctCountSparql(scoped);
      const [response, countResponse] = await Promise.all([
        cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "text/xml; charset=utf-8", ...proxyDebugHeaders("breadcrumb-menu-preview", `BreadcrumbMenu:${nodeId}`) },
          body: serializeFctQuery(scoped),
        }),
        sparql ? cachedFetchFct("/proxy/api/sparql", {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("breadcrumb-menu-count", `BreadcrumbMenu:${nodeId}:count`) },
          body: JSON.stringify({ facetValueCount: { sparql } }),
        }) : Promise.resolve(null),
      ]);
      const parsed = await readFctResponse(response);
      const first = parsed.results[0];
      let count: number | null = null;
      if (countResponse?.ok) {
        const payload = await countResponse.json() as { count?: unknown };
        const n = Number(payload.count);
        if (Number.isSafeInteger(n) && n >= 0) count = n;
      }
      setBreadcrumbMenuPreviewSummaries((current) => ({ ...current, [nodeId]: {
        label: first?.label?.trim() || first?.title?.trim() || (first ? toLabel(first.uri, "OBJECT") : "—"),
        count,
        ...(first ? { uri: first.uri, termType: first.termType ?? "uri" } : {}),
      } }));
    } catch (error) {
      console.info("Maestro submenu example lookup failed", { nodeId, error });
    } finally {
      breadcrumbMenuPreviewPendingRef.current.delete(nodeId);
    }
  }

  /** Breadcrumb menu's first item is the example itself, never the relationship label. */
  function renderBreadcrumbMenuHeader(
    summary: FctUiResultSummary | undefined,
    ariaLabel: string,
    onActivate: () => void,
    isBound: boolean,
  ): ReactNode {
    return (
      <DropdownMenuItem
        aria-label={ariaLabel}
        onSelect={onActivate}
        className="mb-1 rounded-b-none border-b pb-1.5 text-xs font-medium text-foreground"
      >
        <span className="max-w-56 truncate">
          {summary?.label && summary.label !== "—" ? `${isBound ? "i.e." : "e.g."} ${ellipsize(summary.label, 40).replace(/[’']s$/u, "")}` : "Example loading…"}
        </span>
      </DropdownMenuItem>
    );
  }

  /**
   * One breadcrumb dropdown entry. A node with child relationships becomes a submenu whose contents are that
   * node's own children (recursively); a leaf is a plain item. Every entry, and every submenu header, runs
   * onSelectNode(node.id) - the same navigation a normal menu item performs.
   */
  function renderBreadcrumbNodeMenuItem(
    node: FctQueryNode,
    onSelectNode: (nodeId: string) => void,
  ): ReactNode {
    const childRelationshipNodes = (node.children ?? []).filter(
      (c) => c.name === "property" || c.name === "property-of"
    );
    const isChildBearing = childRelationshipNodes.length > 0;
    const iri = node.attributes?.iri || "";
    const directionSuffix = (node.name === "property-of" || node.id.startsWith("role-filter-")) ? " of" : "";
    const baseLabel = toLabel(iri, directionSuffix ? "Role" : "Property") + directionSuffix;
    const isExcluded = node.attributes?.exclude?.trim().toLowerCase() === "yes";
    const boundValues = boundValueNodes(node);
    const summary = breadcrumbPreviewSummaries[node.id] ?? breadcrumbMenuPreviewSummaries[node.id];

    const nodeContent = (
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        {isExcluded && <CircleSlash className="size-3.5 shrink-0 text-destructive" aria-label="Excluded" />}
        <span className="truncate">{baseLabel}</span>
        {boundValues.map((v) => (
          <span key={v.id} className="ml-1 inline-flex items-baseline gap-0.5 text-xs text-muted-foreground">
            {renderValueOperator(v, "size-3")}
            <span>
              <em>i.e.</em> {boundValueLabel(v)}
            </span>
          </span>
        ))}
      </span>
    );

    if (isChildBearing) {
      return (
        <DropdownMenuSub key={node.id} onOpenChange={(open) => { if (open) void loadBreadcrumbMenuPreview(node.id); }}>
          <DropdownMenuSubTrigger
            onClick={() => onSelectNode(node.id)}
            className="whitespace-normal break-words flex items-center justify-between"
          >
            {nodeContent}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-50 w-max min-w-44 max-w-[calc(100vw-2rem)]">
            {renderBreadcrumbMenuHeader(summary, `Move view to ${baseLabel}`, () => onSelectNode(node.id), boundValues.length > 0)}
            {childRelationshipNodes.map((child) => renderBreadcrumbNodeMenuItem(child, onSelectNode))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return (
      <DropdownMenuItem
        key={node.id}
        onSelect={() => onSelectNode(node.id)}
        className="whitespace-normal break-words"
      >
        {nodeContent}
      </DropdownMenuItem>
    );
  }

  /**
   * A relationship's bound values sit on the stack just above it: the first
   * pop removes the most recent binding, and only when none remain does the
   * next pop remove the relationship itself.
   */
  function popBreadcrumbOrBinding(crumb: { id: string; uri: string; name: string }) {
    const values = boundValueNodes(findQueryNode(queryTree.children, crumb.id));
    if (values.length > 0) {
      deleteNode(values[values.length - 1].id);
      return;
    }
    popBreadcrumbNode(crumb);
  }

  function queryNodeLabel(node: FctQueryNode): string {
    const iri = node.attributes.iri;
    if (node.id === "query-everything") return "Everything";
    if (node.id === "query-text")
      return node.text || "Everything";
    if (node.id === "query-view") {
      return `Focus · limit ${node.attributes.limit ?? "30"} · offset ${node.attributes.offset ?? "0"}`;
    }
    if (node.name === "value")
      return boundValueLabel(node) || "Value";
    if (node.name === "property-of") {
      // Depending on the source XML, reverse relationships may expose their
      // predicate through iri, property, role, or text. Prefer the Roles facet
      // label, but never fall back to the generic XML tag name.
      const roleIri = iri ?? node.attributes.property ?? node.attributes.role;
      const roleText = typeof node.text === "string" ? node.text.trim() : "";
      return (roleIri ? toLabel(roleIri, "Role") : "") || roleText || "Role";
    }
    if (node.name === "property") {
      // Keep the full IRI in the query tree; use a concise label only for display.
      // Literal bindings are not wired into the UI yet, but display them if present
      // in the query model/XML (e.g. iri="...date" literal="5/23/92").
      const propertyLabel = iri ? toLabel(iri, "Property") : "Property";
      const literal = node.attributes.literal ?? node.attributes.value;
      return literal !== undefined && literal !== ""
        ? `${propertyLabel} = ${literal}`
        : propertyLabel;
    }
    if (node.name === "class" && iri) {
      return `Class: ${toLabel(iri, "Class")}`;
    }
    return node.name;
  }


  const [collapsedQueryNodeIds, setCollapsedQueryNodeIds] = useState<Set<string>>(() => new Set());
  const rootClassNodes = queryTree.children.filter((node) => node.name === "class");
  // Prefer the Text node, otherwise attach root classes to a root Value node.
  const rootClassCarrierId = queryTree.children.find((node) => node.id === "query-text")?.id
    ?? queryTree.children.find((node) => node.name === "value")?.id
    ?? "query-everything";
  const classLabelsForQueryNode = (node: FctQueryNode): string[] => {
    const nested = node.children.filter((child) => child.name === "class").map((child) => child.attributes.iri).filter((iri): iri is string => Boolean(iri));
    const rootStack = node.id === rootClassCarrierId
      ? rootClassNodes.map((classNode) => classNode.attributes.iri).filter((iri): iri is string => Boolean(iri))
      : [];
    return Array.from(new Set([...nested, ...rootStack])).map((uri) => toLabel(uri, "Class"));
  };

  const rootPreviewNodeId = queryTree.children.find((node) => node.name === "value" && node.attributes.datatype === "uri")?.id
    ?? queryTree.children.find((node) => node.id === "query-text")?.id
    ?? "query-everything";
  const renderQueryNode = (
    node: FctQueryNode,
    depth = 0,
  ): ReactNode => {
    // A nested <view> is the focus marker for its parent, not a separate tree row.
    if (node.id === "query-view") return null;
    const protectedNode = node.id === "query-text" || node.id === "query-view" || node.id === "query-everything";
    const rootHasFocusView = queryTree.children.some((child) => child.id === "query-view");
    const isRoot = depth === 0;
    // A <view> belongs to its immediate parent. Color that parent's icon green
    // wherever it occurs in the tree; at the root, the standalone view focuses
    // the root search/value node instead.
    const hasAttachedFocusView = node.children.some((child) => child.id === "query-view");
    const isRootFocusCarrier = isRoot && rootHasFocusView && (node.id === "query-text" || node.id === "query-everything" || node.name === "value");
    const isFocusCarrier = hasAttachedFocusView || isRootFocusCarrier;
    const isRootUriValue = isRoot && node.name === "value" && node.attributes.datatype === "uri";
    const SearchModeIcon = signalOptions.find((option) => option.mode === textSearchMode)?.Icon ?? SignalHigh;
    const NodeIcon = node.id === "query-text"
      ? SearchModeIcon
      : node.id === "query-everything"
        ? SearchModeIcon
        : node.id === "query-view"
        ? null
        : node.name === "property"
          ? BetweenHorizontalStart
          : node.name === "property-of"
            ? BetweenHorizontalEnd
            : node.name === "class"
              ? Shapes
              : node.name === "value"
                ? isRootUriValue ? GlobeCode : Tag
                : null;
    const nodeIconColor = isFocusCarrier
      ? "text-emerald-600 dark:text-emerald-400"
      : node.id === "query-text" || node.id === "query-everything"
        ? "text-black dark:text-white"
        : node.name === "property" || node.name === "property-of"
          ? "text-red-600 dark:text-red-400"
          : node.name === "class"
            ? "text-blue-600 dark:text-blue-400"
            : "text-muted-foreground";
    // <value> children of a property, property-of, or class are shown inline on
    // their parent's row (= value) instead of as separate rows.
    const inlinesValues = node.name === "property" || node.name === "property-of" || node.name === "class";
    const inlineValues = inlinesValues ? boundValueNodes(node) : [];
    const topInlineValue = inlineValues[inlineValues.length - 1];
    const inlineClassNodes = node.children.filter((child) => child.name === "class");
    const rootClassesOnThisNode = node.id === rootClassCarrierId ? rootClassNodes : [];
    const topInlineClass = [...inlineClassNodes, ...rootClassesOnThisNode][inlineClassNodes.length + rootClassesOnThisNode.length - 1];
    // The root row (Everything / search text / root URI value) is a stack too. Its
    // text or value is on top and comes off first, like a <value> on a property;
    // then the root classes pop one at a time. With none of them there is nothing
    // to remove, so the minus is not shown at all.
    const isRootCarrierRow = isRoot && node.id === rootClassCarrierId;
    const rootTextOrValue = isRootCarrierRow && (
      (node.id === "query-text" && Boolean(node.text?.trim() || search.trim())) ||
      (node.name === "value" && Boolean(node.text?.trim())));
    const showMinus = !isRootCarrierRow || rootTextOrValue || rootClassesOnThisNode.length > 0;
    const lockedNode = protectedNode && !isRootCarrierRow;
    const visibleChildren = node.children.filter((child) =>
      child.id !== "query-view" && child.name !== "class" && !(inlinesValues && child.name === "value" && (Boolean(child.text) || hasValueRange(child))));
    const hasVisibleChildren = visibleChildren.length > 0;
    const isCollapsed = collapsedQueryNodeIds.has(node.id);
    const toggleCollapsed = () => setCollapsedQueryNodeIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    return (
      <li key={node.id} className="min-w-0">
        <div
          className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60 ${
            facetHoverPreview && ((facetHoverPreview.kind === "record" && node.id === rootPreviewNodeId) || (facetHoverPreview.kind === "facet" && node.id === facetHoverPreview.successorNodeId))
              ? "bg-purple-50/70 text-purple-800 ring-1 ring-inset ring-purple-500/80 dark:bg-purple-950/30 dark:text-purple-200"
              : ""
          }`}
          style={{ marginLeft: depth * 14 }}
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {hasVisibleChildren ? (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={toggleCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${queryNodeLabel(node)}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
              >
                {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
              </button>} /><TooltipContent>{`${isCollapsed ? "Expand" : "Collapse"} node`}</TooltipContent></Tooltip>
            ) : null}
          </span>
          {NodeIcon && (node.name === "property" || node.name === "property-of" ? (
            <Tooltip>
              <TooltipTrigger render={<span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center" aria-label={node.name === "property-of" ? "Role" : "Property"}><NodeIcon className={`size-4 ${nodeIconColor}`} aria-hidden="true" /></span>} />
              <TooltipContent>{node.name === "property-of" ? "Role" : "Property"}</TooltipContent>
            </Tooltip>
          ) : (
            <NodeIcon className={`mt-0.5 size-4 shrink-0 ${nodeIconColor}`} aria-hidden="true" />
          ))}
          <span className="min-w-0 flex-1 break-words text-sm">
            {node.name === "property" || node.name === "property-of" ? (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                className="min-w-0 break-words text-left underline-offset-2 hover:underline cursor-pointer"
                onClick={() => navigateToPropertyPath(node.id)}
              >
                {queryNodeLabel(node)}{node.name === "property-of" ? " of" : ""}{classLabelsForQueryNode(node).length > 0 ? ` (${classLabelsForQueryNode(node).join(", ")})` : ""}
              </button>} /><TooltipContent>{`Navigate to ${node.name === "property-of" ? "reverse-role" : "property"} scope: ${node.attributes.iri ?? queryNodeLabel(node)}`}</TooltipContent></Tooltip>
            ) : (
              <Tooltip><TooltipTrigger render={<span
                className="min-w-0 break-words"
              >
                {node.name === "value" && <span className="mr-1 inline-flex align-middle">{renderValueOperator(node)}</span>}
                {node.id === "query-view" ? "Results view" : facetHoverPreview?.kind === "record" && node.id === rootPreviewNodeId ? facetHoverPreview.label : queryNodeLabel(node)}{classLabelsForQueryNode(node).length > 0 ? ` (${classLabelsForQueryNode(node).join(", ")})` : ""}
              </span>} /><TooltipContent>{node.attributes.iri ?? node.name}</TooltipContent></Tooltip>
            )}
            {inlineValues.map((value) => (
              <span key={value.id} className="ml-1.5 inline-flex max-w-full items-baseline gap-1 align-baseline">
                {renderValueOperator(value)}
                <Tooltip><TooltipTrigger render={<span
                  className="min-w-0 break-words"
                >
                  {boundValueLabel(value)}
                </span>} /><TooltipContent>{`${value.text ?? ""}${value.attributes.datatype ? ` (${value.attributes.datatype})` : ""}`}</TooltipContent></Tooltip>
              </span>
            ))}
          </span>
          {showMinus && (
          <Tooltip><TooltipTrigger render={<button
            type="button"
            aria-label={
              lockedNode
                ? `${queryNodeLabel(node)} is required`
                : isRootCarrierRow
                  ? rootTextOrValue
                    ? node.name === "value" ? "Remove the root value" : "Clear the search text"
                    : `Remove class ${toLabel(topInlineClass?.attributes.iri ?? "class")} from the root`
                  : topInlineValue
                    ? `Remove value ${boundValueLabel(topInlineValue)} from ${queryNodeLabel(node)}`
                    : topInlineClass
                      ? `Remove class ${toLabel(topInlineClass.attributes.iri ?? "class")} from ${queryNodeLabel(node)}`
                      : `Remove ${queryNodeLabel(node)} and its children`
            }
            disabled={lockedNode}
            onClick={() => {
              if (isRootCarrierRow) {
                if (rootTextOrValue) updateSearchText("");
                else if (topInlineClass) deleteNode(topInlineClass.id);
                return;
              }
              deleteNode(topInlineValue ? topInlineValue.id : topInlineClass ? topInlineClass.id : node.id);
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-base leading-none text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-25"
          >
            −
          </button>} /><TooltipContent>{lockedNode
                ? "Required query node"
                : isRootCarrierRow
                  ? rootTextOrValue
                    ? `${node.name === "value" ? "Remove the root value" : "Clear the search text"}${rootClassesOnThisNode.length > 0 ? "; click again to remove the last class" : ""}`
                    : "Remove the last root class constraint"
                  : topInlineValue
                    ? "Remove the bound value; click again to remove the node"
                    : topInlineClass
                      ? "Remove the last class constraint; click again to remove the node"
                      : "Remove this node and all descendants"}</TooltipContent></Tooltip>
          )}
        </div>
        {hasVisibleChildren && !isCollapsed && (
          <ul
            className="border-l border-border/70"
            style={{ marginLeft: depth * 14 + 18 }}
          >
            {visibleChildren.map((child) => <Fragment key={child.id}>{renderQueryNode(child, depth + 1)}</Fragment>)}
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
        {personalWidgets.map((widget) => {
          const isGroupByFacet = workspaceTab === "browse" && groupedPersonalFacetUri === widget.uri;
          const canGroupByFacet = workspaceTab === "browse" && groupByOptions.some((option) => option.key === `forward:${widget.uri}`);
          return (
          <article
            key={widget.uri}
            ref={(element) => { if (element) personalWidgetCardRefs.current.set(widget.uri, element); else personalWidgetCardRefs.current.delete(widget.uri); }}
            className={`flex min-w-0 flex-col ${isGroupByFacet ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "rounded-md" : ""}`}
            style={facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward"
              ? { boxShadow: "inset 0 0 0 1px rgb(168 85 247 / 0.85)", borderRadius: "0.375rem", ...(isGroupByFacet ? { borderColor: "rgb(168 85 247 / 0.9)" } : {}) }
              : undefined}
          >
            <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByFacet ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""} ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "border-purple-500/80" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Tooltip><TooltipTrigger render={<button
                    type="button"
                    className={`break-words text-left text-sm font-semibold underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === widget.uri && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : "text-inherit"}`}
                    onMouseEnter={() => beginFacetHoverPreview(widget.uri, "forward", toLabel(widget.uri), "personal")}
                    onMouseLeave={clearTutorialPreview}
                    onClick={() => {
                      clearTutorialPreview();
                      const existingPath = findPropertyPathNode(widget.uri);
                      if (existingPath) navigateToPropertyPath(existingPath.id);
                      else navigateIntoRelationship(widget.uri, "forward");
                    }}
                  >
                    <IncompleteWidgetIndicator source={`personal:${widget.uri}`} />
                    {activePropertyFilters.some((node) => node.attributes.iri === widget.uri && node.attributes.src === "shacl") && <ClipboardList className="mr-1 inline size-4 shrink-0" aria-label="SHACL-discovered facet" />}
                    {isGroupByFacet && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                    {widget.excluded && <CircleSlash className="mr-1 inline size-3.5 shrink-0" aria-label="Excluded" />}
                    {toLabel(widget.uri, "Property")}
                  </button>} /><TooltipContent>{`Navigate to ${widget.excluded ? `Excluded: ${toLabel(widget.uri, "Property")}` : toLabel(widget.uri)} scope`}</TooltipContent></Tooltip>
                  {autoConfiguredFacetKeys.has(`property::${widget.uri}`) && (
                    <Bot className="size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <QueryInspectorButton
                      query={serializeFctQuery(createPropertyWidgetQuery(queryTree, widget.uri, "forward", undefined, true))}
                      filename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}.xml`}
                      countQuery={widget.values[0] ? buildFctCountSparql(createDistinctCountQuery(queryTree, "value", widget.values[0].uri, widget.uri, widget.values[0])) : undefined}
                      countFilename={`facet-${toLabel(widget.uri).replace(/[^a-z0-9_-]+/gi, "-")}-first-item-count.xml`}
                    />
                    {workspaceTab === "browse" && !widget.excluded && (
                      <Tooltip><TooltipTrigger render={<button
                        type="button"
                        disabled={!canGroupByFacet}
                        aria-pressed={isGroupByFacet}
                        onClick={() => {
                          if (isGroupByFacet) {
                            setGroupByPropertyUri("");
                            setCentralTab("results");
                          } else {
                            setGroupByPropertyUri(`forward:${widget.uri}`);
                            setCentralTab("groups");
                          }
                        }}
                        className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:pointer-events-none disabled:opacity-30 ${isGroupByFacet ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                        aria-label={isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri, "Property")}` : `Group results by ${toLabel(widget.uri, "Property")}`}
                      >
                        <UsersRound className="size-4" aria-hidden="true" />
                      </button>} /><TooltipContent>{isGroupByFacet ? `Stop grouping by ${toLabel(widget.uri, "Property")}` : canGroupByFacet ? `Group results by ${toLabel(widget.uri, "Property")}` : "Select this property in the active query before grouping by it"}</TooltipContent></Tooltip>
                    )}
                    <Tooltip><TooltipTrigger render={<button
                      type="button"
                      onClick={() => {
                        const pathNode = findPropertyPathNode(widget.uri);
                        if (pathNode) deleteNode(pathNode.id);
                        else removeProperty(activeLeafId, widget.uri);
                        setPersonalWidgets((current) => current.filter((item) => item.uri !== widget.uri));
                      }}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                      aria-label={`Remove ${widget.excluded ? `Excluded: ${toLabel(widget.uri, "Property")}` : toLabel(widget.uri)} widget`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>} /><TooltipContent>{`Remove ${toLabel(widget.uri, "Property")} facet`}</TooltipContent></Tooltip>
                  </div>
                </div>
                <Tooltip><TooltipTrigger render={<p className="mt-1 break-all text-xs text-muted-foreground">{widget.uri}</p>} /><TooltipContent>{widget.uri}</TooltipContent></Tooltip>
              </div>
              <Tooltip><TooltipTrigger render={<span
                className={`shrink-0 text-xs ${widget.error ? "text-destructive" : "text-muted-foreground"}`}
                aria-live="polite"
              >
                {widget.loading ? "Updating…" : widget.error ? "Update failed" : widget.values.length}
              </span>} /><TooltipContent>{widget.error || undefined}</TooltipContent></Tooltip>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!widget.loading &&
                !widget.error &&
                widget.values.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    No values found for this property.
                  </p>
                )}
              {!widget.error &&
                widget.values.length > 0 &&
                (() => {
                  // Query XML is the source of truth for checked values. Read
                  // this property's <value> children from the active view scope
                  // before ordering/paging endpoint results; selectedValues is a
                  // reconciled UI cache and can lag a render behind query changes.
                  const queryFilter = activePropertyFilters.find(
                    (node) => node.attributes.iri === widget.uri,
                  );
                  const checkedValueNodes = (queryFilter?.children ?? [])
                    .filter((child) => child.name === "value" && Boolean(child.text));
                  const queryValueKey = (node: FctQueryNode) => {
                    const datatype = node.attributes.datatype;
                    const lang = node.attributes["xml:lang"];
                    const effectiveDatatype = datatype ?? (lang ? undefined : "string");
                    return fctTermKey(node.text ?? "", effectiveDatatype, lang);
                  };
                  const checkedValueKeys = new Set(checkedValueNodes.map(queryValueKey));
                  const endpointValueKeys = new Set(widget.values.map(facetValueKey));
                  // Place query-selected values first in query order. Do not sort
                  // endpoint results: all unchecked values retain proxy order.
                  const endpointValuesByKey = new Map(
                    widget.values.map((value) => [facetValueKey(value), value] as const),
                  );
                  const checkedValuesFromQuery: FctResult[] = checkedValueNodes.map((node) => {
                    const key = queryValueKey(node);
                    const endpointValue = endpointValuesByKey.get(key);
                    if (endpointValue) return endpointValue;
                    const datatype = node.attributes.datatype;
                    const lang = node.attributes["xml:lang"];
                    const value = node.text ?? "";
                    return {
                      uri: value,
                      title: value,
                      termType: datatype === "uri" ? "uri" : "literal",
                      ...(datatype ? { datatype } : {}),
                      ...(lang ? { lang } : {}),
                      matches: [],
                    };
                  });
                  const orderedValues = [
                    ...checkedValuesFromQuery,
                    ...widget.values.filter((value) => !checkedValueKeys.has(facetValueKey(value))),
                  ].filter((value) => {
                    const valueKey = facetValueKey(value);
                    if (checkedValueKeys.has(valueKey)) return true;
                    const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value);
                    return facetCandidateCounts[countQuery] !== 0;
                  });
                  const pageCount = Math.max(
                    1,
                    Math.ceil(orderedValues.length / FACET_PAGE_SIZE),
                  );
                  const page = Math.min(widget.page, pageCount - 1);
                  const pageValues = orderedValues.slice(
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
                            onClick={(event) => {
                              // Keep pagination from shifting the left pane when the
                              // newly rendered page changes the browser's scroll anchor.
                              const scrollContainer = event.currentTarget.closest(
                                ".overflow-y-auto",
                              ) as HTMLElement | null;
                              const scrollTop = scrollContainer?.scrollTop ?? 0;
                              setPersonalWidgets((current) =>
                                current.map((item) =>
                                  item.uri === widget.uri
                                    ? {
                                        ...item,
                                        page: Math.min(pageCount - 1, page + 1),
                                      }
                                    : item,
                                ),
                              );
                              requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                  if (scrollContainer) scrollContainer.scrollTop = scrollTop;
                                });
                              });
                            }}
                            disabled={page >= pageCount - 1}
                          >
                            Next
                          </button>
                        </div>
                      )}
                      <div className={FACET_ITEM_GAP_CLASS}>
                        {pageValues.map((value, valueIndex) => {
                          const countQuery = distinctCountQueryFor(queryTree, "value", value.uri, widget.uri, value);
                          const isZeroCount = facetCandidateCounts[countQuery] === 0;
                          const valueInputId = `personal-facet-value-${personalWidgets.indexOf(widget)}-${valueIndex}`;
                          const valueLabel = value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri;
                          return (
                          <div
                            key={`${facetValueKey(value)}-${valueIndex}`}
                            aria-disabled={widget.loading || undefined}
                            className={`flex w-full items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 ${isGroupByFacet ? "" : "cursor-pointer"} ${widget.loading ? "opacity-45" : ""}`}
                          >
                            <input
                              id={valueInputId}
                              type="checkbox"
                              name={`property-value-${widget.uri}`}
                              value={value.uri}
                              checked={checkedValueKeys.has(facetValueKey(value))}
                              disabled={widget.loading}
                              onChange={(event) => {
                                const binding = groupValueBinding(value);
                                setPropertyValue(
                                  activeLeafId,
                                  widget.uri,
                                  { text: binding.text, datatype: binding.datatype, ...(binding.lang ? { lang: binding.lang } : {}) },
                                  event.currentTarget.checked,
                                );
                              }}
                              aria-label={`Bind ${toLabel(widget.uri, "Property")} to ${value.termType === "uri" ? toLabel(value.uri, "OBJECT") : value.title || value.uri}`}
                              className="mt-0.5 size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                              aria-invalid={isZeroCount ? true : undefined}
                            />
                            {isGroupByFacet ? (
                              <Tooltip><TooltipTrigger render={<button
                                type="button"
                                onClick={() => scrollToGroupForFacetValue(value)}
                                className={`min-w-0 flex-1 cursor-pointer break-words text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isZeroCount ? "text-destructive" : ""}`}
                              >{valueLabel}</button>} /><TooltipContent>{`Scroll to group ${valueLabel}`}</TooltipContent></Tooltip>
                            ) : (
                              <label htmlFor={valueInputId} className={`min-w-0 flex-1 break-words cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}>
                                {valueLabel}
                              </label>
                            )}
                            <DistinctCount
                              tree={queryTree}
                              kind="value"
                              uri={value.uri}
                              propertyUri={widget.uri}
                              candidateValue={value}
                              onCountChange={(query, count) =>
                                setFacetCandidateCounts((current) =>
                                  current[query] === count ? current : { ...current, [query]: count },
                                )
                              }
                            />
                          </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
            </div>
          </article>
          );
        })}
      </div>
    );
  }

  /**
   * Attach non-enumerable UI-only result metadata to the live query node that
   * owns the active <view>. This never changes XML, query identity, or revision.
   */
  function defineUiResultSummary(
    target: { uiResultSummary?: FctUiResultSummary },
    summary: FctUiResultSummary | undefined,
  ) {
    Object.defineProperty(target, "uiResultSummary", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: summary,
    });
  }

  function clearUiResultSummaries(nodes: FctQueryNode[]) {
    for (const node of nodes) {
      defineUiResultSummary(node, undefined);
      clearUiResultSummaries(node.children);
    }
  }

  clearUiResultSummaries(queryTree.children);
  defineUiResultSummary(queryTree, undefined);
  const firstResultForSummary = results[0];
  const resultSummary: FctUiResultSummary | undefined =
    firstResultForSummary || effectiveResultsTotalCount !== null
      ? {
          label: firstResultForSummary
            ? (firstResultForSummary.label?.trim() || firstResultForSummary.title?.trim() || toLabel(firstResultForSummary.uri))
            : effectiveResultsTotalCount !== null && effectiveResultsTotalCount > 0 ? "Example unavailable" : "—",
          count: effectiveResultsTotalCount,
        }
      : undefined;
  if (resultSummary) {
    if (queryTree.children.some((node) => node.name === "view")) {
      defineUiResultSummary(queryTree, resultSummary);
    } else {
      const attachToViewCarrier = (nodes: FctQueryNode[]): boolean => {
        for (const node of nodes) {
          if (node.children.some((child) => child.name === "view")) {
            defineUiResultSummary(node, resultSummary);
            return true;
          }
          if (attachToViewCarrier(node.children)) return true;
        }
        return false;
      };
      attachToViewCarrier(queryTree.children);
    }
  }

  // Root crumb text. In URI mode (signal-none) the readonly crumb shows the URI's label while the
  // search field keeps the URI itself. Possessive "’s" marks a node that has a successor crumb; the
  // root takes it only for the URI (signal-none) and Name (signal-low) signals.
  const rootSearchText = search.trim();
  const rootSummaryForLabel = breadcrumbPreviewSummaries["query-root"];
  if (textSearchMode === "uri" && rootSearchText && rootSummaryForLabel && !rootSummaryForLabel.zeroClasses
    && rootSummaryForLabel.uri === rootSearchText && rootSummaryForLabel.label && rootSummaryForLabel.label !== "—") {
    rootUriLabelCacheRef.current.set(rootSearchText, rootSummaryForLabel.label);
  }
  const rootUriLabel = textSearchMode === "uri" && rootSearchText
    ? (rootUriLabelCacheRef.current.get(rootSearchText) ?? toLabel(rootSearchText))
    : "";
  const rootPossessiveEligible = (textSearchMode === "uri" || textSearchMode === "name") && tutorialBreadcrumbPath.length > 0;
  const rootLabelPossessive = rootPossessiveEligible && rootSearchText ? "’s" : "";
  const rootBadgeLabelOk = Boolean(rootSummaryForLabel && !rootSummaryForLabel.zeroClasses && rootSummaryForLabel.label && rootSummaryForLabel.label !== "—");
  const rootBadgePossessive = rootPossessiveEligible && rootBadgeLabelOk ? "’s" : "";

  const searchInputGroup = (
                  <ButtonGroup
                    aria-label="Search text and signal controls"
                    className="min-w-0 flex-1 rounded-none border-0 [&>*+*]:border-l [&>*+*]:border-input [&>span]:border-l-0 [&>input]:min-w-0 [&>input]:flex-1 [&>input]:rounded-none [&>input]:border-0 [&>input]:bg-background [&>input]:px-3 [&>input]:py-2 [&>input]:text-sm"
                  >
                    {textSearchMode === "uri" ? (
                      <Tooltip><TooltipTrigger render={<span
                        role="img"
                        aria-label="URI"
                        className="flex h-10 shrink-0 items-center justify-center px-2 text-muted-foreground"
                      >
                        <GlobeCode className="size-4" aria-hidden="true" />
                      </span>} /><TooltipContent>{"URI"}</TooltipContent></Tooltip>
                    ) : (
                      <DropdownMenu
                        open={namePropertyMenuOpen}
                        onOpenChange={(open) => {
                          setNamePropertyMenuOpen(open);
                          if (!open) setRootSearchExpanded(false);
                        }}
                      >
                        <Tooltip>
                          <TooltipTrigger render={<DropdownMenuTrigger asChild><button type="button" onMouseEnter={() => { setRootSearchExpanded(true); setNamePropertyMenuOpen(true); }} aria-label={`Choose name/label property; currently ${selectedNamePropertyLabel}`} className="flex h-10 shrink-0 items-center justify-center px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><SearchCode className="size-4" aria-hidden="true" /></button></DropdownMenuTrigger>} />
                          <TooltipContent>Choose name/label property — currently {selectedNamePropertyLabel}</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
                          {TEXT_SEARCH_NAME_PROPERTIES.map((property) => {
                            const checked = selectedNamePropertyUris.includes(property.uri);
                            return (
                              <DropdownMenuCheckboxItem
                                key={property.uri}
                                checked={checked}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(nextChecked) => {
                                  const nextProperties = nextChecked
                                    ? [...selectedNamePropertyUris, property.uri]
                                    : selectedNamePropertyUris.filter((uri) => uri !== property.uri);
                                  // Keep at least one predicate selected so Name mode never silently
                                  // becomes an unrestricted all-properties search.
                                  if (nextProperties.length) setTextSearchMode("name", nextProperties);
                                }}
                              >
                                <span className="flex min-w-0 flex-1 flex-col"><span>{property.label}</span><span className="text-xs text-muted-foreground">{property.description}</span></span>
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <input
                      autoFocus
                      value={search}
                      onChange={(event) => updateSearchText(event.target.value)}
                      placeholder={textSearchMode === "uri" ? "Enter URI" : "Enter keywords"}
                      aria-label="Search results"
                      className="min-w-0 flex-1 outline-none"
                    />
                    <div
                      aria-label="Search mode"
                      className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${signalPickerExpanded ? "w-[10rem]" : "w-10"}`}
                      onMouseEnter={() => setSignalPickerExpanded(true)}
                      onMouseLeave={() => setSignalPickerExpanded(false)}
                      onFocusCapture={() => setSignalPickerExpanded(true)}
                      onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setSignalPickerExpanded(false);
                        }
                      }}
                    >
                      <div className="inline-flex w-[10rem] shrink-0 overflow-hidden">
                        {(signalPickerExpanded
                          ? signalOptions
                          : [...signalOptions].sort((left, right) =>
                              left.mode === textSearchMode ? -1 : right.mode === textSearchMode ? 1 : 0,
                            )
                        ).map(({ mode, Icon, label }) => (
                          <Tooltip key={mode}>
                            <TooltipTrigger render={
                              <button
                                type="button"
                                onClick={() => {
                                  setTextSearchMode(mode);
                                  setSignalPickerExpanded(false);
                                }}
                                aria-pressed={textSearchMode === mode}
                                aria-label={label}
                                aria-hidden={!signalPickerExpanded && textSearchMode !== mode}
                                tabIndex={!signalPickerExpanded && textSearchMode !== mode ? -1 : 0}
                                className={`flex h-10 w-10 shrink-0 items-center justify-center transition-colors ${textSearchMode === mode ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                              ><Icon aria-hidden="true" className="size-4" /></button>
                            } />
                            <TooltipContent>{label}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  </ButtonGroup>
  );

  // Analyze Table projects the immediate successors of the live focus, not
  // the focus's siblings. The first column is always the current focus's
  // result set; each direct relationship child becomes another column.
  const tableSlot = activePropertyPath[activePropertyPath.length - 1];
  // Keep Analyze's path identical to Browse, including retained muted ghost suffixes.
  const analyzeBreadcrumbTrail = tutorialBreadcrumbPath;
  const tableFocusNode = tableSlot ? findQueryNode(queryTree.children, tableSlot.id) : queryTree;
  const analyzeTableHeaderNodes = (tableFocusNode?.children ?? [])
    .filter((node) => (node.name === "property" || node.name === "property-of") && Boolean(node.attributes.iri))
    .map((node) => ({
      id: node.id,
      uri: node.attributes.iri || "",
      name: node.name,
    }));
  const analyzeTableHeadersKey = [tableSlot?.id ?? "query-root", ...analyzeTableHeaderNodes.map((node) => `${node.id}:${node.name}:${node.uri}`)].join("\u0000");
  // Compare Table retains its facet picker and independent value projection.
  // The regular Table only asks for the relationships represented by its headers.
  // Compare can select only relationships explicitly present at this focus
  // in the live <query>, not all discoverable Properties/Roles facets.
  const compareFacetCandidates = Array.from(new Map(analyzeTableHeaderNodes.map((node) => {
    const key = `${node.name === "property-of" ? "reverse" : "forward"}|${node.uri}`;
    return [key, { key, label: `${toLabel(node.uri, "Property")}${node.name === "property-of" ? " of" : ""}` }];
  })).values());
  const availableCompareFacets = compareFacetCandidates;
  const analyzeFacets = selectedAnalysisUri.includes("compare-table")
    ? availableCompareFacets
    : Array.from(new Map(analyzeTableHeaderNodes.map((node) => {
        const key = `${node.name === "property-of" ? "reverse" : "forward"}|${node.uri}`;
        return [key, {key, label: toLabel(node.uri, "Property") + (node.name === "property-of" ? " of" : "")}];
      })).values());
  const analysisFacetKey = analyzeFacets.map((item) => item.key).join("\u0000");
  const analysisResources = visibleResultsPage.filter((item) => item.termType !== "bnode").map((item) => ({
    value: item.uri, type: item.termType ?? "uri",
    ...(item.datatype && item.datatype !== "string" && item.termType !== "uri" ? { datatype: item.datatype } : {}),
    ...(item.lang ? { lang: item.lang } : {}),
  }));
  const analysisResourceKey = JSON.stringify(analysisResources);
  const analysisRequestKey = JSON.stringify([selectedEndpointId, queryXml, analysisFacetKey, analysisResourceKey]);
  const readyAnalysisValues = analysisValuesState?.requestKey === analysisRequestKey ? analysisValuesState.byUri : null;
  const effectiveCompareFacet = availableCompareFacets.some((facet) => facet.key === compareFacet)
    ? compareFacet : availableCompareFacets[0]?.key ?? "";
  const analysisPageKey = JSON.stringify(visibleResultsPage.map((item) => [item.uri, item.title, item.scopeValues]));
  // Column edits do not change the identity of the page's result rows. Keep the
  // XSLT-created table mounted and reconcile its children by their query node IDs.
  const analysisBaseKey = JSON.stringify([selectedEndpointId, selectedAnalysisUri, tableSlot?.id ?? "query-root",
    resultsUiPage, resultsPageSize, visibleResultsPage.map((item) => [item.uri, item.title, item.termType]),
    selectedAnalysisUri.includes("compare-table") ? effectiveCompareFacet : ""]);
  const analysisSelectionPageKey = JSON.stringify([queryXml, resultsUiPage, resultsPageSize, visibleResultsPage.map((item) => [item.uri, item.termType, item.datatype, item.lang])]);
  const analysisSelectedKeys = analysisSelection.pageKey === analysisSelectionPageKey ? analysisSelection.keys : [];
  const analysisRowKeys = visibleResultsPage.map((item, index) => `${index}:${item.uri}:${item.termType ?? "uri"}`);
  const analysisAllSelected = analysisRowKeys.length > 0 && analysisRowKeys.every((key) => analysisSelectedKeys.includes(key));
  // Discover View policies for class bindings at the active FCT focus.
  // No built-in class names or endpoint-registry membership are assumed.
  const viewScopeNodes = [queryTree, ...activePropertyPath.map((crumb) => findQueryNode(queryTree.children, crumb.id)).filter((node): node is FctQueryNode => Boolean(node))];
  const viewScopeClasses = Array.from(new Set(viewScopeNodes.flatMap((node) => node.children
    .filter((child) => child.name === "class")
    .map((child) => child.attributes.iri ?? "")
    .filter(Boolean))));
  const viewClassKey = JSON.stringify(viewScopeClasses);
  type DiscoveredView = { uri: string; label: string; icon?: string; template: string; matchedClass: string; stylesheet: string };
  const [discoveredViews, setDiscoveredViews] = useState<DiscoveredView[]>([]);
  const [selectedViewUri, setSelectedViewUri] = useState("");
  const [viewDiscoveryLoading, setViewDiscoveryLoading] = useState(false);
  const [viewDiscoveryError, setViewDiscoveryError] = useState("");
  const [viewHtml, setViewHtml] = useState("");
  const [viewXsltMetadata, setViewXsltMetadata] = useState<{ title?: string; icon?: string }>({});
  const [viewDomainRanks, setViewDomainRanks] = useState<Record<string, string>>({});
  const [viewRenderError, setViewRenderError] = useState("");
  useEffect(() => {
    if (workspaceTab !== "view") return;
    const classes = JSON.parse(viewClassKey) as string[];
    const controller = new AbortController();
    setDiscoveredViews([]);
    setViewDiscoveryError("");
    if (!classes.length) { setViewDiscoveryLoading(false); return; }
    setViewDiscoveryLoading(true);
    // Discovery is read-only. Do not leave View waiting indefinitely when a
    // personal SPARQL server is slow or a proxy request stalls.
    const timeout = setTimeout(() => {
      controller.abort();
      setViewDiscoveryLoading(false);
      setViewDiscoveryError("Locating views timed out. Check the personal SPARQL server and try again.");
    }, 15000);
    void (async () => {
      try {
        const response = await fetch("/proxy/api/views", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classes }) });
        const payload = await response.json() as { views?: DiscoveredView[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not discover Views.");
        if (!controller.signal.aborted) {
          const views = payload.views ?? [];
          setDiscoveredViews(views);
          setSelectedViewUri((current) => views.some((view) => view.uri === current) ? current : (views[0]?.uri ?? ""));
        }
      } catch (error) {
        if (controller.signal.aborted) {
          // Ignore stale requests after changing scope or leaving the View tab.
          // For the active request, the timeout callback below sets the error.
        } else {
          setViewDiscoveryError(error instanceof Error ? error.message : "Could not locate views.");
        }
      } finally {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setViewDiscoveryLoading(false);
      }
    })();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [workspaceTab, viewClassKey]);
  const selectedView = discoveredViews.find((view) => view.uri === selectedViewUri);
  // Registry keys are internal slugs, while FCT results contain RDF resource IRIs.
  // Join on endpoint URL first; also accept the registry's display label for
  // entries whose RDF subject is not their HTTP endpoint URL (e.g. personal).
  const endpointForViewResult = (uri: string, label: string): EndpointOption | undefined => {
    const normalized = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
    const exact = fctEndpoints.find((endpoint) => normalized(endpoint.url) === normalized(uri) || endpoint.id === uri);
    if (exact) return exact;
    const labelMatches = fctEndpoints.filter((endpoint) => normalized(endpoint.label) === normalized(label));
    if (labelMatches.length === 1) return labelMatches[0];
    // Graph-server resources sometimes use the site origin instead of /sparql.
    try {
      const candidate = new URL(uri);
      const hostMatches = fctEndpoints.filter((endpoint) => {
        try { return new URL(endpoint.url).host === candidate.host; } catch { return false; }
      });
      if (hostMatches.length === 1) return hostMatches[0];
    } catch { /* RDF identifiers need not be HTTP URLs. */ }
    return undefined;
  };
  const [viewServerSoftware, setViewServerSoftware] = useState<Record<string, { product: string; version: string }>>({});
  const viewSoftwareIds = Array.from(new Set(visibleResultsPage.map((result) => endpointForViewResult(result.uri, result.title)?.id).filter((id): id is string => Boolean(id))));
  const viewSoftwareKey = JSON.stringify(viewSoftwareIds);
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const controller = new AbortController();
    for (const id of JSON.parse(viewSoftwareKey) as string[]) {
      if (viewServerSoftware[id]) continue;
      void (async () => {
        try {
          const response = await fetch(`/proxy/api/server-software?endpointId=${encodeURIComponent(id)}`, { signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json() as { product?: string; version?: string };
          if (!controller.signal.aborted) setViewServerSoftware((current) => ({ ...current, [id]: { product: data.product || "Unknown", version: data.version || "" } }));
        } catch { /* Product detection is optional and must never gate the View. */ }
      })();
    }
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewSoftwareKey, viewServerSoftware]);
  const [viewServerDescriptions, setViewServerDescriptions] = useState<Record<string, string>>({});
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const controller = new AbortController();
    for (const id of JSON.parse(viewSoftwareKey) as string[]) {
      if (Object.prototype.hasOwnProperty.call(viewServerDescriptions, id)) continue;
      void (async () => {
        try {
          const response = await fetch(`/proxy/api/server-description?endpointId=${encodeURIComponent(id)}`, { signal: controller.signal });
          if (!response.ok) return;
          const data = await response.json() as { description?: string };
          if (!controller.signal.aborted) setViewServerDescriptions((current) => ({ ...current, [id]: data.description ?? "" }));
        } catch { /* Optional descriptions must not block View rendering. */ }
      })();
    }
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewSoftwareKey, viewServerDescriptions]);
  const viewResultDomains = Array.from(new Set(visibleResultsPage.map((result) => {
    const endpoint = endpointForViewResult(result.uri, result.title);
    try { return new URL(endpoint?.url ?? result.uri).hostname.replace(/^www\./i, "").toLowerCase(); }
    catch { return ""; }
  }).filter(Boolean)));
  const viewDomainKey = JSON.stringify(viewResultDomains);
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) return;
    const domains = JSON.parse(viewDomainKey) as string[];
    const controller = new AbortController();
    // The server-side proxy caches rankings. Unknown domains are shown as unranked.
    void Promise.all(domains.slice(0, 30).map(async (domain) => {
      try {
        const response = await fetch(`/proxy/api/site-rank?domain=${encodeURIComponent(domain)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { rank?: number | null };
        if (!controller.signal.aborted) setViewDomainRanks((prev) => ({ ...prev, [domain]: data.rank ? `#${data.rank.toLocaleString()}` : "Unranked" }));
      } catch { /* Optional ranking must never block the View. */ }
    }));
    return () => controller.abort();
  }, [workspaceTab, selectedView?.uri, viewDomainKey]);
  const viewPageKey = JSON.stringify(visibleResultsPage.map((item) => [item.uri, item.title]));
  useEffect(() => {
    if (workspaceTab !== "view" || !selectedView) { setViewHtml(""); setViewRenderError(""); return; }
    try {
      const rows = (JSON.parse(viewPageKey) as [string,string][]).map(([uri,label]) => {
        const endpoint = endpointForViewResult(uri, label);
        const endpointUrl = endpoint?.url ?? uri;
        let domain = "";
        let favicon = "";
        try {
          const url = new URL(endpointUrl);
          domain = url.hostname.replace(/^www\./i, "").toLowerCase();
          if (["https:", "http:"].includes(url.protocol)) favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
        } catch { /* A non-HTTP resource URI has no web favicon. */ }
        const health = endpoint ? endpointStatuses[endpoint.id] : undefined;
        const software = endpoint ? viewServerSoftware[endpoint.id] : undefined;
        const healthText = checkingEndpointIds[endpoint?.id ?? ""] ? "Checking…" : health?.status !== null && health?.status !== undefined ? `HTTP ${health.status}` : health ? health.state : "Not yet pinged";
        const healthColor = !health ? "unknown" : health.status === 200 ? "green" : health.status !== null && health.status >= 500 ? "red" : "amber";
        return { uri, label, endpoint: endpointUrl, endpointId: endpoint?.id ?? "", group: endpoint?.group ?? "",
          favicon, rank: domain ? (viewDomainRanks[domain] ?? "Checking…") : "Unranked",
          health: healthText, healthState: healthColor, pinging: Boolean(endpoint && checkingEndpointIds[endpoint.id]), product: software?.product ?? "Unknown", version: software?.version ?? "",
          description: endpoint ? (viewServerDescriptions[endpoint.id] ?? "") : "" };
      });
      const html = renderDiscoveredViewXslt(selectedView.stylesheet, rows);
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const meta = parsed.querySelector("section[data-view-title], section[data-view-icon]");
      const icon = meta?.getAttribute("data-view-icon") ?? undefined;
      setViewXsltMetadata({ title: meta?.getAttribute("data-view-title") ?? undefined, icon });
      setViewHtml(html);
      setViewRenderError("");
    } catch (error) { setViewHtml(""); setViewRenderError(error instanceof Error ? error.message : "View translation failed."); }
  }, [workspaceTab, selectedView?.uri, selectedView?.stylesheet, viewPageKey, endpointStatuses, fctEndpoints, viewDomainRanks, viewServerSoftware, viewServerDescriptions, checkingEndpointIds]);
  const isCompareAnalysis = selectedAnalysisUri.includes("compare-table");
  const histogramColumns = isCompareAnalysis && analysisTable ? analysisTable.columns.slice(1).map((column, index) => ({
    label: /^[a-z][a-z0-9+.-]*:/i.test(column.label) ? toLabel(column.label, "OBJECT") : column.label,
    count: analysisTable.rows.reduce((sum, row) => sum + (row.cells[index]?.checked ? 1 : 0), 0),
  })) : [];

  function toggleAnalysisRow(key: string, checked: boolean) {
    setAnalysisSelection((current) => {
      const keys = current.pageKey === analysisSelectionPageKey ? current.keys : [];
      return { pageKey: analysisSelectionPageKey, keys: checked ? Array.from(new Set([...keys, key])) : keys.filter((existing) => existing !== key) };
    });
  }

  // Fetch per-record values through the existing FCT list-values extension.
  // This is a separate Analyze projection, never a change to the live <query>
  // and never gated by the Results badges setting.
  useEffect(() => {
    if (workspaceTab !== "analyze" || !endpointReadyForQuery || !analysisResourceKey || !analysisFacetKey) return;
    const controller = new AbortController();
    setAnalysisValuesError("");
    void (async () => {
      try {
        const columns: ListValueProjection[] = analysisFacetKey.split("\u0000").map((key) => {
          const separator = key.indexOf("|");
          return {
            direction: key.slice(0, separator) === "reverse" ? "reverse" as const : "forward" as const,
            property: key.slice(separator + 1),
          };
        });
        const projectionQueryXml = listValuesQueryClone(queryXml, columns);
        // Virtuoso's list-values extension accepts at most 100 RDF terms per
        // request. Analyze pages may contain more; preserve the page selection
        // while projecting its terms through bounded, deduplicated requests.
        const uniqueResources = Array.from(new Map(analysisResources.map((term) => [
          JSON.stringify([term.value, term.type, term.datatype ?? "", term.lang ?? ""]), term,
        ])).values());
        const byUri = new Map<string, ScopeValue[]>();
        const maxResourcesPerRequest = 100;
        for (let start = 0; start < uniqueResources.length; start += maxResourcesPerRequest) {
          if (controller.signal.aborted) return;
          const resources = uniqueResources.slice(start, start + maxResourcesPerRequest);
          const response = await cachedFetchFct("/proxy/api/fct", {
            method: "POST", cache: "no-store", signal: controller.signal,
            headers: {"Content-Type": "application/json", ...proxyDebugHeaders("analyze-values", `AnalyzeListValues:${proxyDebugFingerprint(analysisRequestKey)}:${start / maxResourcesPerRequest + 1}`)},
            body: JSON.stringify({queryXml: projectionQueryXml, resources}),
          });
          const xml = await response.text();
          if (!response.ok) throw new Error(`Analyze list-values batch ${start / maxResourcesPerRequest + 1} returned HTTP ${response.status}: ${xml.slice(0, 300)}`);
          for (const [uri, values] of parseListValuesXml(xml)) byUri.set(uri, values);
        }
        if (!controller.signal.aborted) setAnalysisValuesState({requestKey: analysisRequestKey, byUri});
      } catch (error) {
        if (!controller.signal.aborted) {
          setAnalysisValuesError(error instanceof Error ? error.message : "Could not load Analyze facet values.");
          console.warn("Analyze facet values failed:", error);
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceTab, endpointReadyForQuery, analysisRequestKey, analysisFacetKey, analysisResourceKey, queryXml]);

  useEffect(() => {
    if (workspaceTab !== "analyze") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/proxy/api/analyze", {cache:"no-store",signal:controller.signal});
        const payload = await response.json() as {analyses?: AnalysisDefinition[]; error?:string};
        if (!response.ok) throw new Error(payload.error || "Could not discover Analyze policies.");
        if (!controller.signal.aborted) {
          const definitions = payload.analyses ?? [];
          setAnalysisDefinitions(definitions);
          setSelectedAnalysisUri((current) => definitions.some((item) => item.uri === current) ? current : (definitions[0]?.uri ?? ""));
        }
      } catch (error) {
        if (!controller.signal.aborted) setAnalysisError(error instanceof Error ? error.message : "Analysis discovery failed.");
      }
    })();
    return () => controller.abort();
  }, [workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "analyze") return;
    const definition = analysisDefinitions.find((item) => item.uri === selectedAnalysisUri);
    if (!definition) { setAnalysisTable(null); analysisRenderedBaseRef.current = ""; return; }
    // Structural edits to the live focus's immediate children only add/remove
    // a column. Reuse all existing result rows, cells, DOM and handlers.
    if (!selectedAnalysisUri.includes("compare-table") && analysisRenderedBaseRef.current === analysisBaseKey) {
      setAnalysisTable((previous) => {
        if (!previous) return previous;
        const existing = new Map(previous.columns.filter((column) => column.kind === "breadcrumb").map((column) => [column.nodeId, column]));
        const resultColumn = previous.columns.find((column) => column.kind === "result") ?? {
          kind: "result", nodeId: "", label: "Results", breadcrumbStyle: {}, headerStyle: {},
        };
        // New headers inherit XSLT presentation-only styles from an existing
        // breadcrumb column. The interaction comes from the shared renderer.
        const stylesheetColumn = previous.columns.find((column) => column.kind === "breadcrumb");
        const columns = [resultColumn, ...analyzeTableHeaderNodes.map((node) => existing.get(node.id) ?? {
          kind: "breadcrumb", nodeId: node.id, label: toLabel(node.uri, "Property"),
          breadcrumbStyle: stylesheetColumn?.breadcrumbStyle ?? {},
          headerStyle: stylesheetColumn?.headerStyle ?? {},
        })];
        if (columns.length === previous.columns.length && columns.every((column, index) => column === previous.columns[index])) return previous;
        const oldCellByNode = new Map(previous.columns.slice(1).map((column, index) => [column.nodeId, index]));
        return { ...previous, columns, rows: previous.rows.map((row) => ({
          ...row,
          cells: columns.slice(1).map((column) => {
            const index = oldCellByNode.get(column.nodeId);
            return index === undefined
              ? { checked: false, badgeStyle: row.cells[0]?.badgeStyle ?? {}, cellStyle: row.cells[0]?.cellStyle ?? {}, values: [] }
              : row.cells[index];
          }),
        })) };
      });
      return;
    }
    const controller = new AbortController();
    // Keep the previous table visible while a genuinely new page/focus loads.
    setAnalysisLoading(true);
    setAnalysisError("");
    void (async () => {
      try {
        const ns = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
        const doc = document.implementation.createDocument(ns, "mctx:context", null);
        const root = doc.documentElement;
        const add = (parent: Element, name: string) => {
          const element = doc.createElementNS(ns, `mctx:${name}`);
          parent.appendChild(element);
          return element;
        };
        const liveQuery = add(root,"live-query");
        const query = new DOMParser().parseFromString(queryXml, "application/xml");
        if (query.getElementsByTagName("parsererror").length) throw new Error("The FCT query is not well-formed XML.");
        liveQuery.appendChild(doc.importNode(query.documentElement, true));
        const breadcrumbRoot = add(root,"breadcrumbs");
        // The Table XSLT receives only immediate child relationship references.
        // The first (focus/result) header is rendered separately by Maestro.
        // Each child ID resolves to the existing live breadcrumb renderer.
        analyzeTableHeaderNodes.forEach((crumb) => {
          const node = add(breadcrumbRoot,"breadcrumb");
          node.setAttribute("id",crumb.id);
          node.setAttribute("iri",crumb.uri);
          node.setAttribute("direction",crumb.name === "property-of" ? "reverse" : "forward");
          node.setAttribute("label",toLabel(crumb.uri, "Property"));
        });
        // No generic facet columns in Table: only direct children of the
        // live focus. Keep the element for backwards compatibility with XSLT.
        add(root,"extra-facets");
        const selection = add(root,"selection");
        const [direction,facet] = effectiveCompareFacet.split("|",2);
        selection.setAttribute("direction",direction || "forward");
        selection.setAttribute("facet",facet || "");
        const resultRoot = add(root,"results");
        visibleResultsPage.forEach((result) => {
          const resultElement = add(resultRoot,"result");
          resultElement.setAttribute("uri",result.uri);
          resultElement.setAttribute("label",result.title || result.uri);
          // The independent Analyze projection supplies values even if Results
          // badges are disabled. Keep already-known badge values as a fallback.
          const byFacet = new Map<string, ScopeValue>();
          for (const scope of result.scopeValues ?? []) byFacet.set(`${scope.direction}|${scope.property}`, scope);
          for (const scope of readyAnalysisValues?.get(result.uri) ?? []) byFacet.set(`${scope.direction}|${scope.property}`, scope);
          Array.from(byFacet.values()).forEach((scope) => scope.values.forEach((value) => {
            if (!value.value || value.value === "-") return;
            const element = add(resultElement,"value");
            element.setAttribute("property",scope.property);
            element.setAttribute("direction",scope.direction);
            element.setAttribute("termType",value.type || "literal");
            element.textContent = value.value;
          }));
        });
        const response = await fetch("/proxy/api/xslt", {
          method:"POST",cache:"no-store", signal:controller.signal,
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({stylesheetText:definition.stylesheet,sourceXml:new XMLSerializer().serializeToString(doc),recordUri:"",outputMode:"xml"}),
        });
        const payload = await response.json() as {xml?:string;error?:string};
        if (!response.ok || !payload.xml) throw new Error(payload.error || "Analysis XSLT failed.");
        const transformed = new DOMParser().parseFromString(payload.xml,"application/xml");
        const analysis = transformed.documentElement;
        if (analysis.localName !== "analysis" || transformed.getElementsByTagName("parsererror").length) throw new Error("Analysis XSLT must return an analysis element.");
        const columns = Array.from(analysis.getElementsByTagName("columns")[0]?.children ?? []).map((node) => ({
          kind:node.getAttribute("kind") ?? "",nodeId:node.getAttribute("node-id") ?? "",label:node.getAttribute("label") ?? "",breadcrumbStyle:analysisPresentationStyle(node.getAttribute("breadcrumb-style")),headerStyle:analysisPresentationStyle(node.getAttribute("header-style")),
        }));
        const rows = Array.from(analysis.getElementsByTagName("rows")[0]?.children ?? []).map((node) => ({
          uri:node.getAttribute("uri") ?? "",label:node.getAttribute("label") ?? "",
          cells:Array.from(node.children).map((cell) => ({checked:cell.getAttribute("checked") === "yes", badgeStyle:analysisPresentationStyle(cell.getAttribute("badge-style") ?? analysis.getAttribute("badge-style")), cellStyle:analysisPresentationStyle(cell.getAttribute("cell-style")), values:Array.from(cell.children).map((value) => value.textContent || "")})),
        }));
        if (!controller.signal.aborted) { analysisRenderedBaseRef.current = analysisBaseKey; setAnalysisTable({
          trailStyle: analysisPresentationStyle(analysis.getAttribute("trail-style")),
          tableStyle: analysisPresentationStyle(analysis.getAttribute("table-style")),
          headerStyle: analysisPresentationStyle(analysis.getAttribute("header-style")),
          cellStyle: analysisPresentationStyle(analysis.getAttribute("cell-style")),
          rowStyle: analysisPresentationStyle(analysis.getAttribute("row-style")),
          columns, rows,
        }); }
      } catch (error) {
        if (!controller.signal.aborted) setAnalysisError(error instanceof Error ? error.message : "Analysis transformation failed.");
      } finally { if (!controller.signal.aborted) setAnalysisLoading(false); }
    })();
    return () => controller.abort();
  }, [workspaceTab, analysisDefinitions, selectedAnalysisUri, queryXml, analyzeTableHeadersKey, analysisPageKey, effectiveCompareFacet, analysisRequestKey, analysisValuesState, analysisBaseKey]);

  // One interactive value badge renderer for Browse cards and Analyze cells.
  // Navigation and tooltip semantics must remain identical in both layouts.
  function renderScopeValueBadge(scope: ScopeValue, term: ScopeValue["values"][number], termIndex: number, options?: {valueOnly?: boolean; style?: CSSProperties}) {
    const propertyLabel = toLabel(scope.property);
    const visiblePropertyLabel = scope.direction === "reverse" ? `${propertyLabel} of` : propertyLabel;
    const displayValue = term.type === "uri" ? toLabel(term.value) : term.value;
    const label = `${visiblePropertyLabel}: ${displayValue}${term.lang ? ` @${term.lang}` : ""}${term.datatype ? `^^${term.datatype}` : ""}`;
    return (
      <Tooltip key={`${scope.direction}:${scope.property}:${term.value}:${term.lang ?? ""}:${term.datatype ?? ""}:${termIndex}`}>
        <TooltipTrigger render={<button type="button"
          onClick={() => navigateResultBadge(scope.property, term, scope.direction)}
          style={options?.style}
          className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {!options?.valueOnly && <span className="font-medium text-foreground">{visiblePropertyLabel}</span>}
          <span className="max-w-[240px] truncate">{displayValue}</span>
        </button>} />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  // A single root breadcrumb control is shared by Browse and Analyze.
  // Keep all search, class, preview, and navigation interactions in one JSX tree.
  function renderRootBreadcrumb(tableHeader = false, presentationStyle?: CSSProperties, showMetadata = true) {
    return (<span
          className="relative flex min-w-0 items-center gap-1"
          style={{ zIndex: hoveredBreadcrumbBadgeId === "query-root" ? tutorialBreadcrumbPath.length + 100 : 1 }}
          onMouseEnter={() => setHoveredBreadcrumbBadgeId("query-root")}
          onMouseLeave={() => {
            setHoveredBreadcrumbBadgeId((current) => current === "query-root" ? null : current);
            if (!namePropertyMenuOpen) setRootSearchExpanded(false);
          }}
        >
          <ButtonGroup aria-label="Root query controls" className={`min-w-0 max-w-full ${tableHeader ? "border-0 shadow-none" : rootSearchExpanded ? "border border-input" : "border border-border"} ${facetHoverPreview?.kind === "record" ? "rounded-md !border-purple-500/80 text-purple-800 dark:text-purple-200" : ""}`}>
            {rootSearchExpanded ? (
              <div className="min-w-0 max-w-[min(42rem,70vw)] flex-1">
                {searchInputGroup}
              </div>
            ) : (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                ref={getPropertyPath().length === 0 ? activeBreadcrumbButtonRef : undefined}
                onClick={handleRootBreadcrumbClick}
                style={presentationStyle}
                className={`relative cursor-pointer rounded-none border-0 px-2.5 pb-1.5 pt-4 text-sm ${facetHoverPreview?.kind === "record" ? "!bg-purple-100/80 font-semibold text-purple-800 dark:!bg-purple-950/60 dark:text-purple-200" : getPropertyPath().length === 0 ? "bg-accent font-medium" : "bg-background hover:bg-accent"}`}
              >
                {classBreadcrumbLabels(null).length > 0 && (
                  <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${classBreadcrumbLabels(null).join(", ")}`}>
                    {classBreadcrumbLabels(null).join(", ")}
                  </span>
                )}
                {facetHoverPreview?.kind === "record"
                  ? facetHoverPreview.label
                  : !search.trim()
                    ? "Everything"
                    : textSearchMode === "uri"
                      ? `${rootUriLabel}${rootLabelPossessive}`
                      : `"${search}"${rootLabelPossessive}`}
              </button>} /><TooltipContent>{`Return to the top-level query view${textSearchMode === "uri" && rootSearchText ? ` · ${rootSearchText}` : ""}${classBreadcrumbLabels(null).length ? ` · Classes: ${classBreadcrumbLabels(null).join(", ")}` : ""}`}</TooltipContent></Tooltip>
            )}
            {!rootSearchExpanded && queryTree.children.some((node) => node.name === "class") && (
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={() => {
                  const rootClasses = queryTree.children.filter((node) => node.name === "class");
                  const lastRootClass = rootClasses[rootClasses.length - 1];
                  if (lastRootClass) deleteNode(lastRootClass.id);
                }}
                className="flex h-auto min-h-10 w-7 shrink-0 items-center justify-center border-l border-input text-muted-foreground hover:bg-accent hover:text-destructive"
                aria-label="Remove the last root class constraint"
              >−</button>} /><TooltipContent>{"Remove the last root class constraint"}</TooltipContent></Tooltip>
            )}
            {!rootSearchExpanded && <Tooltip><TooltipTrigger render={<button
              type="button"
              onFocus={() => setRootSearchExpanded(true)}
              onClick={() => setRootSearchExpanded(true)}
              className="flex h-auto min-h-10 w-7 shrink-0 items-center justify-center rounded border border-input py-0 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Search signal: ${signalOptions.find(({ mode }) => mode === textSearchMode)?.label ?? "Clear Terms"}`}
            >
              <ActiveSignalIcon className="size-4" aria-hidden="true" />
            </button>} /><TooltipContent>{signalOptions.find(({ mode }) => mode === textSearchMode)?.label ?? "Clear Terms"}</TooltipContent></Tooltip>}
          </ButtonGroup>
          {showMetadata && (breadcrumbPreviewSummaries["query-root"] || breadcrumbPreviewPendingIds.has("query-root")) && (
            /* 15px centers this compact metadata badge beneath the next slash. */
            <span className="absolute left-[calc(100%+15px)] top-full -translate-x-1/2 pt-1"
                    onMouseEnter={() => setHoveredBreadcrumbBadgeId("query-root")}
                    onMouseLeave={() => setHoveredBreadcrumbBadgeId((current) => current === "query-root" ? null : current)}>
              {breadcrumbPreviewSummaries["query-root"] ? (
                <Tooltip><TooltipTrigger render={<Badge
                  variant="outline"
                  onClick={toggleBreadcrumbBadgeMode}
                  className={`flex max-w-52 items-center gap-1 whitespace-nowrap text-[10px] font-normal leading-3 cursor-pointer select-none ${breadcrumbBadgeMode === "classes" ? "border-blue-400/70 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-950/50 dark:text-blue-200" : "bg-background hover:bg-accent"}`}
                  aria-label="Click to toggle category or record metadata"
                >
                  <span className="max-w-32 truncate">
  <em>
  {rootUriValues.length > 0 ? "i.e." : "e.g."}{" "}
  {ellipsize(breadcrumbPreviewSummaries["query-root"].label || "—", 28)}{breadcrumbBadgeMode === "classes" ? "" : rootBadgePossessive}
</em>
</span>
                  <span aria-hidden="true" className="mx-1 h-3 self-center border-l border-border" />
                  {breadcrumbPreviewSummaries["query-root"].zeroClasses ? (
                    <Ban className="size-3 text-muted-foreground shrink-0" aria-label="0" />
                  ) : (
                    <span>{shortenCount(breadcrumbPreviewSummaries["query-root"].count)}</span>
                  )}
                </Badge>} /><TooltipContent side="bottom" sideOffset={7}>{`${breadcrumbPreviewSummaries["query-root"].label} · ${breadcrumbPreviewSummaries["query-root"].zeroClasses ? "0" : shortenCount(breadcrumbPreviewSummaries["query-root"].count)} (Click to toggle)`}</TooltipContent></Tooltip>
              ) : (
                <Badge variant="outline" className="flex items-center gap-1 whitespace-nowrap text-[10px] font-normal leading-3" aria-label="Loading root result metadata">
                  <LoaderCircle data-icon="inline-start" className="size-3 animate-spin" aria-hidden="true" />
                  Loading…
                </Badge>
              )}
            </span>
          )}
        </span>);
  }

  // Single breadcrumb implementation for both Browse and Analyze table headers.
  // All query mutations, sibling menus, preview metadata and active state stay here.
  function renderPathBreadcrumb(crumb: (typeof tutorialBreadcrumbPath)[number], index: number, tableHeader = false, presentationStyle?: CSSProperties, showMetadata = true) {

  const isInactiveSuffix = index > activeBreadcrumbIndex;
          const breadcrumbClasses = classBreadcrumbLabels(crumb.id);
          const breadcrumbNode = findQueryNode(queryTree.children, crumb.id);
          const breadcrumbIsRole = crumb.name === "property-of" || crumb.id.startsWith("role-filter-");
          const breadcrumbBaseLabel = toLabel(crumb.uri, breadcrumbIsRole ? "Role" : "Property") + (breadcrumbIsRole ? " of" : "");
          const breadcrumbExcluded = breadcrumbNode?.attributes.exclude?.trim().toLowerCase() === "yes";
          const breadcrumbLabel = breadcrumbExcluded ? `Excluded: ${breadcrumbBaseLabel}` : breadcrumbBaseLabel;
          const breadcrumbSiblings = getBreadcrumbSiblings(crumb.id);
          const breadcrumbBoundValues = boundValueNodes(breadcrumbNode);
          const topBoundValue = breadcrumbBoundValues[breadcrumbBoundValues.length - 1];
          // A crumb followed by another displayed crumb is possessive ("Alice’s friend’s name"): its
          // badge example takes "’s", and so does its label unless it is a role (property-of) crumb.
          const breadcrumbHasSuccessor = tutorialBreadcrumbPath.some((entry, pathIndex) => entry.id === crumb.id && pathIndex < tutorialBreadcrumbPath.length - 1);
          return (
            <span key={crumb.id} className={tableHeader ? "relative flex max-w-full flex-col items-start gap-1" : "relative flex max-w-full items-center gap-1"}
              style={{ zIndex: hoveredBreadcrumbBadgeId === crumb.id ? tutorialBreadcrumbPath.length + 100 : index + 2 }}
              onMouseEnter={() => setHoveredBreadcrumbBadgeId(crumb.id)}
              onMouseLeave={() => setHoveredBreadcrumbBadgeId((current) => current === crumb.id ? null : current)}>
              {!tableHeader && <span className="flex size-3.5 shrink-0 items-center justify-center">
                <Slash aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </span>}
              {!tableHeader && showMetadata && (() => {
                // Each relationship crumb displays its own scoped preview. The root has a
                // separate query-root preview above the root breadcrumb button.
                const isTutorialSuccessor = tutorialBreadcrumbTargetId === crumb.id;
                const summary = breadcrumbPreviewSummaries[crumb.id] ?? breadcrumbNode?.uiResultSummary;
                const isPending = breadcrumbPreviewPendingIds.has(crumb.id);
                if (isTutorialSuccessor) return (
                  <span className={tableHeader ? "order-2 mt-1" : "pointer-events-none absolute left-[calc(100%+15px)] top-full -translate-x-1/2 pt-1"}>
                    <Badge variant="outline" className="flex items-center gap-1 whitespace-nowrap bg-background border-purple-400/70 text-[10px] font-normal leading-3 text-purple-700 dark:text-purple-300">Preview · …</Badge>
                  </span>
                );
                if (openBreadcrumbDropdownId === crumb.id) return null;
                return summary || isPending ? (
                  /* Match the next slash center: 8px nav gap + 7px half of the 14px icon. */
                  <span className={tableHeader ? "order-2 mt-1" : "absolute left-[calc(100%+15px)] top-full -translate-x-1/2 pt-1"}
                    onMouseEnter={() => setHoveredBreadcrumbBadgeId(crumb.id)}
                    onMouseLeave={() => setHoveredBreadcrumbBadgeId((current) => current === crumb.id ? null : current)}>
                    {summary ? (
                      <Tooltip><TooltipTrigger render={<Badge
                        variant="outline"
                        onClick={toggleBreadcrumbBadgeMode}
                        className={`flex max-w-52 items-center gap-1 whitespace-nowrap text-[10px] font-normal leading-3 cursor-pointer select-none ${breadcrumbBadgeMode === "classes" ? "border-blue-400/70 bg-blue-50 text-blue-800 hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-950/50 dark:text-blue-200" : "bg-background hover:bg-accent"}`}
                        aria-label="Click to toggle category or record metadata"
                      >
                        <span className="max-w-32 truncate">
  <em>
  {breadcrumbBoundValues.length > 0 ? "i.e." : "e.g."} {ellipsize(summary.label || "—", 28)}{breadcrumbBadgeMode !== "classes" && breadcrumbHasSuccessor && !summary.zeroClasses && summary.label && summary.label !== "—" ? "’s" : ""}
</em>
</span>
                        <span aria-hidden="true" className="mx-1 h-3 self-center border-l border-border" />
                        {summary.zeroClasses ? (
                          <Ban className="size-3 text-muted-foreground shrink-0" aria-label="0" />
                        ) : (
                          <span>{shortenCount(summary.count)}</span>
                        )}
                      </Badge>} /><TooltipContent side="bottom" sideOffset={7}>{`${summary.label} · ${summary.zeroClasses ? "0" : shortenCount(summary.count)} (Click to toggle)`}</TooltipContent></Tooltip>
                    ) : (
                      <Badge variant="outline" className="flex items-center gap-1 whitespace-nowrap bg-background text-[10px] font-normal leading-3" aria-label={`Loading metadata for ${breadcrumbBaseLabel}`}>
                        <LoaderCircle data-icon="inline-start" className="size-3 animate-spin" aria-hidden="true" />
                        Loading…
                      </Badge>
                    )}
                  </span>
                ) : null;
              })()}
              {/* w-max lets the crumb stretch to its full "prop = value" statement; max-w-full only wraps it when it exceeds the whole bar. */}
              <ButtonGroup aria-label={`Controls for ${breadcrumbLabel}`} className={`w-max max-w-full [&>*+*]:!border-l-0 ${tableHeader ? "order-1 border-0 shadow-none [&_button]:!border-0 [&_button]:!rounded-none" : ""} ${tutorialBreadcrumbTargetId === crumb.id ? "rounded-md !border-purple-500/80" : ""}`}>
                <Tooltip><TooltipTrigger render={<button
                  type="button"
                  ref={crumb.id === activeLeafId && index === activeBreadcrumbIndex ? activeBreadcrumbButtonRef : undefined}
                  onClick={() => handleBreadcrumbClick(crumb.id)}
                  style={presentationStyle}
                  className={`relative min-w-0 cursor-pointer break-words rounded-none border-0 px-2.5 pb-1.5 pt-4 text-left text-sm hover:bg-accent ${
  tutorialBreadcrumbTargetId === crumb.id
    ? "!bg-purple-100/80 font-semibold text-purple-800 dark:!bg-purple-950/60 dark:text-purple-200"
    : index === activeBreadcrumbIndex
      ? "bg-accent font-medium text-foreground"
      : isInactiveSuffix
        ? "bg-background text-muted-foreground"
        : "bg-background text-foreground"
}`}
                  aria-current={
  crumb.id === activeLeafId && index === activeBreadcrumbIndex ? "location" : undefined
}
                >
                  {breadcrumbClasses.length > 0 && (
                    <span className="absolute left-1 top-0 max-w-[calc(100%-8px)] truncate text-left text-[9px] font-normal leading-3 text-muted-foreground" aria-label={`Classes: ${breadcrumbClasses.join(", ")}`}>
                      {breadcrumbClasses.join(", ")}
                    </span>
                  )}
                  {breadcrumbExcluded && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                  {breadcrumbBaseLabel}
                  {breadcrumbBoundValues.map((value) => (
                    <span key={value.id} className="ml-1.5 inline-flex items-baseline gap-1">
  {renderValueOperator(value)}
  <span>{boundValueLabel(value)}</span>
</span>
                  ))}
                  {breadcrumbHasSuccessor && !breadcrumbIsRole ? "’s" : ""}
                </button>} /><TooltipContent>{`Navigate to ${crumb.uri}${breadcrumbClasses.length ? ` · Classes: ${breadcrumbClasses.join(", ")}` : ""}`}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger render={<button
                  type="button"
                  onClick={() => { clearTutorialPreview(); popBreadcrumbOrBinding(crumb); }}
                  className="flex h-auto min-h-full w-7 shrink-0 self-stretch items-center justify-center rounded-none border-0 py-0 text-base leading-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={topBoundValue
                    ? `Remove value ${boundValueLabel(topBoundValue)} bound to ${breadcrumbLabel}`
                    : `Pop ${breadcrumbLabel} from the breadcrumb stack`}
                >
                  −
                </button>} /><TooltipContent>{topBoundValue
                    ? "Remove the bound value; click again to pop this relationship"
                    : "Pop this relationship and its descendants; preserve a sibling when available"}</TooltipContent></Tooltip>
                {(() => {
					 const summary = breadcrumbPreviewSummaries[crumb.id] ?? breadcrumbNode?.uiResultSummary;
                  const hasMenu = breadcrumbSiblings.length > 0;
                  if (!hasMenu || tableHeader) return null;
                  return (
                    <DropdownMenu open={openBreadcrumbDropdownId === crumb.id} onOpenChange={(open) => setOpenBreadcrumbDropdownId(open ? crumb.id : null)}>
                      <Tooltip>
                        <TooltipTrigger render={<DropdownMenuTrigger asChild><button
                          type="button"
                          aria-label={`Choose a relationship for ${compactIri(crumb.uri)}`}
                          className={`flex h-auto min-h-10 w-8 shrink-0 self-stretch items-center justify-center rounded-none border-0 p-0 ${tutorialBreadcrumbTargetId === crumb.id ? "bg-transparent text-purple-800 dark:text-purple-200" : `bg-background ${isInactiveSuffix ? "text-muted-foreground" : "text-foreground"}`} outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 6 4 4 4-4" /></svg>
                        </button></DropdownMenuTrigger>} />
                        <TooltipContent>{"Choose a relationship"}</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end" className="z-50 w-max min-w-44 max-w-[calc(100vw-2rem)]">
                        {renderBreadcrumbMenuHeader(summary, `Move view to ${breadcrumbBaseLabel}`, () => { clearTutorialPreview(); navigateToPropertyPath(crumb.id); }, breadcrumbBoundValues.length > 0)}
                        {/* Siblings only: the crumb itself is not listed. A sibling with child relationships opens a submenu (headed by its own clickable e.g./i.e. label) of those children, recursively. */}
                        {breadcrumbSiblings.map((sibling) =>
                          renderBreadcrumbNodeMenuItem(sibling, (targetId) => {
                            clearTutorialPreview();
                            navigateToPropertyPath(targetId);
                          })
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })()}
              </ButtonGroup>
            </span>
          );
  }

  return (
    <main className="flex h-dvh min-h-[500px] flex-col bg-background text-foreground">
      <Toaster />
      {endpointHealthToast && <div role="alert" className="fixed bottom-5 right-5 z-[200] flex max-w-md items-center gap-3 rounded-lg border border-destructive/40 bg-popover p-4 text-popover-foreground shadow-xl">
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-destructive">Graph server health check failed</div><div className="mt-1 text-sm">{endpointHealthToast.message}</div></div>
        <button type="button" className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" disabled={isRefreshingFailedEndpoint} onClick={() => void refreshFailedEndpointAndRetry()}>{isRefreshingFailedEndpoint ? "Refreshing…" : "Refresh"}</button>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss health check error" onClick={() => setEndpointHealthToast(null)}>×</button>
      </div>}
      <AlertDialog open={clearCacheDialogOpen} onOpenChange={setClearCacheDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Maestro cache?</AlertDialogTitle>
            <AlertDialogDescription>Clear all localStorage data saved by this site? This resets saved settings and reloads Maestro.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              try {
                await clearClientQueryCache();
                await clearMaestroStorage();
                window.localStorage.clear();
                window.location.reload();
              } catch {
                toast.add({ title: "Could not clear cache", description: "Check your browser's site storage permissions.", type: "error" });
                setClearCacheDialogOpen(false);
              }
            }}>Clear Cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteHistoryDialogOpen} onOpenChange={(open) => { if (!isDeletingHistory) setDeleteHistoryDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete query History?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete all Maestro query History visits from your personal RDF store? This cannot be undone. Saved query bookmarks will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingHistory}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isDeletingHistory} onClick={(event) => { event.preventDefault(); void deleteQueryHistory(); }}>
              {isDeletingHistory ? "Deleting…" : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isCheckingEndpoints && (
        <div className="fixed inset-x-0 top-0 z-[100] h-1.5 bg-muted" role="status" aria-label="Checking FCT endpoints">
          <Progress className="h-full rounded-none bg-muted" value={endpointChecksTotal > 0 ? (endpointChecksCompleted / endpointChecksTotal) * 100 : 0} indeterminate={endpointChecksTotal === 0 || endpointChecksCompleted === 0} aria-label="FCT endpoint check progress" />
        </div>
      )}
      {endpointReadyForQuery && personalWidgets.map((widget) => (
        <PersonalWidgetQueryListener
          key={widget.uri}
          propertyUri={widget.uri}
          sortByCount={centralTab === "groups" && groupByPropertyUri === `forward:${widget.uri}`}
          limit={leftPanelLimit}
          groupBy={centralTab === "groups" && selectedGroupByOption && groupedPersonalFacetUri === widget.uri ? { option: selectedGroupByOption, limit: groupBatchSize } : undefined}
          setPersonalWidgets={setPersonalWidgets}
          endpointReady={endpointReadyForQuery}
          refreshRevision={queryRefreshRevision}
        />
      ))}

      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2">
          <ButtonGroup aria-label="Graph navigation" className="shrink-0 border-0 shadow-none">
            {authSession && (<>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<button type="button" onMouseEnter={() => startHistoryActionHover("backward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("backward")} aria-label="Previous query in history" aria-busy={historyNavigationPending === "backward"} disabled={!historyHasOlder || historyNavigationPending !== null} className={`inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}><span className="inline-flex" aria-hidden="true">{historyNavigationPending === "backward" ? <ClockArrowRight className="size-4 scale-x-[-1]" /> : <ArrowLeft className="size-4" />}</span></button>} /><TooltipContent className={historyActionMenu === "backward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "backward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Earlier in History · latest first · each change inverted</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "backward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "backward" ? "Loading previous query…" : "Previous query in History"}</TooltipContent></Tooltip>
            <Tooltip disableHoverablePopup={false}><TooltipTrigger render={<button type="button" onMouseEnter={() => startHistoryActionHover("forward")} onMouseLeave={stopHistoryActionHover} onClick={() => void navigateQueryHistory("forward")} aria-label="Next query in history" aria-busy={historyNavigationPending === "forward"} disabled={!historyHasNewer || historyNavigationPending !== null} className={`inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40 ${historyNavigationPending !== null ? "bg-muted text-muted-foreground" : ""}`}>{historyNavigationPending === "forward" ? <ClockArrowRight className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}</button>} /><TooltipContent className={historyActionMenu === "forward" ? "!max-w-none max-w-[min(36rem,calc(100vw-1rem))] p-2" : ""} onMouseEnter={() => { if (historyHoverTimerRef.current) clearTimeout(historyHoverTimerRef.current); }} onMouseLeave={stopHistoryActionHover}>{historyActionMenu === "forward" ? <div className="w-[min(34rem,calc(100vw-2rem))] text-background"><div className="px-1 pb-2 text-xs font-semibold">Later in History · earliest first</div><div className="max-h-64 overflow-auto">{historyActionItems.map((item) => <button type="button" key={item.historyId} onClick={() => void restoreHistoryActionItem(item.historyId)} className="block w-full border-t border-background/20 px-1 py-2 text-left text-xs hover:bg-background/10"><div className="break-all font-mono">{formatHistoryAction(item.action, "forward")}</div><div className="mt-1 opacity-70">{item.created ? new Date(item.created).toLocaleString() : ""}</div></button>)}</div></div> : historyNavigationPending === "forward" ? "Loading next query…" : "Next query in History"}</TooltipContent></Tooltip>
            </>)}
            <Tooltip><TooltipTrigger render={<button type="button" onClick={() => void refreshMaestroPage()} aria-label="Refresh current query" className="inline-flex size-9 items-center justify-center rounded-none border-0 px-2 hover:bg-accent active:bg-black/25"><RotateCw className="size-4" aria-hidden="true" /></button>} /><TooltipContent>Refresh query (check selected graph server only if not green)</TooltipContent></Tooltip>
          </ButtonGroup>

          {/* One address: [graph]@[graph server], with no gap around the at-sign. */}
          <div role="group" aria-label="Graph address: graphsite at graph server" className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
            <div className="group/graph-input flex min-w-0 max-w-3xl flex-1 items-stretch overflow-hidden bg-transparent">
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={() => void openGraphInfo()}
                aria-label="Graph info"
                className="inline-flex shrink-0 items-center justify-center px-2.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              ><Info aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{"Graph info"}</TooltipContent></Tooltip>
              <input
                id="maestro-graph-input"
                value={graphText}
                onChange={(event) => setGraphText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") applyGraphText(); }}
                placeholder="Enter graph URI"
                aria-label="Site URI"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              />
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={clearGraph}
                aria-label="Remove graph"
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-hover/graph-input:max-w-10 group-hover/graph-input:px-2.5 group-hover/graph-input:opacity-100 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
              ><X aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{"Remove graph"}</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<button
                type="button"
                onClick={applyGraphText}
                aria-label="Go"
                className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 opacity-0 transition-all duration-200 group-hover/graph-input:max-w-10 group-hover/graph-input:px-2.5 group-hover/graph-input:opacity-100 group-focus-within/graph-input:max-w-10 group-focus-within/graph-input:px-2.5 group-focus-within/graph-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 hover:bg-accent hover:text-accent-foreground"
              ><CirclePlay aria-hidden="true" className="size-4" /></button>} /><TooltipContent>{"Go"}</TooltipContent></Tooltip>
            </div>
            <Dialog open={graphInfoOpen} onOpenChange={setGraphInfoOpen}>
              <DialogContent className="max-w-md p-5">
                <DialogHeader>
                  <DialogTitle>Graph info</DialogTitle>
                  <DialogDescription className="break-all font-mono text-xs">{graphInfo.graph || "No graph URI entered"}</DialogDescription>
                </DialogHeader>
                <dl className="mt-3 flex flex-col gap-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Subjects: </dt>
                    <dd className="text-right tabular-nums">
                      {graphInfo.subjectCountLoading ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading" />
                        : graphInfo.subjectCountError ? <span role="alert" className="break-words text-xs text-destructive">{graphInfo.subjectCountError}</span>
                        : graphInfo.subjectCount !== null ? shortenCount(graphInfo.subjectCount) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Graph server(s): </dt>
                    <dd className="text-right tabular-nums">1</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{authSession?.userName ? `${authSession.userName}’s Access: ` : "Access: "}</dt>
                    <dd className="text-right">
                      {graphInfo.accessLoading ? <LoaderCircle className="size-4 animate-spin" aria-label="Testing write access" />
                        : graphInfo.access === null ? "—"
                        : <span className="font-mono">{String(graphInfo.access)}</span>}
                      {!graphInfo.accessLoading && graphInfo.accessError ? <span role="alert" className="mt-1 block break-words text-xs text-destructive">{graphInfo.accessError}</span> : null}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Access is true when a test triple of ephemeral URIs could be inserted into, then deleted from, this graph.</p>
              </DialogContent>
            </Dialog>
            <Label htmlFor="fct-endpoint" aria-label="Graph server" className="flex shrink-0 items-center border-x border-border/60 px-2 text-muted-foreground">
              <AtSign aria-hidden="true" className="size-4" />
            </Label>
            <div className="flex min-w-0 items-stretch">
              <ButtonGroup aria-label="Graph server selection, discovery, and refresh" className="group/graph-server-input max-w-full border-0 shadow-none [&>select]:min-w-0 [&>select]:flex-1 [&>select]:rounded-none [&>select]:border-0 [&>select]:bg-background [&>select]:px-2 [&>select]:py-2 [&>select]:text-sm">
                    <DropdownMenu>
                      <Tooltip><TooltipTrigger render={<DropdownMenuTrigger asChild><button
                        id="fct-endpoint"
                        type="button"
                        disabled={isCheckingEndpoints || fctEndpoints.length === 0}
                        aria-label="Choose graph server"
                        className="flex w-80 min-w-0 max-w-full items-center gap-2 rounded-none bg-transparent px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <EndpointStatusIcon status={selectedEndpointStatus} />
                        <span className="min-w-0 flex-1 truncate">{fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.label ?? (fctEndpoints.length ? "Select a graph server" : "No endpoints configured")}</span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      </button></DropdownMenuTrigger>} /><TooltipContent>{"Choose which FCT endpoint receives queries"}</TooltipContent></Tooltip>
                      <DropdownMenuContent align="start" className="z-50 w-80 max-w-[calc(100vw-2rem)]">
                        {fctEndpoints.length === 0 ? <DropdownMenuLabel>{isCheckingEndpoints ? "Loading endpoints…" : "No endpoints configured"}</DropdownMenuLabel> : [...new Set(fctEndpoints.map((endpoint) => endpoint.group || "Endpoints"))].map((group) => (
                          <Fragment key={group}>
                            <DropdownMenuLabel>{group}</DropdownMenuLabel>
                            {fctEndpoints.filter((endpoint) => (endpoint.group || "Endpoints") === group).map((endpoint) => {
                              const status = endpointStatuses[endpoint.id];
                              const statusText = status?.status != null ? `HTTP ${status.status}` : status ? status.state : "Not yet pinged";
                              return <DropdownMenuItem key={endpoint.id} onSelect={() => void chooseFctEndpoint(endpoint.id)} className="flex min-w-0 items-center gap-2">
                                <EndpointStatusIcon status={status} />
                                <span className="min-w-0 flex-1 truncate">{endpoint.label}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
                                {endpoint.id === selectedEndpointId ? <Check className="size-3.5 shrink-0" aria-label="Selected" /> : null}
                              </DropdownMenuItem>;
                            })}
                          </Fragment>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger render={
                    <Toggle
                      type="button"
                      pressed={findEndpointsEnabled}
                      onPressedChange={setFindEndpointsEnabled}
                      aria-label={findEndpointsEnabled ? "Find Graph Servers On" : "Find Graph Servers Off"}
                      className="max-w-0 shrink-0 overflow-hidden rounded-none px-0 opacity-0 transition-all duration-200 group-hover/graph-server-input:max-w-10 group-hover/graph-server-input:px-2.5 group-hover/graph-server-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 data-[state=on]:hover:bg-green-200 dark:data-[state=on]:bg-green-950 dark:data-[state=on]:text-green-300 dark:data-[state=on]:hover:bg-green-900"
                    ><Network aria-hidden="true" /></Toggle>
                  } />
                  <TooltipContent>{findEndpointsEnabled ? "Find Graph Servers On" : "Find Graph Servers Off"}</TooltipContent>
                </Tooltip>
                <Tooltip><TooltipTrigger render={<button
                  type="button"
                  onClick={() => void refreshQuery()}
                  disabled={isCheckingEndpoints || fctEndpoints.length === 0}
                  aria-label={isCheckingEndpoints ? "Checking server" : "Refresh query"}
                  className="inline-flex max-w-0 shrink-0 items-center justify-center overflow-hidden px-0 py-2 text-sm opacity-0 transition-all duration-200 hover:bg-accent group-hover/graph-server-input:max-w-10 group-hover/graph-server-input:px-2.5 group-hover/graph-server-input:opacity-100 focus-visible:max-w-10 focus-visible:px-2.5 focus-visible:opacity-100 disabled:opacity-50"
                ><RefreshCw aria-hidden="true" className={`size-4 ${isCheckingEndpoints ? "animate-spin" : ""}`} /></button>} /><TooltipContent>{isCheckingEndpoints ? "Checking selected server…" : "Refresh the query"}</TooltipContent></Tooltip>
              </ButtonGroup>
                  {isCheckingEndpoints && (
                    <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                      <span className="sr-only">{fctEndpoints.length === 0 ? "Loading graph servers" : "Updating graph servers"}</span>
                      {fctEndpoints.length === 0 ? "Loading graph servers…" : `Updating… ${endpointChecksCompleted}/${endpointChecksTotal}`}
                    </span>
                  )}
            </div>
          </div>
          <div className="shrink-0">
        <Tabs value={workspaceTab} onValueChange={(tab) => { if (tab === "browse" || tab === "view" || tab === "analyze") { setWorkspaceTab(tab); if (tab !== "browse") setCentralTab("results"); } }} className="shrink-0" aria-label="Maestro ribbon">
          <TabsList aria-label="Maestro ribbon tabs">
            <TabsTrigger value="browse" className="cursor-pointer">Browse</TabsTrigger>
            <TabsTrigger value="view" className="cursor-pointer">View</TabsTrigger>
            <TabsTrigger value="analyze" className="cursor-pointer">Analyze</TabsTrigger>
            <Tooltip><TooltipTrigger render={<TabsTrigger value="publish" disabled className="cursor-pointer">Publish</TabsTrigger>} /><TooltipContent>{"Coming soon"}</TooltipContent></Tooltip>
          </TabsList>
        </Tabs>
          </div>
        </div>
        {authSession && (
        <Tooltip>
          <TooltipTrigger render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}
              onClick={async () => {
                if (isQueryBookmarked) {
                  try {
                    const response = await fetch("/proxy/api/query-favorites", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("query-bookmark", "RemoveBookmarkHash") },
                      body: JSON.stringify({ action: "unbookmark", queryXml, historyId: matchingBookmarkId || historyBookmarkId || undefined }),
                      cache: "no-store",
                    });
                    const payload = await response.json() as { removed?: boolean; error?: string };
                    if (!response.ok || !payload.removed) throw new Error(payload.error ?? `HTTP ${response.status}`);
                    setIsQueryBookmarked(false);
                    setMatchingBookmarkId("");
                    setBookmarkCheckRevision((revision) => revision + 1);
                    toast.add({ title: "Bookmark removed", description: "The query hash was removed from the bookmark in your personal RDF store.", type: "success" });
                  } catch (error) {
                    toast.add({ title: "Could not remove bookmark", description: error instanceof Error ? error.message : "The bookmark hash could not be removed.", type: "error" });
                  }
                  return;
                }
                // Wait until the queued visit write has finished before opening
                // metadata for the current query. Otherwise a fast click after
                // editing can race the visit and leave the dialog at "Saved query".
                await historyWriteQueueRef.current;
                let currentHistoryId = historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : "";
                if (!currentHistoryId && historyBookmarkId && historyVisitQueryRef.current === queryXml) currentHistoryId = historyBookmarkId;
                const metadataId = currentHistoryId || matchingBookmarkId;
                setBookmarkTitle(metadataId ? metadataId.slice(metadataId.lastIndexOf("#") + 1) : "");
                setBookmarkDescription("");
                setBookmarkTags("");
                setBookmarkTagVocabulary("skos");
                if (metadataId) {
                  try {
                    const response = await fetch("/proxy/api/query-favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", historyId: metadataId }), cache: "no-store" });
                    const payload = await response.json() as { found?: boolean; title?: string; description?: string; tags?: string[]; tagVocabulary?: "skos" | "dcterms" | "scot"; error?: string };
                    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                    if (payload.found) {
                      setBookmarkTitle(payload.title || metadataId.slice(metadataId.lastIndexOf("#") + 1));
                      setBookmarkDescription(payload.description ?? "");
                      setBookmarkTags((payload.tags ?? []).join(", "));
                      setBookmarkTagVocabulary(payload.tagVocabulary ?? "skos");
                    }
                  } catch (error) {
                    toast.add({ title: "Could not load bookmark metadata", description: error instanceof Error ? error.message : "The generated name is available to edit.", type: "error" });
                  }
                }
                setBookmarkDialogOpen(true);
              }}
            ><Bookmark aria-hidden="true" className={isQueryBookmarked ? "fill-current text-amber-500" : ""} /></Button>
          } />
          <TooltipContent>{isQueryBookmarked ? "Remove this query bookmark" : "Bookmark this query"}</TooltipContent>
        </Tooltip>
        )}
        <Dialog open={bookmarkDialogOpen} onOpenChange={(open) => { if (!bookmarkSaving) setBookmarkDialogOpen(open); }}>
            <DialogContent className="max-w-lg p-5" showCloseButton={false}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <DialogHeader>
                  <DialogTitle id="maestro-bookmark-dialog-title">Edit History bookmark</DialogTitle>
                  <DialogDescription>Edit the title, description, and optional tags for this History item.</DialogDescription>
                </DialogHeader>
                <Button type="button" variant="ghost" size="icon" aria-label="Close bookmark dialog" disabled={bookmarkSaving} onClick={() => setBookmarkDialogOpen(false)}><X className="size-4" /></Button>
              </div>
              <form className="flex flex-col gap-4" onSubmit={async (event) => {
                event.preventDefault();
                setBookmarkSaving(true);
                try {
                  // Serialize against pending query visits so a save never races
                  // the RDF insert for the current query's History item.
                  await historyWriteQueueRef.current;
                  let currentHistoryId = historyVisitQueryRef.current === queryXml ? historyVisitIdRef.current : "";
                  if (!currentHistoryId && historyBookmarkId && historyVisitQueryRef.current === queryXml) currentHistoryId = historyBookmarkId;
                  const targetHistoryId = currentHistoryId || matchingBookmarkId;
                  if (!targetHistoryId) throw new Error("The current query's History item could not be resolved. Please wait for History to synchronize and retry.");
                  const tags = bookmarkTags.split(/[,;\n]/u).map((tag) => tag.trim()).filter(Boolean);
                  const response = await fetch("/proxy/api/query-favorites", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "update", historyId: targetHistoryId, title: bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1), description: bookmarkDescription.trim(), tags, tagVocabulary: bookmarkTagVocabulary, queryXml: serializeFctQuery(queryTree), stateUrl: window.location.href }),
                  });
                  const payload = await response.json() as { error?: string; namespaces?: unknown; historyId?: string; shareUrl?: string };
                  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                  if (payload.namespaces) rememberNamespaceMetadata(payload.namespaces);
                  setIsQueryBookmarked(true);
                  setMatchingBookmarkId(payload.historyId || matchingBookmarkId || historyBookmarkId);
                  setBookmarkCheckRevision((revision) => revision + 1);
                  const shareUrl = payload.shareUrl;
                  const savedAt = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
                  const savedName = bookmarkTitle.trim() || targetHistoryId.slice(targetHistoryId.lastIndexOf("#") + 1);
                  toast.add({
                    title: "Bookmark saved",
                    description: (
                      <div className="flex min-w-0 flex-col gap-1">
                        <div><span className="font-medium">Name:</span> {savedName}</div>
                        <div><span className="font-medium">Date:</span> {savedAt}</div>
                        {shareUrl && <div className="min-w-0"><span className="font-medium">Link:</span> <a href={shareUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">Open bookmark</a></div>}
                      </div>
                    ),
                    type: "success",
                  });
                  setBookmarkDialogOpen(false);
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Could not save query bookmark.";
                  toast.add({ title: "Could not save bookmark", description: message, type: "error" });
                } finally {
                  setBookmarkSaving(false);
                }
              }}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-title">Title</Label>
                  <input id="maestro-bookmark-title" ref={bookmarkTitleInputRef} value={bookmarkTitle} onChange={(event) => setBookmarkTitle(event.target.value)} maxLength={300} required className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-description">Description</Label>
                  <textarea id="maestro-bookmark-description" value={bookmarkDescription} onChange={(event) => setBookmarkDescription(event.target.value)} maxLength={5000} rows={3} placeholder="Describe what this query finds or why you saved it" className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-tags">Tags</Label>
                  <input id="maestro-bookmark-tags" value={bookmarkTags} onChange={(event) => setBookmarkTags(event.target.value)} maxLength={2000} placeholder="linked data, publications, people" className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <p className="text-xs text-muted-foreground">Separate tags with commas, semicolons, or new lines.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="maestro-bookmark-tag-vocabulary">Tag vocabulary</Label>
                  <select id="maestro-bookmark-tag-vocabulary" value={bookmarkTagVocabulary} onChange={(event) => setBookmarkTagVocabulary(event.target.value as "skos" | "dcterms" | "scot")} className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="skos">SKOS concept — skos:Concept / skos:prefLabel</option>
                    <option value="dcterms">Dublin Core subject — dcterms:subject literal</option>
                    <option value="scot">SCOT tag — scot:Tag / scot:has_tag</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" disabled={bookmarkSaving} onClick={() => setBookmarkDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={bookmarkSaving}>{bookmarkSaving ? "Updating…" : "Update bookmark"}</Button>
                </div>
              </form>
            </DialogContent>
        </Dialog>
        <Tooltip>
          <TooltipTrigger render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy share link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setShareLinkCopied(true);
                  toast.add({ title: "Share link copied", description: "The query URL is on your clipboard.", type: "success" });
                  window.setTimeout(() => setShareLinkCopied(false), 1800);
                } catch {
                  setShareLinkCopied(false);
                  toast.add({ title: "Could not copy share link", description: "The browser denied clipboard access.", type: "error" });
                }
              }}
            ><Link aria-hidden="true" /></Button>
          } />
          <TooltipContent>{shareLinkCopied ? "Share link copied" : "Copy share link"}</TooltipContent>
        </Tooltip>
        {authSession ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Logged in as ${authSession.userName || "User"}`}
                className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-9 ring-1 ring-border hover:ring-primary transition-all">
                  {authSession.avatarUrl && (
                    <AvatarImage src={authSession.avatarUrl} alt={authSession.userName || "User avatar"} />
                  )}
                  <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs uppercase">
                    {(authSession.userName || "U")[0]}
                  </AvatarFallback>
                  <AvatarBadge className="bg-emerald-500 ring-2 ring-background">
                    <span className="sr-only">Logged in</span>
                  </AvatarBadge>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      {authSession.avatarUrl && (
                        <AvatarImage src={authSession.avatarUrl} alt={authSession.userName || "User"} />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs uppercase">
                        {(authSession.userName || "U")[0]}
                      </AvatarFallback>
                      <AvatarBadge className="bg-emerald-500 ring-2 ring-background">
                        <span className="sr-only">Logged in</span>
                      </AvatarBadge>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{authSession.userName || "Personal Account"}</p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-muted-foreground uppercase font-mono font-medium tracking-wide">
                          Connected
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs leading-none text-muted-foreground truncate" title={authSession.graphPrefix}>
                    {authSession.graphPrefix}
                  </p>
                  <span className="inline-block text-[10px] font-mono uppercase bg-muted px-1.5 py-0.5 rounded w-fit text-muted-foreground">
                    {authSession.authType}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setLoginDialogOpen(true)}
                className="cursor-pointer gap-2"
              >
                <KeyRound className="size-4" />
                <span>Connection settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await clearPersonalAuthSession();
                  setAuthSession(null);
                  setAuthRestoreIssue(false);
                  // Back to a plain, personal-store-free page: drop History tracking and reload the public Datasites list.
                  historyVisitQueryRef.current = "";
                  historyVisitIdRef.current = "";
                  pendingHistoryVisitRef.current = null;
                  setHistoryBookmarkId("");
                  setEndpointReloadRevision((r) => r + 1);
                  toast.add({
                    title: "Logged out",
                    description: "Personal graph server session cleared.",
                    type: "info",
                  });
                  setBookmarkCheckRevision((r) => r + 1);
                }}
                className="cursor-pointer text-destructive focus:text-destructive gap-2"
              >
                <LogOut className="size-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger render={
              <button
                type="button"
                aria-label="Log in to personal graph server"
                onClick={() => setLoginDialogOpen(true)}
                className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className={`size-9 ring-1 ${authRestoreIssue ? "ring-destructive" : "ring-border"} hover:ring-primary transition-all`}>
                  <AvatarFallback className="bg-muted text-muted-foreground hover:text-foreground">
                    <User className="size-4" aria-hidden="true" />
                  </AvatarFallback>
                  {authRestoreIssue && <AvatarBadge className="bg-destructive text-destructive-foreground ring-2 ring-background"><span className="text-xs font-bold">!</span></AvatarBadge>}
                </Avatar>
              </button>
            } />
            <TooltipContent>{authRestoreIssue ? "Your previous personal graph server login could not be restored. Please log in again." : "Log in to personal graph server"}</TooltipContent>
          </Tooltip>
        )}

        <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
          <DialogContent className="max-w-lg p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <DialogHeader>
                <DialogTitle id="personal-server-login-title">Personal Graph Server</DialogTitle>
                <DialogDescription>
                  Authenticate to your personal Virtuoso SPARQL server for bookmarks, history, and queries.
                </DialogDescription>
              </DialogHeader>
              <Button type="button" variant="ghost" size="icon" aria-label="Close dialog" onClick={() => setLoginDialogOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <form onSubmit={handleLoginSubmit} autoComplete="on" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="personal-graph-store">Personal Graph Store (SPARQL endpoint)</Label>
                <Input
                  id="personal-graph-store"
                  name="graph_store"
                  type="url"
                  required
                  value={loginGraphStore}
                  onChange={(e) => setLoginGraphStore(e.target.value)}
                  placeholder="http://demo.openlinksw.com/sparql"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">Enter your /sparql endpoint. Maestro reads from it and switches to /sparql-auth automatically for writes.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="personal-graph-prefix">Personal Graph Prefix</Label>
                <Input
                  id="personal-graph-prefix"
                  name="graph_prefix"
                  type="url"
                  required
                  value={loginGraphPrefix}
                  onChange={(e) => setLoginGraphPrefix(e.target.value)}
                  placeholder="http://demo.openlinksw.com/ods/home/acme"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  History graph: <span className="font-mono">{loginGraphPrefix ? graphForPrefix(loginGraphPrefix) : "USER_SITE/query"}</span>
                </p>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                <Label>Authentication Method</Label>
                <Tabs value={loginTab} onValueChange={(val) => setLoginTab(val as AuthType)} className="w-full">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="sparql-auth">sparql-auth</TabsTrigger>
                    <TabsTrigger value="sparql-oauth">sparql-oauth</TabsTrigger>
                    <TabsTrigger value="sparql-webid">sparql-webid</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sparql-auth" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="personal-username">Username</Label>
                      <Input
                        id="personal-username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        placeholder="acme"
                        required={loginTab === "sparql-auth"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="personal-password">Password</Label>
                      <div className="relative">
                        <Input
                          id="personal-password"
                          name="password"
                          type={loginShowPassword ? "text" : "password"}
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="••••••••"
                          required={loginTab === "sparql-auth"}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setLoginShowPassword((shown) => !shown)}
                          aria-label={loginShowPassword ? "Hide password" : "Show password"}
                          aria-pressed={loginShowPassword}
                          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {loginShowPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="sparql-oauth" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="oauth-token">Bearer / OAuth Access Token</Label>
                      <Input
                        id="oauth-token"
                        name="oauth_token"
                        type="password"
                        autoComplete="off"
                        value={loginOauthToken}
                        onChange={(e) => setLoginOauthToken(e.target.value)}
                        placeholder="Bearer token"
                        required={loginTab === "sparql-oauth"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="oauth-profile-url">OpenID Profile / UserInfo URL (optional)</Label>
                        <button
                          type="button"
                          onClick={handleFetchProfile}
                          disabled={isFetchingAvatar || !loginOauthProfileUrl}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          {isFetchingAvatar ? "Fetching…" : "Grab Avatar & Name"}
                        </button>
                      </div>
                      <Input
                        id="oauth-profile-url"
                        name="oauth_profile_url"
                        type="url"
                        autoComplete="url"
                        value={loginOauthProfileUrl}
                        onChange={(e) => setLoginOauthProfileUrl(e.target.value)}
                        placeholder="https://openid.example.com/userinfo"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="oauth-username">User / Display Name</Label>
                      <Input
                        id="oauth-username"
                        name="oauth_username"
                        type="text"
                        autoComplete="name"
                        value={loginOauthUserName}
                        onChange={(e) => setLoginOauthUserName(e.target.value)}
                        placeholder="e.g. John Doe"
                      />
                    </div>
                    {fetchedAvatarUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-md border bg-muted/40">
                        <Avatar size="sm">
                          <AvatarImage src={fetchedAvatarUrl} alt="Avatar" />
                          <AvatarFallback className="text-xs uppercase">
                            {(loginOauthUserName || "U")[0]}
                          </AvatarFallback>
                          <AvatarBadge className="bg-emerald-500 ring-2 ring-background" />
                        </Avatar>
                        <span className="text-xs text-muted-foreground">Grabbed OpenID avatar</span>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sparql-webid" className="flex flex-col gap-3 mt-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="webid-uri">WebID URI</Label>
                        <button
                          type="button"
                          onClick={handleFetchProfile}
                          disabled={isFetchingAvatar || !loginWebIdUri}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          {isFetchingAvatar ? "Fetching…" : "Grab Avatar & Name"}
                        </button>
                      </div>
                      <Input
                        id="webid-uri"
                        name="webid_uri"
                        type="url"
                        autoComplete="url"
                        value={loginWebIdUri}
                        onChange={(e) => setLoginWebIdUri(e.target.value)}
                        placeholder="http://id.myopenlink.net/dataspace/person/dba#this"
                        required={loginTab === "sparql-webid"}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="webid-token">WebID Bearer Token (optional)</Label>
                      <Input
                        id="webid-token"
                        name="webid_token"
                        type="password"
                        autoComplete="off"
                        value={loginOauthToken}
                        onChange={(e) => setLoginOauthToken(e.target.value)}
                        placeholder="Optional bearer token if required by endpoint"
                      />
                    </div>
                    {fetchedAvatarUrl && (
                      <div className="flex items-center gap-3 p-2 rounded-md border bg-muted/40">
                        <Avatar size="sm">
                          <AvatarImage src={fetchedAvatarUrl} alt="WebID Avatar" />
                          <AvatarFallback className="text-xs uppercase">
                            {(loginWebIdUri.split("#").pop() || "U")[0]}
                          </AvatarFallback>
                          <AvatarBadge className="bg-emerald-500 ring-2 ring-background" />
                        </Avatar>
                        <span className="text-xs text-muted-foreground">Grabbed WebID avatar</span>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>

              <p className="pt-1 text-xs text-muted-foreground">Maestro keeps you signed in across browser and server restarts until you log out, subject to your graph server's credential validity.</p>

              {loginError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                  {loginError}
                </div>
              )}

              <div className="flex justify-between items-center pt-2">
                <Button type="button" variant="outline" disabled={loginTesting} onClick={() => setLoginDialogOpen(false)}>
                  Cancel
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={loginTesting} onClick={handleTestConnection}>
                    {loginTesting ? "Testing…" : "Test Connection"}
                  </Button>
                  <Button type="submit" disabled={loginTesting}>
                    {loginTesting ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Sheet open={controlsSheetOpen} onOpenChange={(open) => {
          if (open) {
            // Each Sheet opening begins with both settings groups collapsed.
            setTimeoutEditorOpen(false);
            setPanelLimitsOpen(false);
          }
          setControlsSheetOpen(open);
        }}>
          <SheetTrigger
            render={
              <Button variant="outline" className="inline-flex shrink-0 items-center gap-2" aria-label="Open controls">
                <Settings className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <SheetContent side="right" className="w-[min(92vw,28rem)] overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Maestro controls</SheetTitle>
              <SheetDescription>Query behavior, appearance, and graph server settings.</SheetDescription>
              {authSession && <p className="mt-1 break-all text-xs text-muted-foreground">Using personal: <span className="font-medium text-foreground">{personalSparqlEndpoint || "Not configured"}</span></p>}
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4">

              {authSession && (
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <Label>History</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="outline" disabled={isLoadingHistoryQuery} onClick={() => void loadHistoryQuery()}>{isLoadingHistoryQuery ? "Loading…" : "Show"}</Button>} />
                    <TooltipContent className="z-[100]">History — show Query History Visit records</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="outline" disabled={isLoadingHistoryQuery} onClick={() => void loadHistoryQuery(true)}>{isLoadingHistoryQuery ? "Loading…" : "Show Bookmarks"}</Button>} />
                    <TooltipContent className="z-[100]">Bookmarks — show Bookmark records with a schema:identifier hash</TooltipContent>
                  </Tooltip>
                  <Button type="button" variant="outline" disabled={!historyBookmarkId || isDeletingCurrentHistory || isDeletingHistory} onClick={() => void deleteCurrentQueryHistory()}>{isDeletingCurrentHistory ? "Deleting…" : "Delete"}</Button>
                  <Button type="button" variant="outline" disabled={isDeletingHistory} onClick={() => void deleteBookmarks()}>{isDeletingHistory ? "Deleting…" : "Delete Bookmarks"}</Button>
                  <Button type="button" variant="outline" disabled={isExportingBookmarks || isImportingBookmarks} onClick={() => void exportBookmarks()}><Download className="mr-1 size-4" aria-hidden="true" />{isExportingBookmarks ? "Exporting…" : "Export Bookmarks"}</Button>
                  <Button type="button" variant="outline" disabled={isImportingBookmarks || isExportingBookmarks} onClick={() => bookmarkImportFileRef.current?.click()}><Upload className="mr-1 size-4" aria-hidden="true" />{isImportingBookmarks ? "Importing…" : "Import Bookmarks"}</Button>
                  <input ref={bookmarkImportFileRef} type="file" accept=".json,application/json" className="hidden" aria-label="Choose Bookmarks JSON export" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBookmarks(file); event.target.value = ""; }} />
                  <Button type="button" variant="destructive" disabled={isDeletingCurrentHistory || isDeletingHistory} onClick={() => setDeleteHistoryDialogOpen(true)}>Delete All</Button>
                </div>
              </div>
              )}

              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="maestro-tutorial-mode">Tutorial mode</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Preview facets and records on hover without changing the query.</p>
                </div>
                <Switch id="maestro-tutorial-mode" checked={tutorialMode} onCheckedChange={(enabled) => { setTutorialMode(enabled); if (!enabled) clearTutorialPreview(); }} aria-label="Tutorial mode" />
              </div>
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="maestro-browser-logging">Logging</Label>
                    <p className="mt-1 text-xs text-muted-foreground">Send proxy requests, responses and diagnostic errors to the browser Console.</p>
                  </div>
                  <Switch id="maestro-browser-logging" checked={browserLogging} onCheckedChange={setBrowserLogging} aria-label="Browser Console logging" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="maestro-browser-log-level">Log level</Label>
                  <select id="maestro-browser-log-level" value={browserLogLevel} disabled={!browserLogging}
                    className="rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                    onChange={(event) => setBrowserLogLevel(event.target.value as BrowserLogLevel)}>
                    {(["trace", "debug", "info", "warn", "error", "fatal"] as BrowserLogLevel[]).map((level) =>
                      <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>
                    )}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <Label htmlFor="maestro-prefix-source">Namespace prefixes (CURIEs shown for IRIs without labels)</Label>
                <select id="maestro-prefix-source" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={prefixSource}
                  onChange={(event) => {
                    const next = event.target.value as "prefixcc" | "zazuko" | "builtin";
                    setPrefixSource(next);
                    void maestroStorageSet("maestro-namespace-prefix-source", next);
                  }}>
                  <option value="prefixcc">prefix.cc community list (falls back to Zazuko over HTTPS)</option>
                  <option value="zazuko">Zazuko curated list</option>
                  <option value="builtin">Built-in list only</option>
                </select>
                <p className="text-xs text-muted-foreground">{prefixStatus}</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <Label>Appearance</Label>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
                <div className="min-w-0">
                  <Label>Clear cache</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Remove all localStorage data saved by this site and reload Maestro.</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Estimated localStorage usage: <span className="font-medium text-foreground">{localStorageUsageBytes === null ? "Unavailable" : formatStorageBytes(localStorageUsageBytes)}</span>
                    <span className="block">Approximate key/value size; browser storage overhead is not included.</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        setLocalStorageUsageBytes(getLocalStorageUsageBytes());
                      } catch {
                        setLocalStorageUsageBytes(null);
                      }
                    }}
                  >Refresh size</Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="shrink-0"
                    onClick={() => setClearCacheDialogOpen(true)}
                  >Clear Cache</Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label>Auto-configure</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Clear learned facet usage, recorded exclude flags, and saved candidates.</p>
                </div>
                <Tooltip><TooltipTrigger render={<button
                  type="button"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(FACET_ADD_COUNTS_STORAGE_KEY);
                      window.localStorage.removeItem(FACET_AUTOFILL_STORAGE_KEY);
                      window.localStorage.removeItem(AUTO_CONFIGURED_FACETS_STORAGE_KEY);
                      window.localStorage.removeItem(FACET_EXCLUDE_STORAGE_KEY);
                      setAutoConfiguredFacetKeys(new Set());
                      setFacetAutofillCandidates({ property: [], "property-in": [] });
                      setFacetUsageRevision((revision) => revision + 1);
                      toast.add({ title: "Auto-configure reset", description: "Learned facet usage and saved candidates were cleared.", type: "success" });
                    } catch {
                      toast.add({ title: "Auto-configure could not be reset", description: "Browser storage is unavailable.", type: "error" });
                    }
                  }}
                  className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >Reset Auto</button>} /><TooltipContent>{"Reset Auto-configure learning history and saved candidates"}</TooltipContent></Tooltip>
              </div>
              <Collapsible open={timeoutEditorOpen} onOpenChange={setTimeoutEditorOpen} className="rounded-md border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-accent/40">
                  <Label className="cursor-pointer">Query timeouts</Label>
                  {timeoutEditorOpen ? <ChevronsDownUp className="size-4 text-muted-foreground" /> : <ChevronsUpDown className="size-4 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 border-t px-3 pb-4 pt-3">
                  <p className="text-xs text-muted-foreground">Per-widget upstream time limits. 0 uses the existing query/server default. Saved in IndexedDB.</p>
                  {MAESTRO_TIMEOUT_CATEGORIES.map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`widget-timeout-${key}`} className="text-xs">{label}</Label>
                        <output htmlFor={`widget-timeout-${key}`} className="text-xs tabular-nums text-muted-foreground">{widgetTimeouts[key] ? `${widgetTimeouts[key]}s` : "Default"}</output>
                      </div>
                      <Slider id={`widget-timeout-${key}`} aria-label={`${label} query timeout in seconds`} min={0} max={120} step={5}
                        value={[widgetTimeouts[key]]}
                        onValueChange={(values) => setWidgetTimeouts((current) => ({ ...current, [key]: values[0] ?? 0 }))}
                        onValueCommit={(values) => changeWidgetTimeout(key, values[0] ?? 0)} />
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
              <Collapsible open={panelLimitsOpen} onOpenChange={setPanelLimitsOpen} className="rounded-md border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-accent/40">
                  <Label className="cursor-pointer">Panel limits</Label>
                  {panelLimitsOpen ? <ChevronsDownUp className="size-4 text-muted-foreground" /> : <ChevronsUpDown className="size-4 text-muted-foreground" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 border-t px-3 pb-4 pt-3">
                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground">Left panel</h3>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="left-panel-limit">Left panel limit</Label>
                  <p className="mt-1 text-xs text-muted-foreground">LIMIT for Categories, Personal facets, Graphs, and the Properties and Roles configure lists.</p>
                </div>
                <select
                  id="left-panel-limit"
                  aria-label="Left panel widget limit"
                  value={pendingLeftPanelLimit ?? leftPanelLimit}
                  onChange={(event) => {
                    const limit = Number(event.currentTarget.value);
                    if (!RESULTS_BATCH_SIZE_OPTIONS.includes(limit as typeof RESULTS_BATCH_SIZE_OPTIONS[number])) return;
                    maestroStorageSet(LEFT_PANEL_LIMIT_STORAGE_KEY, String(limit));
                    setPendingLeftPanelLimit(limit);
                  }}
                  className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                </select>
              </div>
                  </section>
                  <section className="space-y-3 border-t pt-3">
                    <h3 className="text-xs font-semibold text-muted-foreground">Center panel</h3>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="center-results-limit">Results batch LIMIT</Label>
                    <select id="center-results-limit" aria-label="Center Results server batch limit" value={pendingCenterBatchLimit ?? resultsBatchSize}
                      onChange={(event) => {
                        const limit = Number(event.currentTarget.value);
                        if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === limit)) return;
                        maestroStorageSet(CENTER_PANEL_LIMIT_STORAGE_KEY, String(limit));
                        setPendingCenterBatchLimit(limit);
                      }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="center-group-limit">Groups batch LIMIT</Label>
                    <select id="center-group-limit" aria-label="Center Groups server batch limit" value={pendingGroupsBatchLimit ?? groupBatchSize}
                      onChange={(event) => {
                        const limit = Number(event.currentTarget.value);
                        if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === limit)) return;
                        maestroStorageSet(CENTER_GROUP_LIMIT_STORAGE_KEY, String(limit));
                        setPendingGroupsBatchLimit(limit);
                      }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">Server-side LIMITs; the Results and Groups page-size selector still controls visible pages. Saved in IndexedDB.</p>
                  </section>
                  <section className="space-y-3 border-t pt-3">
                    <h3 className="text-xs font-semibold text-muted-foreground">Right panel</h3>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="right-describe-limit">Record SELECT LIMIT</Label>
                    <select id="right-describe-limit" aria-label="Right Record DESCRIBE query limit" value={pendingRecordDescriptionLimit ?? recordDescriptionQueryLimit}
                      onChange={(event) => {
                        const limit = Number(event.currentTarget.value);
                        if (!RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS.some((size) => size === limit)) return;
                        maestroStorageSet(RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY, String(limit));
                        setPendingRecordDescriptionLimit(limit);
                      }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="right-record-page-limit">Record properties per page</Label>
                    <select id="right-record-page-limit" aria-label="Right Record table properties per page" value={recordDescriptionPageSize}
                      onChange={(event) => {
                        const limit = Number(event.currentTarget.value);
                        if (!RIGHT_PANEL_PAGE_LIMIT_OPTIONS.some((size) => size === limit)) return;
                        maestroStorageSet(RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY, String(limit));
                        setRecordDescriptionPageSize(limit); setRecordDescriptionPage(0);
                      }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {RIGHT_PANEL_PAGE_LIMIT_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">SELECT controls the shared Default/formatter snapshot and loads URI labels. Table paging is local. Saved in IndexedDB.</p>
                  </section>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="fct-query-same-as">Aliases</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Include owl:sameAs relationships.</p>
                </div>
                <Switch
                  id="fct-query-same-as"
                  checked={queryTree.attributes["same-as"] === "yes"}
                  onCheckedChange={(checked) => setQueryAttribute("same-as", checked ? "yes" : "no")}
                  aria-label="Include owl:sameAs relationships"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="fct-query-order-results">Order results</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Add ORDER clause to queries. Note: Turning this on will increase query time.</p>
                </div>
                <Switch
                  id="fct-query-order-results"
                  checked={orderResults}
                  onCheckedChange={(checked) => {
                    setOrderResults(checked);
                    maestroStorageSet("maestro-order-results", checked ? "yes" : "no");
                    if (queryTreeHeightDbRef.current) {
                      try {
                        const tx = queryTreeHeightDbRef.current.transaction("preferences", "readwrite");
                        tx.objectStore("preferences").put(checked, "order-results-enabled");
                      } catch { /* non-fatal */ }
                    }
                    setQueryAttribute("order", checked ? "yes" : "no");
                  }}
                  aria-label="Order results"
                />
              </div>
              {authSession && (
              <button
                type="button"
                onClick={() => {
                  setIsRdfLoaderOpen(true);
                    setControlsSheetOpen(false);
                }}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
              >RDF Loader</button>
              )}

            </div>
          </SheetContent>
        </Sheet>
      </header>



      <Dialog open={isRdfLoaderOpen} onOpenChange={(open) => { if (!isRdfLoading) setIsRdfLoaderOpen(open); }}>
        <DialogContent aria-labelledby="rdf-loader-title" className="w-full max-w-xl p-5">
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
                try {
                  const response = await fetch("/proxy/api/rdf-loader", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...proxyDebugHeaders("rdf-loader", "RdfLoader") },
                    body: JSON.stringify({
                      sourceUrl: rdfSourceUrl.trim(),
                      targetGraph: rdfTargetGraph.trim(),
                    }),
                  });
                  const data = await response.json();
                  rememberShortforms(data?.shortforms);
                  if (!response.ok)
                    throw new Error(data.error || "RDF load failed.");
                  toast.add({ title: "RDF load completed", description: data.message || "The RDF document was loaded into the target graph.", type: "success" });
                } catch (error) {
                  toast.add({ title: "RDF load failed", description: error instanceof Error ? error.message : "RDF load failed.", type: "error" });
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
        </DialogContent>
      </Dialog>

      {endpointMenuError && (
        <p role="alert" className="border-b px-4 py-1.5 text-xs text-destructive">
          <>{endpointMenuError}{endpointMenuError.includes("Could not load graphs from the personal SPARQL store") && <> Check that your <a href={personalSparqlEndpoint || undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">personal graph server</a> is online.</>}</>
        </p>
      )}

      <div className="shrink-0">
        {workspaceTab === "browse" || workspaceTab === "view" ? <nav aria-label="Navigation breadcrumbs" className="flex min-h-14 flex-wrap items-start gap-2 bg-background px-4 pt-2 pb-7">
        {renderRootBreadcrumb()}
        {tutorialBreadcrumbPath.map((crumb, index) => renderPathBreadcrumb(crumb, index))}
        </nav> : <div className="flex min-h-[78px] flex-wrap items-center gap-3 border-b bg-background px-4 py-2" role="toolbar" aria-label="Analyze presentations">
          {analysisDefinitions.map((definition) => {
            const active = selectedAnalysisUri === definition.uri && !analyzeHistogram;
            const Icon = definition.icon === "table-properties" ? TableProperties : Table2;
            return <Tooltip key={definition.uri} disableHoverablePopup={false}>
              <TooltipTrigger render={<button type="button" onClick={() => { setSelectedAnalysisUri(definition.uri); setAnalyzeHistogram(false); }} aria-pressed={active && !analyzeHistogram}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${active ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className={`size-7 ${active ? "stroke-[2.5]" : ""}`} aria-hidden="true"/>{definition.label}
              </button>} />
              <TooltipContent side="bottom" className="z-[100] w-64 p-3" >
                <div className="mb-2 font-semibold">{definition.label} preview</div>
                <div className="rounded border bg-background p-2 text-foreground">
                  <table className="w-full border-collapse text-[10px]"><thead><tr><th className="border p-1 text-left">Result</th><th className="border p-1 text-left">{definition.icon === "table-properties" ? "Value A" : (tutorialBreadcrumbPath[0] ? toLabel(tutorialBreadcrumbPath[0].uri, "Property") : "Property")}</th><th className="border p-1 text-left">{definition.icon === "table-properties" ? "Value B" : "Property 2"}</th></tr></thead><tbody>
                  <tr><td className="border p-1">{visibleResultsPage[0]?.title ?? "Resource"}</td><td className="border p-1">{definition.icon === "table-properties" ? "✓" : "Value"}</td><td className="border p-1">—</td></tr></tbody></table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Choose to fill the Analyze canvas using its SHACL-discovered XSLT.</p>
              </TooltipContent>
            </Tooltip>;
          })}
          {analysisDefinitions.some((definition) => definition.uri.includes("compare-table")) && (
            <Tooltip>
              <TooltipTrigger render={<button type="button" aria-pressed={isCompareAnalysis && analyzeHistogram}
                onClick={() => { const compare = analysisDefinitions.find((definition) => definition.uri.includes("compare-table")); if (compare) { setSelectedAnalysisUri(compare.uri); setAnalyzeHistogram(true); } }}
                className={`flex min-w-24 cursor-pointer flex-col items-center gap-1 rounded-md px-3 py-2 text-xs transition-colors ${isCompareAnalysis && analyzeHistogram ? "bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <ChartColumn className="size-7" aria-hidden="true"/>Histogram
              </button>} />
              <TooltipContent side="bottom">Count checked Compare Table cells for each column value.</TooltipContent>
            </Tooltip>
          )}
          {analysisDefinitions.length === 0 && <span className="text-sm text-muted-foreground">No analysis templates discovered. Load the updated SHACL policies into your personal graph server.</span>}
        </div>}

      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          <ResizablePanelGroup key={workspaceTab} direction="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize={25} minSize={16} className="min-w-0">
            {/* Left pane navigation uses count links while retaining the existing panes. */}
            <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r">
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
                {defaultLeftTab === "facets" ? (
                  <>
                    <ButtonGroup aria-label="Return to facets">
                      <button
  type="button"
  onClick={() => setDefaultLeftTab("personal")}
  className="inline-flex items-center gap-2 px-2 text-xs font-medium hover:bg-accent"
>
  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
  Return to Filters
</button>
                      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                      <Tooltip><TooltipTrigger render={<button
                        type="button"
                        onClick={() => setDefaultLeftTab("personal")}
                        className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                        aria-label={`Show Filters, ${personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)} facets`}
                      >
                        {personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)}
                      </button>} /><TooltipContent>{"Show Filters"}</TooltipContent></Tooltip>
                    </ButtonGroup>
                  </>
                ) : (
                  <>
                    {(isLoadingProperties && propertyFacets.length === 0) ||
                    (isLoadingRoles && roleFacets.length === 0) ? (
                      <span role="status" aria-live="polite" className="px-2 text-xs text-muted-foreground">
                        Fetching configure controls…
                      </span>
                    ) : null}
                    {(!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError) || (!isLoadingRoles && roleFacets.length === 0 && roleFacetError) ? (
                      <div role="alert" className="flex min-w-0 max-w-full flex-col gap-0.5 px-2 text-xs text-destructive">
                        {!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError ? (
                          <p className="break-words"><span className="font-medium">Properties could not be loaded:</span> {propertyFacetError}</p>
                        ) : null}
                        {!isLoadingRoles && roleFacets.length === 0 && roleFacetError ? (
                          <p className="break-words"><span className="font-medium">Roles could not be loaded:</span> {roleFacetError}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {showConfigureProperties && (
                      <ButtonGroup aria-label="Configure properties">
                        <button type="button" onClick={() => { setFocusListOrder("Properties"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="inline-flex items-center gap-1 px-2 text-xs font-medium hover:bg-accent" title="Configure Properties" aria-label="Configure Properties"><MousePointerClick className="size-3.5" aria-hidden="true" /> Properties</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Properties");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus properties, ${propertyFacets.length} properties`}
                        >{showPropertiesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading properties" role="status" /> : shortenCount(propertyFacets.length)}</button>} /><TooltipContent>{"Show Focus properties first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {showConfigureRoles && (
                      <ButtonGroup aria-label="Configure roles">
                        <button type="button" onClick={() => { setFocusListOrder("Roles"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="inline-flex items-center gap-1 px-2 text-xs font-medium hover:bg-accent" title="Configure Roles" aria-label="Configure Roles"><MousePointerClick className="size-3.5" aria-hidden="true" /> Roles</button>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Roles");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Show Focus roles, ${roleFacets.length} roles`}
                        >{showRolesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading roles" role="status" /> : shortenCount(roleFacets.length)}</button>} /><TooltipContent>{"Show Focus roles first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={runAutoConfigure}
                          className="px-2 text-xs font-medium hover:bg-accent"
                        >Auto-configure</button>} /><TooltipContent>{"Add high-frequency Properties and Roles that apply to the current query scope"}</TooltipContent></Tooltip>
                        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
                        <Tooltip><TooltipTrigger render={<button
                          type="button"
                          onClick={runAutoConfigure}
                          className="px-3 py-1.5 text-sm hover:bg-accent"
                          aria-label={`Auto-configure ${autoConfigureFacetCount} facets`}
                        >{shortenCount(autoConfigureFacetCount)}</button>} /><TooltipContent>{`${autoConfigureFacetCount} facets will be added`}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                  </>
                )}
              </div>
              <div
                className={`min-h-0 flex-1 overflow-y-auto p-3 ${defaultLeftTab === "facets" ? "" : "bg-background"}`}
                style={defaultLeftTab === "facets" ? { backgroundColor: CONFIGURE_LIST_BACKGROUND_COLOR } : undefined}
              >
                {defaultLeftTab === "facets" && (
                  <>
                    {((Object.keys(facets) as FacetName[]).filter((group) => group !== "Classes" && group !== "Graphs") as FacetName[]).sort((a, b) => {
                      const order = focusListOrder === "Properties" ? ["Properties", "Roles", "Graphs"] : ["Roles", "Properties", "Graphs"];
                      return order.indexOf(a) - order.indexOf(b);
                    }).map((group) => {
let items: { key: string; label: string; count: number; example?: FacetItem["example"] }[] =
  group === "Properties"
    ? propertyFacets.map((item) => {
        const facet = createFacetItem(
          item.uri,
          toLabel(item.uri, "Property"),
          item.count,
          item.example,
        );
        return {
          key: facet.uri,
          label: facet.label,
          count: facet.count,
          example: facet.example,
        };
      })
    : group === "Classes"
      ? classFacets.map((item) => {
          const facet = createFacetItem(
            item.uri,
            `${toLabel(item.uri, "Class")}s`,
            item.count,
          );
          return {
            key: facet.uri,
            label: facet.label,
            count: facet.count,
          };
        })
      : group === "Roles"
        ? roleFacets.map((item) => {
            const facet = createFacetItem(
              item.uri,
              toLabel(item.uri, "Role"),
              item.count,
              item.example,
            );
            return {
              key: facet.uri,
              label: facet.label,
              count: facet.count,
              example: facet.example,
            };
          })
        : group === "Graphs"
          ? graphFacets.map((item) => {
              const facet = createFacetItem(
                item.uri,
                toLabel(item.uri, "Class"),
                item.count,
              );
              return {
                key: facet.uri,
                label: facet.label,
                count: facet.count,
              };
            })
          : [];
                      // Keep checked Properties/Roles in a separate pane above
                      // pagination. Only unchecked items participate in paging;
                      // preserve query order for selected items and FCT order below.
                      const exampleForFacetItem = (key: string, fallback?: FacetItem["example"]) => {
                        if (group !== "Properties" && group !== "Roles") return fallback;
                        const selectedNode = (group === "Properties" ? activePropertyFilters : activeRoleFilters).find((node) => node.attributes.iri === key);
                        const bound = selectedNode?.children.find((child) => child.name === "value" && Boolean(child.text));
                        if (!bound?.text) return fallback;
                        const isUri = bound.attributes.datatype === "uri";
                        return { uri: bound.text, termType: isUri ? "uri" as const : "literal" as const, label: isUri ? toLabel(bound.text, "Class") : bound.text };
                      };
                      const selectedItems =
  group === "Properties" || group === "Roles"
    ? Array.from(
        group === "Properties" ? Array.from(selectedProperties).filter((key) => key !== RDF_TYPE_URI) : selectedRoles,
        (key) => {
          const facet = items.find((item) => item.key === key);
          return {
            key,
            label: facet?.label ?? toLabel(key, group === "Properties" ? "Property" : "Role"),
            count: facet?.count ?? 0,
            example: exampleForFacetItem(key, facet?.example),
          };
        },
      )
    : [];
                      const selectedKeys = new Set(selectedItems.map((item) => item.key));
                      // On the wholly unbound root, the per-candidate count
                      // probes cannot reliably suppress the returned facet
                      // enumeration. Keep the actual list from FCT instead.
                      const emptyRootFacetScope = isRootView && !queryTree.children.some((node) =>
                        (node.name === "text" && Boolean(node.text?.trim())) ||
                        ["class", "property", "property-of", "value"].includes(node.name));
                      const facetListStale = group === "Classes" ? isLoadingClasses : false;
                      const unselectedItems = items.filter((item) => {
                        if (selectedKeys.has(item.key)) return false;
                        if (group !== "Properties" && group !== "Roles") return true;
                        const countKind: DistinctCountKind = group === "Properties" ? "property" : "role";
                        const countQuery = distinctCountQueryFor(queryTree, countKind, item.key);
                        return emptyRootFacetScope || facetCandidateCounts[countQuery] !== 0;
                      });

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
                        Math.ceil(
                          (group === "Properties" || group === "Roles"
                            ? unselectedItems.length
                            : items.length) / FACET_PAGE_SIZE,
                        ),
                      );
                      const pageItems =
                        group === "Properties" || group === "Roles"
                          ? unselectedItems.slice(
                              currentPage * FACET_PAGE_SIZE,
                              (currentPage + 1) * FACET_PAGE_SIZE,
                            )
                          : group === "Classes" || group === "Graphs"
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

                      if ((group === "Properties" || group === "Roles") && items.length === 0) return null;

                      return (
                        <section
                          key={group}
                          className="mb-5"
                        >
                          <div
                            className={`group/header flex w-full items-center gap-1 rounded-t-md border-b overflow-hidden ${group === "Properties" || group === "Roles" ? "mb-2" : ""}`}
                            style={{ backgroundColor: CONFIGURE_HEADER_BACKGROUND_COLOR, borderColor: CONFIGURE_HEADER_BORDER_COLOR }}
                          >
                            <div className="min-w-0">
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-1 px-3 py-2 text-left text-white hover:brightness-90"
                                style={{ backgroundColor: CONFIGURE_HEADER_BACKGROUND_COLOR }}
                                onClick={() => setSelectedFacet(group)}
                              >
                                <IncompleteWidgetIndicator source={group === "Properties" ? "properties" : group === "Roles" ? "roles" : "graphs"} />
                                <h2 className="truncate text-sm font-semibold">{group}</h2>
                              </button>
                            </div>
                            {group === "Properties" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES)}\n<!-- FCT API option: view=properties -->`}
                                filename="properties-fct-query.xml"
                                label="View Properties widget query"
                                headerTone
                                countQuery={propertyFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "property", propertyFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES)) : undefined}
                                countFilename="properties-first-item-count.sparql"
                              />
                            )}
                            {group === "Roles" && (
                              <QueryInspectorButton
                                query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN)}\n<!-- FCT API option: view=properties-in -->`}
                                filename="roles-fct-query.xml"
                                label="View Roles widget query"
                                headerTone
                                countQuery={roleFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "role", roleFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES_IN)) : undefined}
                                countFilename="roles-first-item-count.sparql"
                              />
                            )}
                            <Tooltip><TooltipTrigger render={<span
                              className={`ml-auto shrink-0 px-2 text-xs font-normal ${(group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError) ? "text-red-100" : "text-white/90"}`}
                              aria-live="polite"
                            >
                              {(group === "Properties" && isLoadingProperties) || (group === "Classes" && isLoadingClasses) || (group === "Roles" && isLoadingRoles)
                                ? "Updating…"
                                : (group === "Properties" && propertyFacetError) || (group === "Classes" && classFacetError) || (group === "Roles" && roleFacetError)
                                  ? "Update failed"
                                  : shortenCount(group === "Properties" ? propertyFacets.length : group === "Classes" ? classFacets.length : group === "Roles" ? roleFacets.length : items.length)}
                            </span>} /><TooltipContent>
  {group === "Properties"
    ? propertyFacetError || propertyFacetWarning
    : group === "Roles"
      ? roleFacetError || roleFacetWarning
      : group === "Classes"
        ? classFacetError || classFacetWarning
        : undefined}
</TooltipContent></Tooltip>
                          </div>

                          {(group === "Properties" || group === "Roles") &&
                            selectedItems.length > 0 && (
                              <div className={`mb-2 rounded-md border border-border/70 bg-background/80 p-2 ${facetListStale ? "opacity-45" : ""}`} aria-disabled={facetListStale || undefined}>
                                <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                                <div className={PROPERTY_ROLE_ITEM_GAP_CLASS}>
                                  {selectedItems.map((item) => (
                                    <div
                                      key={item.key}
                                      className={`flex w-full min-w-0 items-start gap-2 py-[1px] ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && ((group === "Properties" && facetHoverPreview.direction === "forward") || (group === "Roles" && facetHoverPreview.direction === "reverse")) ? "!border-purple-500" : "border-transparent"}`}
                                    >
                                      <button
  type="button"
  disabled={facetListStale}
  data-excluded={isFacetExcluded(group, item.key) ? "true" : undefined}
  aria-invalid={item.count === 0 ? true : undefined}
  aria-label={`Unselect ${item.label}`}
  title={`Unselect ${item.label}`}
  onClick={(event) => {
    clearTutorialPreview();

    if (event.shiftKey) {
      handleFacetShiftClick(group, item.key, true);
    } else if (group === "Properties") {
      handlePropertyCheckboxChange(item.key, false);
    } else {
      handleRoleCheckboxChange(item.key, false);
    }
  }}
  //className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-black text-white hover:bg-gray-800 disabled:cursor-not-allowed"
  className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed"
>
  {isFacetExcluded(group, item.key) ? (
    <SquareX className="size-4 rounded-[3px] bg-black text-white overflow-hidden" aria-hidden="true" />
  ) : (
    <SquareCheck className="size-4 rounded-[3px] bg-black text-white overflow-hidden" aria-hidden="true" />
  )}
</button>
									  <div className="min-w-0 flex-1 flex flex-col items-start gap-0">
                                      {group === "Properties" ? (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "forward", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "forward"); }}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{`Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                      ) : (
                                        <Tooltip><TooltipTrigger render={<button
                                          type="button"
                                          className={`min-w-0 break-all text-sm text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : item.count === 0 ? "text-destructive" : ""}`}
                                          onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                          onMouseLeave={clearTutorialPreview}
                                          onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "reverse"); }}
                                        >
                                          {item.label}
                                          {autoConfiguredFacetKeys.has(`property-in::${item.key}`) && (
                                            <Bot className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                          )}
                                        </button>} /><TooltipContent>{`Filter by role ${item.label}`}</TooltipContent></Tooltip>
                                      )}
                                      {item.example && !(group === "Properties" ? activePropertyFilters : activeRoleFilters).some((node) => node.attributes.iri === item.key && node.children.some((child) => child.name === "value")) && <button type="button" title={item.example.label} disabled={facetListStale || item.example.termType !== "uri"} onClick={() => showClassResults(item.example!.uri, activeLeafId)} className="block break-words text-[10px] leading-4 text-muted-foreground italic hover:text-foreground hover:underline disabled:cursor-not-allowed"><em>e.g.</em> {ellipsize(item.example.label)}</button>}
									  </div>
                                      <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(item.count)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          {(group === "Properties" ||
                            group === "Classes" ||
                            group === "Roles") &&
                            (group === "Properties" || group === "Roles" ? unselectedItems.length : items.length) > FACET_PAGE_SIZE && (
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

                          <div className={group === "Properties" || group === "Roles" ? PROPERTY_ROLE_ITEM_GAP_CLASS : FACET_ITEM_GAP_CLASS}>
                            {pageItems.map((item) => {
                              const itemExample = exampleForFacetItem(item.key, item.example);
                              const countKind: DistinctCountKind | null =
                                group === "Properties" ? "property" : group === "Roles" ? "role" : group === "Classes" ? "class" : null;
                              const countQuery = countKind ? distinctCountQueryFor(queryTree, countKind, item.key) : null;
                              const isZeroCount = countQuery ? facetCandidateCounts[countQuery] === 0 : item.count === 0;
                              const isExcluded = group === "Properties" || group === "Classes" || group === "Roles"
                                ? isFacetExcluded(group, item.key)
                                : false;
                              return (
                              <div
                                key={item.key}
                                aria-disabled={facetListStale || undefined}
								onMouseEnter={() => {
  if (group === "Properties" || group === "Roles") {
    setHoveredFacetKey(item.key);
  }
}}
onMouseLeave={() => {
  if (group === "Properties" || group === "Roles") {
    setHoveredFacetKey(null);
  }
}}
                                className={`flex w-full items-start gap-2 rounded-md border px-2 ${group === "Properties" || group === "Roles" ? "py-[1px]" : "py-0.5"} text-sm hover:bg-accent/50 ${facetListStale ? "opacity-45" : ""} ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && ((group === "Properties" && facetHoverPreview.direction === "forward") || (group === "Roles" && facetHoverPreview.direction === "reverse")) ? "!border-purple-500" : "border-transparent"}`}
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
                                ) : group === "Properties" || group === "Roles" ? (
  <button
    type="button"
    disabled={facetListStale}
    aria-invalid={isZeroCount ? true : undefined}
    aria-label={`Filter by ${item.label}`}
    title={`Filter by ${item.label}`}
    onClick={(event) => {
      clearTutorialPreview();

      if (event.shiftKey) {
        handleFacetShiftClick(group, item.key, false);
      } else if (group === "Properties") {
        handlePropertyCheckboxChange(item.key, true);
      } else {
        handleRoleCheckboxChange(item.key, true);
      }
    }}
    //className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-black hover:bg-black hover:text-white disabled:cursor-not-allowed"
	className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed"
  >
    {shiftKeyDown && hoveredFacetKey === item.key ? (
      <SquareX className="size-4 rounded bg-black text-white" aria-hidden="true" />
    ) : (
      <SquarePlus className="size-4 rounded text-black hover:bg-black hover:text-white" aria-hidden="true" />
    )}
  </button>
) : group === "Classes" ? (
  <input
    type="checkbox"
    disabled={facetListStale}
    aria-invalid={isZeroCount ? true : undefined}
    checked={selectedClasses.has(item.key)}
    data-excluded={isFacetExcluded("Classes", item.key) ? "true" : undefined}
    onClick={(event) => {
      if (event.shiftKey) {
        event.preventDefault();
        handleFacetShiftClick("Classes", item.key, selectedClasses.has(item.key));
      }
    }}
    onChange={(event) => toggleClass(item.key, event.currentTarget.checked)}
    aria-label={`Filter by ${item.label}`}
    className="size-4 shrink-0 accent-current"
  />
                                ) : null}
								<div className="min-w-0 flex-1 flex flex-col items-start gap-0">
                                {group === "Properties" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "forward" ? "text-purple-700 dark:text-purple-300" : isZeroCount ? "text-destructive" : ""}`}
                                    onMouseEnter={() => beginFacetHoverPreview(item.key, "forward", item.label, "configure")}
                                    onMouseLeave={clearTutorialPreview}
                                    onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "forward"); }}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Drill down through ${item.label}`}</TooltipContent></Tooltip>
                                ) : group === "Roles" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === item.key && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : isZeroCount ? "text-destructive" : ""}`}
                                    onMouseEnter={() => beginFacetHoverPreview(item.key, "reverse", item.label, "configure")}
                                    onMouseLeave={clearTutorialPreview}
                                    onClick={() => { clearTutorialPreview(); navigateIntoRelationship(item.key, "reverse"); }}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Filter by role ${item.label}`}</TooltipContent></Tooltip>
                                ) : group === "Classes" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (!selectedClasses.has(item.key)) toggleClass(item.key, true);
                                      showClassResults(item.key, activeLeafId);
                                    }}
                                  >
                                    {toLabel(item.key)}
                                  </button>} /><TooltipContent>{`Show results for class ${toLabel(item.key)}`}</TooltipContent></Tooltip>
                                ) : group === "Graphs" ? (
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className="min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer"
                                    onClick={() => bindGraph(item.key)}
                                  >
                                    {item.label}
                                  </button>} /><TooltipContent>{`Bind graph ${item.key}`}</TooltipContent></Tooltip>
                                ) : (
                                  <span className="min-w-0 flex-1 break-all">{item.label}</span>
                                )}
                                {(group === "Properties" || group === "Roles") && itemExample && <button type="button" title={itemExample.label} disabled={facetListStale || itemExample.termType !== "uri"} onClick={() => showClassResults(itemExample.uri, activeLeafId)} className="max-w-full break-words text-left text-[10px] leading-4 text-muted-foreground italic hover:text-foreground hover:underline disabled:cursor-not-allowed"><em>{(group === "Properties" ? activePropertyFilters : activeRoleFilters).some((node) => node.attributes.iri === item.key && node.children.some((child) => child.name === "value")) ? "i.e." : "e.g."}</em> {ellipsize(itemExample.label)}</button>}
								</div>
                                {(group === "Properties" ||
                                  group === "Roles") && (
                                  <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(item.count)}</span>
                                )}
                                {group === "Classes" && (
  <span className="shrink-0 text-xs text-muted-foreground">
    {shortenCount(item.count)}
  </span>
)}
                              </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}

                {defaultLeftTab === "personal" && (
                  <div className="space-y-3">
                    <article ref={categoriesWidgetRef} className={`flex min-w-0 flex-col ${isGroupByCategory ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`}>
                      <header className={`group/header flex items-start justify-between gap-2 border-b px-2 py-2 ${isGroupByCategory ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                        <div className="flex min-w-0 items-center gap-1">{isGroupByCategory && <UsersRound className="size-4 shrink-0" aria-label="Group by Category" />}<IncompleteWidgetIndicator source="categories" /><h2 className="text-sm font-semibold">Categories</h2><QueryInspectorButton query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.CLASSES, false, false)}\n<!-- FCT API option: view=classes; tree relationships are loaded separately -->`} filename="categories-fct-query.xml" countQuery={visibleClassDisplayFacets[0]?.uri ? buildFctCountSparql(createDistinctCountQuery(queryTree, "class", visibleClassDisplayFacets[0].uri, undefined, undefined, FCT_VIEW_TYPES.CLASSES)) : undefined} countFilename="categories-first-item-count.sparql" /><Tooltip><TooltipTrigger render={<button
                          type="button"
                          aria-pressed={categoriesTreeMode}
                          onClick={() => { setQueryAttribute("classTree", categoriesTreeMode ? "false" : "true"); setExpandedCategoryNodes(new Set()); setClassesPage(0); }}
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${categoriesTreeMode ? "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100" : ""}`}
                          aria-label={categoriesTreeMode ? "Show categories as a flat list" : "Show categories as a superclass tree"}
                        >{categoriesTreeMode ? <List className="size-4" aria-hidden="true" /> : <Network className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{categoriesTreeMode ? "Show flat category list" : "Show category tree (superclass path of each category, up to the root)"}</TooltipContent></Tooltip>{categoriesTreeMode && <Tooltip><TooltipTrigger render={<button
                          type="button"
                          disabled={categoryTreeParentKeys.length === 0}
                          onClick={() => setExpandedCategoryNodes(categoryTreeAllCollapsed ? new Set(categoryTreeParentKeys) : new Set())}
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover/header:disabled:opacity-40"
                          aria-label={categoryTreeAllCollapsed ? "Open all categories" : "Collapse all categories"}
                        >{categoryTreeAllCollapsed ? <ChevronsUpDown className="size-4" aria-hidden="true" /> : <ChevronsDownUp className="size-4" aria-hidden="true" />}</button>} /><TooltipContent>{categoryTreeAllCollapsed ? "Open all" : "Collapse all"}</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger render={<button
                          type="button"
                          aria-pressed={isGroupByCategory}
                          onClick={() => {
                            if (isGroupByCategory) {
                              setGroupByPropertyUri("");
                              setCentralTab("results");
                            } else {
                              setGroupByPropertyUri(`forward:${RDF_TYPE_URI}`);
                              setCentralTab("groups");
                            }
                          }}
                          className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 ${isGroupByCategory ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                          aria-label={isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}
                        ><UsersRound className="size-4" aria-hidden="true" /></button>} /><TooltipContent>{isGroupByCategory ? "Stop grouping by Category" : "Group results by Category"}</TooltipContent></Tooltip></div>
                        <Tooltip><TooltipTrigger render={<span
                          className={`text-xs ${classFacetError ? "text-destructive" : "text-muted-foreground"}`}
                          aria-live="polite"
                        >
                          {isLoadingClasses
                            ? (categoriesTreeMode ? "Building tree…" : "Updating…")
                            : classFacetError
                              ? "Update failed"
                              : shortenCount(visibleClassDisplayFacets.length)}
                        </span>} /><TooltipContent>{classFacetError || classFacetWarning || undefined}</TooltipContent></Tooltip>
                      </header>
                      {classFacetError && endpointReadyForQuery ? (
                        <p className="text-xs text-destructive">{classFacetError}</p>
                      ) : visibleClassDisplayFacets.length === 0 && !isLoadingClasses && !categoriesIncomplete ? (
                        <p className="text-xs text-muted-foreground">No classes found for this query.</p>
                      ) : (
                        <>
                          {selectedClassDisplayFacets.length > 0 && (
                            <div className="mt-2 mb-2 rounded-md border border-border/70 bg-background/80 p-2">
                              <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">Selected</div>
                              <div className={FACET_ITEM_GAP_CLASS}>
                                {selectedClassDisplayFacets.map((item) => {
                                  const count = classFacets.some((facet) => facet.uri === item.uri) ? item.count : null;
                                  return (
                                    <div key={item.uri} className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-sm">
                                      <input
                                        type="checkbox"
                                        checked
                                        data-excluded={isFacetExcluded("Classes", item.uri) ? "true" : undefined}
                                        aria-invalid={count === 0 ? true : undefined}
                                        onClick={(event) => {
                                          if (event.shiftKey) {
                                            event.preventDefault();
                                            handleFacetShiftClick("Classes", item.uri, true);
                                          }
                                        }}
                                        onChange={(event) => toggleClass(item.uri, event.currentTarget.checked)}
                                        aria-label={`Unselect category ${toLabel(item.uri, "Class")}`}
                                        className={isFacetExcluded("Classes", item.uri)
                                          ? "relative size-4 shrink-0 appearance-none rounded-[3px] border border-black bg-white checked:border-black checked:bg-black checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-[14px] checked:after:font-bold checked:after:leading-none checked:after:text-white checked:after:content-['×'] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:!border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:!border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                          : "size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"}
                                      />
                                      <Tooltip><TooltipTrigger render={<button
                                        type="button"
                                        className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${count === 0 ? "text-destructive" : ""}`}
                                        onClick={() => isGroupByCategory ? scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" }) : showClassResults(item.uri, activeLeafId)}
                                      >
                                        {isFacetExcluded("Classes", item.uri) && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                        {toLabel(item.uri, "Class")}
                                      </button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count === null ? "—" : shortenCount(count)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {categoryPageCount > 1 && (
                            <div className="mt-2 mb-2 flex items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.max(0, page - 1))}
                                disabled={classesPage === 0}
                              >
                                Previous
                              </button>
                              <span className="text-muted-foreground">
                                Page {Math.min(classesPage + 1, categoryPageCount)} of {categoryPageCount}
                              </span>
                              <button
                                type="button"
                                className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setClassesPage((page) => Math.min(categoryPageCount - 1, page + 1))}
                                disabled={classesPage >= categoryPageCount - 1}
                              >
                                Next
                              </button>
                            </div>
                          )}
                          <div className={FACET_ITEM_GAP_CLASS}>
                            {categoriesTreeMode ? (
                              <div className={FACET_ITEM_GAP_CLASS}>
                                  {(() => {
                                    const renderTreeNode = (node: CategoryTreeNode, depth: number, parentKey: string): ReactNode => {
                                      const item = node.item;
                                      const nodeKey = categoryTreeNodeKey(parentKey, item.uri);
                                      const isExpanded = expandedCategoryNodes.has(nodeKey);
                                      const isZeroCount = item.count === 0;
                                      return <Collapsible key={nodeKey} open={isExpanded} onOpenChange={(open) => setExpandedCategoryNodes((current) => { const next = new Set(current); if (open) next.add(nodeKey); else next.delete(nodeKey); return next; })} className="min-w-0">
                                        <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50" style={depth ? { paddingLeft: `${8 + depth * 14}px` } : undefined}>
                                          <input type="checkbox" checked={selectedClasses.has(item.uri)} onChange={(event) => toggleClass(item.uri, event.target.checked)} aria-label={`Filter by class ${toLabel(item.uri, "Class")}`} className="size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40" aria-invalid={isZeroCount ? true : undefined} />
                                          <div className="flex min-w-0 flex-1 items-center gap-1">
                                            <Tooltip><TooltipTrigger render={<button type="button" className={`min-w-0 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`} onClick={() => { if (isGroupByCategory) scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" }); else { if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true); showClassResults(item.uri, activeLeafId); } }}>{toLabel(item.uri, "Class")}</button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                            {node.children.length > 0 && <CollapsibleTrigger aria-label={`${isExpanded ? "Collapse" : "Expand"} ${toLabel(item.uri, "Class")}`} className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">{isExpanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}</CollapsibleTrigger>}
                                          </div>
                                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortenCount(item.count)}</span>
                                        </div>
                                        {node.children.length > 0 && <CollapsibleContent className={`mt-0.5 ${FACET_ITEM_GAP_CLASS}`}>{node.children.map((child) => renderTreeNode(child, depth + 1, nodeKey))}</CollapsibleContent>}
                                      </Collapsible>;
                                    };
                                    return (categoryTreePages[Math.min(classesPage, categoryPageCount - 1)] ?? []).map((node) => renderTreeNode(node, 0, ""));
                                  })()}
                              </div>
                            ) : pagedUnselectedClasses.map((item) => {
                                const isZeroCount = item.count === 0;
                                return (
                                <div key={item.uri} className="flex items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50">
                                  <input
                                    type="checkbox"
                                    checked={selectedClasses.has(item.uri)}
                                    onChange={(event) => toggleClass(item.uri, event.target.checked)}
                                    aria-label={`Filter by class ${toLabel(item.uri, "Class")}`}
                                    className="size-4 shrink-0 accent-current aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                                    aria-invalid={isZeroCount ? true : undefined}
                                  />
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className={`min-w-0 flex-1 break-all text-left underline-offset-2 hover:underline cursor-pointer ${isZeroCount ? "text-destructive" : ""}`}
                                    onClick={() => {
                                      if (isGroupByCategory) {
                                        scrollToGroupForFacetValue({ uri: item.uri, title: toLabel(item.uri, "Class"), matches: [], termType: "uri" });
                                      } else {
                                        if (!selectedClasses.has(item.uri)) toggleClass(item.uri, true);
                                        showClassResults(item.uri, activeLeafId);
                                      }
                                    }}
                                  >
                                    {toLabel(item.uri, "Class")}
                                  </button>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{shortenCount(item.count)}</span>
                                </div>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </article>
                    {!focusWidgetsSuppressed && activeRoleFilters.map((roleNode) => {
                      const uri = roleNode.attributes.iri ?? "";
                      const roleLabel = `${toLabel(uri, "Role")} of`;
                      const excluded = roleNode.attributes.exclude?.trim().toLowerCase() === "yes";
                      const label = `${roleLabel} `;
                      const isGroupByRole = groupByPropertyUri === `reverse:${uri}`;
                      const canGroupByRole = !excluded && groupByOptions.some((option) => option.key === `reverse:${uri}`);
                      return (
                        <article key={roleNode.id} ref={(element) => { if (element) roleWidgetCardRefs.current.set(uri, element); else roleWidgetCardRefs.current.delete(uri); }} className={`flex min-w-0 flex-col ${isGroupByRole ? `rounded-md border ${GROUP_BY_FACET_HIGHLIGHT_CLASSES.split(" ").filter((c) => c.startsWith("border-") || c.startsWith("dark:border-")).join(" ")}` : ""}`} style={facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === uri && facetHoverPreview.direction === "reverse" ? { borderColor: "rgb(168 85 247)" } : undefined}>
                          <header className={`group/header flex items-start justify-between gap-2 border-b px-3 py-2 ${isGroupByRole ? `rounded-t-md ${GROUP_BY_FACET_HIGHLIGHT_CLASSES}` : ""}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                <Tooltip><TooltipTrigger render={<button
                                  type="button"
                                  className={`cursor-pointer text-left text-sm font-semibold underline-offset-2 hover:underline ${facetHoverPreview?.kind === "facet" && facetHoverPreview.uri === uri && facetHoverPreview.direction === "reverse" ? "text-purple-700 dark:text-purple-300" : ""}`}
                                  onMouseEnter={() => beginFacetHoverPreview(uri, "reverse", label.trim(), "personal")}
                                  onMouseLeave={clearTutorialPreview}
                                  onClick={() => navigateToPropertyPath(roleNode.id)}
                                >
                                  <IncompleteWidgetIndicator source={`personal-role:${uri}`} />
                                  {activeRoleFilters.some((node) => node.attributes.iri === uri && node.attributes.src === "shacl") && <ClipboardList className="mr-1 inline size-4 shrink-0" aria-label="SHACL-discovered facet" />}
                                  {isGroupByRole && <UsersRound className="mr-1 inline size-4 shrink-0" aria-label="Group by" />}
                                  {excluded && <CircleSlash className="mr-1 inline size-3.5" aria-label="Excluded" />}
                                  {label}
                                </button>} /><TooltipContent>{`Navigate to role scope ${label}`}</TooltipContent></Tooltip>
                                {autoConfiguredFacetKeys.has(`property-in::${uri}`) && (
                                  <Bot className="size-3.5 text-muted-foreground" aria-label="Auto-configured" />
                                )}
                                <div className="flex shrink-0 items-center gap-1">
                                  <QueryInspectorButton
                                    query={`${queryWithoutPagingXml(FCT_VIEW_TYPES.PROPERTIES_IN)}\n<!-- FCT API option: view=properties-in -->`}
                                    filename="roles-fct-query.xml"
                                    label="View Roles widget query"
                                    countQuery={buildFctCountSparql(createDistinctCountQuery(queryTree, "role", uri, undefined, undefined, FCT_VIEW_TYPES.PROPERTIES_IN))}
                                    countFilename="roles-first-item-count.sparql"
                                  />
                                  {!excluded && (
                                    <Tooltip><TooltipTrigger render={<button
                                      type="button"
                                      disabled={!canGroupByRole}
                                      aria-pressed={isGroupByRole}
                                      onClick={() => {
                                        if (isGroupByRole) {
                                          setGroupByPropertyUri("");
                                          setCentralTab("results");
                                        } else {
                                          setGroupByPropertyUri(`reverse:${uri}`);
                                          setCentralTab("groups");
                                        }
                                      }}
                                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:pointer-events-none disabled:opacity-30 ${isGroupByRole ? "border-sky-300 bg-sky-200 text-sky-800 hover:bg-sky-200 hover:text-sky-800 dark:border-sky-700 dark:bg-sky-900/70 dark:text-sky-100 dark:hover:bg-sky-900/70 dark:hover:text-sky-100" : ""}`}
                                      aria-label={isGroupByRole ? `Stop grouping by ${roleLabel}` : `Group results by ${roleLabel}`}
                                    >
                                      <UsersRound className="size-4" aria-hidden="true" />
                                    </button>} /><TooltipContent>{isGroupByRole ? `Stop grouping by ${roleLabel}` : canGroupByRole ? `Group results by ${roleLabel}` : "Select this role in the active query before grouping by it"}</TooltipContent></Tooltip>
                                  )}
                                  <Tooltip><TooltipTrigger render={<button
                                    type="button"
                                    className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                                    onClick={() => deleteNode(roleNode.id)}
                                    aria-label={`Remove role filter ${label}`}
                                  >
                                    <Trash2 className="size-4" aria-hidden="true" />
                                  </button>} /><TooltipContent>{`Remove role filter ${roleLabel}`}</TooltipContent></Tooltip>
                                </div>
                              </div>
                              <Tooltip><TooltipTrigger render={<p className="mt-1 break-all text-xs text-muted-foreground">{uri}</p>} /><TooltipContent>{uri}</TooltipContent></Tooltip>
                            </div>
                            <Tooltip><TooltipTrigger render={<span
                              className={`shrink-0 text-xs ${roleWidgetStatuses[roleNode.id]?.error ? "text-destructive" : "text-muted-foreground"}`}
                              aria-live="polite"
                            >
                              {roleWidgetStatuses[roleNode.id]?.loading ?? true
                                ? "Updating…"
                                : roleWidgetStatuses[roleNode.id]?.error
                                  ? "Update failed"
                                  : shortenCount(roleWidgetStatuses[roleNode.id]?.count ?? 0)}
                            </span>} /><TooltipContent>{roleWidgetStatuses[roleNode.id]?.error || undefined}</TooltipContent></Tooltip>
                          </header>
                          {endpointReadyForQuery && <PersonalRoleWidget tree={queryTree} roleNode={roleNode} label={label.trim()} isGroupByRole={groupedRoleUri === uri} groupBy={centralTab === "groups" && selectedGroupByOption && groupedRoleUri === uri ? { option: selectedGroupByOption, limit: groupBatchSize } : undefined} limit={leftPanelLimit} onGroupValueClick={scrollToGroupForFacetValue} setRoleWidgetStatuses={setRoleWidgetStatuses} endpointReady={endpointReadyForQuery} refreshRevision={queryRefreshRevision} />}
                        </article>
                      );
                    })}
                    {!focusWidgetsSuppressed && renderPersonalWidgetCards("column")}
                    <article className="flex min-w-0 flex-col">
                      <header className="group/header flex items-center gap-2 px-2 py-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <IncompleteWidgetIndicator source="graphs" /><h2 className="text-sm font-semibold">Graphs</h2>
                          <QueryInspectorButton query={`${queryWithoutPagingXml()}\n<!-- FCT API option: graphOnly=true -->`} filename="graphs-fct-query.xml" extraQueries={[{ id: "graph-list-sparql", label: "GraphList SPARQL", query: graphListSparql || "# GraphList SPARQL will appear after the endpoint returns a query.", filename: "graph-list.sparql", language: "sparql" }]} />
                          {queryTree.attributes.graph && (
                            <Tooltip><TooltipTrigger render={<button
                              type="button"
                              onClick={clearGraph}
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"
                              aria-label="Clear graph selection"
                            ><X className="size-4" aria-hidden="true" /></button>} /><TooltipContent>{"Clear graph selection and Graph field"}</TooltipContent></Tooltip>
                          )}
                          <div
                            aria-label="Sort graphs"
                            className={`invisible ml-1 shrink-0 overflow-hidden opacity-0 transition-[width,opacity] duration-200 group-hover/header:visible group-hover/header:opacity-100 focus-within:visible focus-within:opacity-100 ${graphSortPickerExpanded ? "w-28" : "w-7"}`}
                            onMouseEnter={() => setGraphSortPickerExpanded(true)}
                            onMouseLeave={() => setGraphSortPickerExpanded(false)}
                            onFocusCapture={() => setGraphSortPickerExpanded(true)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGraphSortPickerExpanded(false);
                            }}
                          >
                            <ButtonGroup className="inline-flex w-28 shrink-0 items-center [&>*+*]:border-l [&>*+*]:border-input">
                              {[...([
                                { value: "count-asc", label: "Count: lowest first", Icon: ArrowDown01 },
                                { value: "count-desc", label: "Count: highest first", Icon: ArrowDown10 },
                                { value: "label-asc", label: "Label: A to Z", Icon: ArrowDownAZ },
                                { value: "label-desc", label: "Label: Z to A", Icon: ArrowDownZA },
                              ] as const)].sort((left, right) => left.value === graphSort ? -1 : right.value === graphSort ? 1 : 0).map(({ value, label, Icon }) => (
                                <Tooltip key={value}>
                                  <TooltipTrigger render={
                                    <Toggle
                                      pressed={graphSort === value}
                                      onPressedChange={(pressed) => {
                                        if (!pressed) return;
                                        setGraphsPage(0);
                                        setGraphSort(value);
                                        setGraphSortPickerExpanded(false);
                                      }}
                                      aria-hidden={!graphSortPickerExpanded && graphSort !== value}
                                      tabIndex={!graphSortPickerExpanded && graphSort !== value ? -1 : 0}
                                      className={`size-7 shrink-0 border-0 p-0 transition-colors ${graphSort === value ? "bg-black text-white dark:bg-black dark:text-white" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                                      aria-label={label}
                                    >
                                      <Icon aria-hidden="true" className="size-4" />
                                    </Toggle>
                                  } />
                                  <TooltipContent>{label}</TooltipContent>
                                </Tooltip>
                              ))}
                            </ButtonGroup>
                          </div>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground" aria-live="polite">
                            {isLoadingGraphs ? "Updating…" : shortenCount(graphFacets.length)}
                          </span>
                        </div>
                      </header>
                      {graphFacets.length === 0 ? (
                        <p className="px-2 text-xs text-muted-foreground">
                          {isLoadingGraphs ? "Loading graphs…" : "No registered graphs yet."}
                        </p>
                      ) : (
                        <>
                          {(graphsPage > 0 || graphHasMore) && (
                            <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs">
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => Math.max(0, page - 1))} disabled={graphsPage === 0 || isLoadingGraphs}>Previous</button>
                              <span className="text-muted-foreground">Page {graphsPage + 1}</span>
                              <button type="button" className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setGraphsPage((page) => page + 1)} disabled={!graphHasMore || isLoadingGraphs}>Next</button>
                            </div>
                          )}
                          <div className={FACET_ITEM_GAP_CLASS}>
                            {graphFacets.map((item) => (
                              <label key={item.uri} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-accent/50 cursor-pointer">
                                <input type="radio" name="maestro-query-graph-personal" checked={queryTree.attributes.graph === item.uri} onChange={() => bindGraph(item.uri)} aria-label={`Bind graph ${item.label}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                                <span className="min-w-0 flex-1">
                                  <span className="block break-words">{item.label}</span>
                                  <Tooltip><TooltipTrigger render={<span className="block break-all text-xs text-muted-foreground">{item.uri}</span>} /><TooltipContent>{item.uri}</TooltipContent></Tooltip>
                                </span>
                                <Tooltip><TooltipTrigger render={<span className="shrink-0 text-xs text-muted-foreground">{shortenCount(item.count)}</span>} /><TooltipContent>{`${item.count} matching resources`}</TooltipContent></Tooltip>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
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
            <ResizablePanel defaultSize={workspaceTab === "browse" ? 45 : 75} minSize={25} className="min-w-0">
            <section ref={centralPaneRef} className="flex h-full min-h-0 min-w-0 flex-col border-r">
              <div className={`group/header shrink-0 border-b px-3 pb-3 pt-0 ${centralTab === "chat" || workspaceTab !== "browse" ? "hidden" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">
                    <IncompleteWidgetIndicator source={centralTab === "groups" ? "groups" : "results"} /> Group <strong className="font-semibold text-foreground">{effectiveResultsTotalCount !== null ? shortenCount(effectiveResultsTotalCount) : "many"}</strong> results by:
                  </span>
                  <div className="relative flex min-w-[8rem] max-w-full flex-1 items-center">
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
                    className="w-full min-w-0 appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {groupByOptions.map((option) => <option key={option.key || "none"} value={option.key}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
                  </div>
                  <label htmlFor="results-page-size" className="shrink-0 text-muted-foreground">in pages of</label>
                  <div className="relative inline-flex shrink-0 items-center">
                  <select
                    id="results-page-size"
                    aria-label="Results page size"
                    value={effectivePageSize}
                    disabled={isSearching}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!resultsPageSizeOptions.includes(nextSize)) return;
                      try {
                        maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(nextSize));
                      } catch {
                        // Storage can be disabled; the current selection still applies.
                      }
                      setResultsPageSize(nextSize);
                      setResultsUiPage(0);
                      setGroupUiPage(0);
                    }}
                    className="h-9 min-w-[4.5rem] appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                  >
                    {resultsPageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
                  </div>
                  <span aria-hidden="true" className="mx-1 h-6 border-l border-border" />
                  <label htmlFor="results-batch-size" className="shrink-0 text-muted-foreground">Batch size</label>
                  <div className="relative inline-flex shrink-0 items-center">
                  <select
                    id="results-batch-size"
                    aria-label="Server batch size"
                    value={centralTab === "groups" && selectedGroupByOption ? groupBatchSize : resultsBatchSize}
                    disabled={isSearching || groupValuesLoading}
                    onChange={(event) => {
                      const nextSize = Number(event.currentTarget.value);
                      if (!RESULTS_BATCH_SIZE_OPTIONS.some((size) => size === nextSize)) return;
                      if (centralTab === "groups" && selectedGroupByOption) {
                        maestroStorageSet(CENTER_GROUP_LIMIT_STORAGE_KEY, String(nextSize));
                        setGroupBatchSize(nextSize);
                        setGroupBatchOffset(0);
                        setGroupUiPage(0);
                        setGroupHasMoreBatches(false);
                        setGroupValues([]);
                      } else {
                        maestroStorageSet(CENTER_PANEL_LIMIT_STORAGE_KEY, String(nextSize));
                        setResultsUiPage(0);
                        setResults([]);
                        resultsLoadedQueryIdentityRef.current = "";
                        setResultsPage(nextSize, 0);
                      }
                    }}
                    className="h-9 min-w-[5rem] appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-8 text-sm"
                  >
                    {RESULTS_BATCH_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
                  </div>
                  {selectedGroupByOption ? <><span aria-hidden="true" className="mx-1 h-6 border-l border-border" /><span className="shrink-0 text-muted-foreground">{groupValuesLoading ? "…" : `${visibleGroupValues.length} ${visibleGroupValues.length === 1 ? "group" : "groups"}`}</span></> : null}
                </div>
              </div>

              {/* An active alphabet restriction must remain visible and removable even when
                  subsequent filters eliminate its count or the alphabet preflight fails. */}
              {workspaceTab === "browse" && centralTab === "results" && (alphabetPreflight === "available" || Boolean(alphabetIndex)) && (
                <div id="maestro-alphabet" className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2" aria-label="Alphabetical browse by selected label properties">
                  <IncompleteWidgetIndicator source="alphabet" />
                  {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").filter((letter) => (alphabetCounts[letter] ?? 0) > 0 || alphabetIndex === letter).map((letter) => (
                    <button key={letter} type="button" title={`Letter ${letter}`} aria-label={`Letter ${letter}: ${alphabetCounts[letter] ?? 0} results`} aria-pressed={alphabetIndex === letter}
                      disabled={alphabetIndex !== letter && (isLoadingAlphabet || !alphabetCounts[letter])}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${alphabetIndex === letter ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-border hover:bg-accent hover:text-accent-foreground"}`}
                      onClick={() => {
                        setNodeAttribute("query-view", "indexLabels", alphabetLabelUris);
                        setNodeAttribute("query-view", "index", alphabetIndex === letter ? null : letter);
                        setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                      }}>
                      <span className="font-medium">{letter}</span>
                      <Separator orientation="vertical" className="mx-1 h-4 bg-current opacity-30 data-vertical:self-center" />
                      <span className={`tabular-nums font-normal ${alphabetIndex === letter ? "text-primary-foreground/65" : "text-muted-foreground"}`}>{shortenCount(alphabetCounts[letter] ?? 0)}</span>
                    </button>
                  ))}
                  {alphabetIndex && (
                    <button type="button" className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Clear alphabet filter ${alphabetIndex}`} title={`Clear alphabet filter ${alphabetIndex}`}
                      onClick={() => {
                        setNodeAttribute("query-view", "index", null);
                        setResultsUiPage(0); setResults([]); setResultsPage(resultsBatchSize, 0);
                      }}>
                      Clear letter ({alphabetIndex})
                    </button>
                  )}
                  {isLoadingAlphabet && <span className="text-xs text-muted-foreground">Fetching letter filters...</span>}
                  {alphabetError && <span className="text-xs text-destructive" title={alphabetError}>{Object.values(alphabetCounts).some((count) => count > 0) ? "Alphabet partial" : "Alphabet unavailable"}</span>}
                </div>
              )}

              {workspaceTab === "browse" && ((centralTab === "results" && (resultsUiPage > 0 || results.length > resultsPageSize ||
                (effectiveResultsTotalCount === null && !resultsPageComplete && results.length > 0) ||
                (effectiveResultsTotalCount !== null && effectiveResultsTotalCount > resultsPageSize)) ||
                centralTab === "groups" && selectedGroupByOption && (groupValues.length > resultsPageSize || groupHasMoreBatches))) && (
                <div className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                  <span className="text-muted-foreground" aria-live="polite">
                    {centralTab === "groups"
                      ? `Page ${groupUiPage + 1} / ${Math.max(1, Math.ceil(groupValues.length / resultsPageSize)).toLocaleString()}${groupHasMoreBatches ? "+" : ""}`
                      : effectiveResultsTotalCount === null
                        ? `Page ${resultsUiPage + 1}${resultsPageComplete ? ` / ${Math.max(1, Math.ceil(results.length / resultsPageSize)).toLocaleString()}` : ""}`
                        : `Page ${resultsUiPage + 1} / ${Math.max(1, Math.ceil(effectiveResultsTotalCount / resultsPageSize)).toLocaleString()}`}
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
                      disabled={isSearching || groupValuesLoading || (centralTab === "groups"
                        ? ((groupUiPage + 1) * resultsPageSize >= groupValues.length && !groupHasMoreBatches)
                        : effectiveResultsTotalCount === null
                          ? (results.length <= (resultsUiPage + 1) * resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current))
                          : resultsUiPage + 1 >= Math.ceil(effectiveResultsTotalCount / resultsPageSize))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              {workspaceTab === "view" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Views">
                <nav aria-label="View breadcrumbs" className="flex shrink-0 flex-wrap items-start gap-2 border-b bg-background px-4 py-2">
                  {renderRootBreadcrumb(false, undefined, false)}
                  {analyzeBreadcrumbTrail.map((crumb, index) => renderPathBreadcrumb(crumb, index, false, undefined, false))}
                </nav>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">{(() => {
                    const icon = viewXsltMetadata.icon ?? selectedView?.icon;
                    const Icon = (viewXsltMetadata.title === "Graph Servers" || selectedView?.label === "Graph Servers") ? Server : icon === "server" ? Server : icon === "database" ? Database : icon === "globe" ? Globe : icon === "layout-grid" ? LayoutGrid : Network;
                    return <Icon className="size-5 text-muted-foreground" aria-hidden="true"/>;
                  })()}<h2 className="font-semibold">{selectedView ? (viewXsltMetadata.title || selectedView.label) : "View"}</h2></div>
                  {discoveredViews.length > 1 && <select aria-label="Select view" className="rounded border bg-background px-2 py-1 text-sm" value={selectedViewUri} onChange={(event) => setSelectedViewUri(event.currentTarget.value)}>
                    {discoveredViews.map((view) => <option key={view.uri} value={view.uri}>{view.label}</option>)}
                  </select>}
                  {selectedView && <span className="text-xs text-muted-foreground">{selectedView.label} · {visibleResultsPage.length} results on this page</span>}
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  {viewDiscoveryLoading ? <p className="text-sm text-muted-foreground">Locating views…</p>
                    : viewDiscoveryError ? <p role="alert" className="text-sm text-destructive">{viewDiscoveryError}</p>
                    : !selectedView ? <div className="mx-auto max-w-lg rounded-lg border border-dashed p-8 text-center">
                        <Network className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true"/>
                        <h3 className="font-medium">No views found</h3>
                        <p className="mt-2 text-sm text-muted-foreground">No views match the classes at this breadcrumb scope.</p>
                      </div>
                    : viewRenderError ? <p role="alert" className="text-sm text-destructive">{viewRenderError}</p>
                    : <div className="maestro-discovered-view" onClick={(event) => {
                        const target = event.target as HTMLElement;
                        const button = target.closest<HTMLButtonElement>("button[data-endpoint-refresh]");
                        if (!button) return;
                        const endpoint = fctEndpoints.find((item) => item.id === button.dataset.endpointRefresh);
                        if (!endpoint || checkingEndpointIds[endpoint.id]) return;
                        void checkSelectedGraphServer(endpoint).catch((error) => {
                          toast.add({ title: "Could not refresh graph server health", description: error instanceof Error ? error.message : "Health check failed.", type: "error" });
                        });
                      }} ref={(element) => {
                        if (!element) return;
                        // Native favicon fetching is optional; expose the XSLT's Lucide fallback when missing.
                        element.querySelectorAll("img").forEach((image) => {
                          image.onerror = () => {
                            const fallback = image.getAttribute("data-favicon-fallback");
                            if (fallback && image.src !== fallback) {
                              image.removeAttribute("data-favicon-fallback");
                              image.src = fallback;
                            } else image.hidden = true;
                          };
                        });
                      }} dangerouslySetInnerHTML={{ __html: viewHtml }}/>} 
                </div>
                {selectedView && <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-xs">
                  <span className="text-muted-foreground">Page {resultsUiPage + 1}</span>
                  <div className="flex items-center gap-2"><label htmlFor="view-page-size">Per page</label>
                    <select id="view-page-size" className="rounded border bg-background px-2 py-1" value={effectivePageSize} onChange={(event) => { const n=Number(event.currentTarget.value); setResultsPageSize(n); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY,String(n)); setResultsUiPage(0); }}>
                      {resultsPageSizeOptions.map((n) => <option value={n} key={n}>{n}</option>)}
                    </select>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>}
              </div>}
              {workspaceTab === "analyze" && <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Analyze canvas">
                {!selectedAnalysisUri.includes("compare-table") && (
                  <nav aria-label="Analyze breadcrumbs" className="flex shrink-0 flex-wrap items-start justify-start gap-2 border-b bg-background px-4 py-2">
                    {renderRootBreadcrumb(false, analysisTable?.trailStyle, false)}
                    {analyzeBreadcrumbTrail.map((crumb, index) => renderPathBreadcrumb(crumb, index, false, analysisTable?.trailStyle, false))}
                  </nav>
                )}
                {selectedAnalysisUri.includes("compare-table") && <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                  <label htmlFor="maestro-compare-facet">Compare facet</label>
                  <select id="maestro-compare-facet" value={effectiveCompareFacet} onChange={(event) => setCompareFacet(event.target.value)} className="min-w-0 max-w-md flex-1 rounded-md border bg-background px-2 py-1">
                    {availableCompareFacets.map((facet) => <option key={facet.key} value={facet.key}>{facet.label}</option>)}
                  </select>
                </div>}
                {!selectedAnalysisUri.includes("compare-table") && <div role="toolbar" aria-label="Analyze table actions" className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1 text-muted-foreground">
                  <button type="button" className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground disabled:cursor-not-allowed" title="Export (coming soon)" aria-label="Export" disabled><Download aria-hidden="true" className="size-4"/>Export</button>
                </div>}
                {analysisError && <p role="alert" className="p-3 text-sm text-destructive">{analysisError}</p>}
                {analysisValuesError && <p role="alert" className="p-3 text-xs text-amber-600">Facet values could not be loaded: {analysisValuesError}</p>}
                {analysisLoading && !analysisTable && <p className="p-3 text-xs text-muted-foreground">Building analysis using the selected XSLT…</p>}
                <div className="min-h-0 flex-1 overflow-auto">
                  {analysisTable && isCompareAnalysis && analyzeHistogram && (
                    <div className="min-h-full space-y-4 p-4" aria-label="Compare Histogram">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h2 className="text-sm font-medium">Compare Histogram</h2>
                        <span className="text-xs text-muted-foreground">Checked cells per column · {analysisTable.rows.length} visible results</span>
                      </div>
                      {histogramColumns.length ? (
                        <div className="h-[min(65vh,540px)] min-h-64 w-full" role="img" aria-label={histogramColumns.map((bar) => `${bar.label}: ${bar.count}`).join(", ")}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={histogramColumns} margin={{top:12,right:20,bottom:48,left:4}}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                              <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" height={90} tick={{fontSize:11}} />
                              <YAxis allowDecimals={false} domain={[0, "dataMax"]} tick={{fontSize:11}} />
                              <ChartTooltip formatter={(value) => [value, "Checked"]} cursor={{fill:"var(--muted)", opacity:0.35}} />
                              <Bar dataKey="count" name="Checked" fill="var(--chart-1)" radius={[3,3,0,0]} maxBarSize={90}/>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : <p className="text-sm text-muted-foreground">No comparison columns available.</p>}
                    </div>
                  )}
                  {analysisTable && !(isCompareAnalysis && analyzeHistogram) && <Table className="border-collapse text-xs" style={{...analysisTable.tableStyle, tableLayout:"fixed", width: 36 + analysisTable.columns.reduce((sum, col, i) => sum + (analysisColumnWidths[col.nodeId || `${col.kind}:${col.label}`] ?? (i === 0 ? 240 : 190)), 0)}} aria-label={selectedAnalysisUri.includes("compare-table") ? "Compare Table" : "Table"}>
                    <colgroup>
                      <col style={{width:36}}/>
                      {analysisTable.columns.map((col) => <col key={col.nodeId || `${col.kind}:${col.label}`} style={{width:analysisColumnWidths[col.nodeId || `${col.kind}:${col.label}`] ?? (col.kind === "result" ? 240 : 190)}}/>)}
                    </colgroup>
                    <TableHeader className="sticky top-0 z-20 bg-background"><TableRow>
                      <TableHead scope="col" className="w-9 min-w-9 border px-1 py-1 text-center align-middle" style={analysisTable.headerStyle}>
                        <input type="checkbox" aria-label="Select all results on this page" className="size-4 cursor-pointer align-middle accent-primary" checked={analysisAllSelected} disabled={!analysisRowKeys.length} onChange={(event) => setAnalysisSelection({ pageKey: analysisSelectionPageKey, keys: event.currentTarget.checked ? analysisRowKeys : [] })} />
                      </TableHead>
                      {analysisTable.columns.map((col, i) => <TableHead key={col.nodeId || `result-${i}`} scope="col" className="relative border px-1.5 py-1 pr-3 align-top text-left font-medium" style={{...analysisTable.headerStyle, ...col.headerStyle}}>
                        {col.kind === "result" && !selectedAnalysisUri.includes("compare-table")
                          ? "Results"
                          : col.kind === "breadcrumb" ? (() => {
                          const header = analyzeTableHeaderNodes.find((crumb) => crumb.id === col.nodeId);
                          return header ? renderPathBreadcrumb(header, activeBreadcrumbIndex + 1, true, col.breadcrumbStyle) : col.label;
                        })() : col.kind === "value" && /^[a-z][a-z0-9+.-]*:/i.test(col.label) ? toLabel(col.label, "OBJECT") : col.label}
                        <span role="separator" tabIndex={0} aria-label={`Resize ${col.label || "Results"} column`} aria-orientation="vertical" title="Drag to resize column; use Left/Right arrows for fine adjustment" className="absolute right-0 top-0 z-30 h-full w-2 cursor-col-resize touch-none hover:bg-sky-300/40 focus:bg-sky-300/40 focus:outline-2 focus:outline-sky-500" onPointerDown={(event) => beginAnalysisColumnResize(event, col.nodeId || `${col.kind}:${col.label}`, analysisColumnWidths[col.nodeId || `${col.kind}:${col.label}`] ?? (col.kind === "result" ? 240 : 190))} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const key = col.nodeId || `${col.kind}:${col.label}`; setAnalysisColumnWidths((current) => ({...current, [key]: Math.max(88, Math.min(900, (current[key] ?? (col.kind === "result" ? 240 : 190)) + (event.key === "ArrowRight" ? 16 : -16)))})); }}/>
                      </TableHead>)}
                    </TableRow></TableHeader><TableBody>
                      {analysisTable.rows.map((row, rowIndex) => <TableRow key={`${row.uri}:${rowIndex}`} className="hover:bg-accent/40" style={analysisTable.rowStyle}>
                        <TableCell className="w-9 min-w-9 border px-1 py-1 text-center align-middle" style={analysisTable.cellStyle}>
                          <input type="checkbox" aria-label={`Select ${row.label}`} className="size-4 cursor-pointer align-middle accent-primary" checked={analysisSelectedKeys.includes(analysisRowKeys[rowIndex] ?? "")} onChange={(event) => toggleAnalysisRow(analysisRowKeys[rowIndex], event.currentTarget.checked)} />
                        </TableCell>
                        <TableHead scope="row" className="max-w-72 border px-1.5 py-1 text-left font-normal" style={analysisTable.cellStyle}>
                          <button type="button" className="max-w-full break-words text-left text-primary hover:underline" onClick={() => { setSelectedUri(row.uri); setWorkspaceTab("browse"); setCentralTab("results"); }}>{row.label}</button>
                        </TableHead>
                        {row.cells.map((cell, index) => <TableCell key={analysisTable.columns[index + 1]?.nodeId || analysisTable.columns[index + 1]?.label || index} className="max-w-80 border px-1.5 py-1 align-top" style={{...analysisTable.cellStyle,...cell.cellStyle}}>
                          {selectedAnalysisUri.includes("compare-table") ? (cell.checked ? <Check className="size-4 text-emerald-600" aria-label="Present"/> : null) : (() => {
                            const column = analysisTable.columns[index + 1];
                            const header = analyzeTableHeaderNodes.find((crumb) => crumb.id === column?.nodeId);
                            if (!header) return <span className="text-muted-foreground">—</span>;
                            const direction = header.name === "property-of" ? "reverse" : "forward";
                            // Reuse the exact typed terms that Browse badges consume.
                            // Prefer the dedicated projection, but retain already-loaded
                            // Browse badges while the current page projection is pending.
                            const currentResult = visibleResultsPage.find((item) => item.uri === row.uri);
                            const scopes = [...(currentResult?.scopeValues ?? []), ...(readyAnalysisValues?.get(row.uri) ?? [])];
                            const scope = [...scopes].reverse().find((value) => value.property === header.uri && value.direction === direction);
                            const values = scope?.values.filter((value) => value.value && value.value !== "-") ?? [];
                            return values.length && scope
                              ? <div className="flex flex-wrap gap-0.5">{values.map((value, j) => renderScopeValueBadge(scope, value, j, {valueOnly: true, style: cell.badgeStyle}))}</div>
                              : <span className="text-muted-foreground">—</span>;
                          })()}
                        </TableCell>)}
                      </TableRow>)}
                    </TableBody></Table>}
                  {!analysisLoading && !analysisTable && !analysisError && <p className="p-3 text-sm text-muted-foreground">Choose an analysis from the ribbon.</p>}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Page {resultsUiPage+1}{effectiveResultsTotalCount !== null ? ` · ${effectiveResultsTotalCount.toLocaleString()} results` : " · many results"}</span>
                  <div className="flex items-center gap-2"><label htmlFor="analyze-page-size">Per page</label>
                    <select id="analyze-page-size" value={effectivePageSize} onChange={(event) => { const n = Number(event.target.value); maestroStorageSet(RESULTS_PAGE_SIZE_STORAGE_KEY, String(n)); setResultsPageSize(n);setResultsUiPage(0);}} className="rounded border bg-background px-2 py-1">
                      {resultsPageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={resultsUiPage===0 || isSearching} onClick={() => changeResultsPage(-1)}>Previous</button>
                    <button type="button" className="rounded border px-2 py-1 disabled:opacity-40" disabled={isSearching || (effectiveResultsTotalCount === null ? (results.length <= (resultsUiPage+1)*resultsPageSize && (resultsPageComplete || resultsBatchRequestPending.current)) : resultsUiPage+1 >= Math.ceil(effectiveResultsTotalCount/resultsPageSize))} onClick={() => changeResultsPage(1)}>Next</button>
                  </div>
                </div>
              </div>}

              {workspaceTab === "browse" && centralTab === "results" && (
                <div
                  id="central-panel-results"
                  role="tabpanel"
                  aria-labelledby="central-tab-results"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >


              <div className="relative min-h-0 flex-1 overflow-y-auto p-2">
                {!facetHoverPreview && visibleResultsPage.map((item, index) => {
                  const isExpanded = expandedUris.has(item.uri);
                  const recordClasses = Array.from(new Set(
                    (item.scopeValues ?? [])
                      .filter((scopeValue) => scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward")
                      .flatMap((scopeValue) => scopeValue.values)
                      .map((term) => term.value)
                      .filter((value) => Boolean(value) && value !== "-")
                  ));

                  const isMovie = recordClasses.some((iri) => MOVIE_CLASS_IRIS.has(iri));
                  const movieYear = isMovie ? (() => {
                    const scopeValues = item.scopeValues ?? [];
                    // Prefer dedicated release predicates in declared priority order.
                    for (const predicate of MOVIE_RELEASE_PROPERTIES) {
                      for (const term of scopeValues.filter((scope) => scope.direction === "forward" && scope.property === predicate).flatMap((scope) => scope.values)) {
                        const year = releaseYearFromText(term.value);
                        if (year) return year;
                      }
                    }
                    // If no known property is available, inspect date/year-like
                    // properties already returned by the enrichment query.
                    for (const scope of scopeValues) {
                      if (!/(?:date|year|released|premier|published)/i.test(scope.property)) continue;
                      for (const term of scope.values) {
                        const year = releaseYearFromText(term.value);
                        if (year) return year;
                      }
                    }
                    // Titles sometimes carry their release year in parentheses.
                    return (item.title.match(/\(((?:18|19|20|21)\d{2})\)/)?.[1] ?? null);
                  })() : null;
                  const selectedBadgePropertySet = new Set(resultBadgePropertiesKey ? resultBadgePropertiesKey.split("\u0000") : []);

                  return (
                    <div
                      key={`${item.uri}-${index}`}
                      data-result-selected={selectedUri === item.uri ? "true" : "false"}
                      className={`mb-2 rounded-md border ${
                        selectedUri === item.uri
                          ? "border-primary"
                          : "border-border"
                      }`}
                    >
                      {showResultBadges && item.termType === "uri" && (
                        <div
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-t-[5px] bg-sky-100 px-3 py-2 text-xs font-medium text-sky-950 dark:bg-sky-950/60 dark:text-sky-100"
                          aria-label="Record classes"
                        >
                          {recordClasses.length > 0 ? recordClasses.map((classIri, classIndex) => (
                            <Fragment key={classIri}>
                              {classIndex > 0 && <span className="text-sky-600/70 dark:text-sky-300/70" aria-hidden="true">·</span>}
                              <button type="button" title={`Show all records of class ${classIri}`}
                                onClick={() => navigateResultBadge(RDF_TYPE_URI, { value: classIri, type: "uri" }, "forward", true)}
                                className="cursor-pointer break-words rounded px-1 hover:bg-sky-200 hover:text-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-sky-800 dark:hover:text-sky-100">{toLabel(classIri, "Class")}</button>
                            </Fragment>
                          )) : <span className="font-normal italic text-sky-700/75 dark:text-sky-200/75">no type</span>}
                        </div>
                      )}
                      <div className="flex items-start gap-2 p-3">
                        <button
                          onClick={() => setSelectedUri(item.uri)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium cursor-pointer">
                            <span>{item.termType === "uri" ? toLabel(item.uri, "Class") : item.title || item.uri}</span>
                            {movieYear && <span className="text-xs font-normal text-muted-foreground" title="Release year">{movieYear}</span>}
                          </span>
                          <span className="mt-1 block break-all text-xs text-muted-foreground">
                            {item.uri}
                          </span>
                        </button>

                        {isRootView && liveQueryHasText && search.trim().length > 0 && (
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

                      {isRootView && liveQueryHasText && isExpanded && search.trim().length > 0 && (
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

                      {(item.scopeValues?.some((scopeValue) => !(scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward") &&
                            (scopeValue.direction !== "forward" || !MOVIE_RELEASE_PROPERTIES.some((iri) => iri === scopeValue.property) || selectedBadgePropertySet.has(scopeValue.property))) ?? false) && (
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2" aria-label="Selected property values">
                          {item.scopeValues!.filter((scopeValue) => !(scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward") &&
                            (scopeValue.direction !== "forward" || !MOVIE_RELEASE_PROPERTIES.some((iri) => iri === scopeValue.property) || selectedBadgePropertySet.has(scopeValue.property))).map((scopeValue) => scopeValue.values.map((term, termIndex) => {
                                return renderScopeValueBadge(scopeValue, term, termIndex);
                              }))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {visibleResultsPage.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {searchError
                      ? "Search could not be completed."
                      : isSearching || !urlStateInitialized || !endpointReadyForQuery || !initialBrowseTriggered || resultsLoadedQueryIdentityRef.current !== activeQueryIdentityRef.current
                        ? "Locating..."
                        : !search.trim()
                          ? "No resources returned for the initial empty-text query."
                          : "No matching results."}
                  </p>
                )}
                {facetHoverPreview && tutorialMode && (
                  <div className="absolute inset-0 z-20 flex flex-col gap-3 bg-background/95 p-6" aria-live="polite" aria-label={facetHoverPreview.kind === "record" ? `Preview record ${facetHoverPreview.label}` : `Preview ${facetHoverPreview.label} ${facetHoverPreview.direction === "reverse" ? "role" : "property"} list`}>
                    <p className="text-base">{facetHoverPreview.kind === "record" ? <>Only the <span className="font-semibold text-purple-700 dark:text-purple-300">{facetHoverPreview.label}</span> item will load here</> : <>The <span className="font-semibold text-purple-700 dark:text-purple-300">{facetHoverPreview.label}</span> list will load here</>}</p>
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><CornerDownLeft className="size-4 shrink-0" aria-hidden="true" />{facetHoverPreview.kind === "record" ? "The filters for this record will appear on the left" : "The filters for this list will appear on the left"}</p>
                  </div>
                )}
              </div>
                </div>
              )}

              {workspaceTab === "browse" && centralTab === "chat" && (
                <div
                  id="central-panel-chat"
                  role="region"
                  aria-label="Maestro assistant chat"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <BasicAssistantChat
                    userName={authSession ? (authSession.userName || authSession.username || "User") : undefined}
                    userAvatarUrl={authSession?.avatarUrl}
                    onShowResults={() => { setAssistantPromptDraft(""); setCentralTab("results"); }}
                    initialDraft={assistantPromptDraft}
                    pendingPrompt={assistantPendingPrompt}
                    onPendingPromptConsumed={(id) => setAssistantPendingPrompt((current) => current?.id === id ? null : current)}
                  />
                </div>
              )}

              {workspaceTab === "browse" && centralTab === "groups" && selectedGroupByOption && (
                <div id="central-panel-groups" role="tabpanel" aria-labelledby="central-tab-groups" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {groupByOptions.length > 0 ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {groupValuesLoading ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading group values from Virtuoso FCT…</p> : null}
                      {groupValuesError ? <p className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{groupValuesError}</p> : null}
                      {!groupValuesLoading && !groupValuesError && groupValues.length === 0 ? <p className="shrink-0 rounded-md border border-dashed p-4 text-sm text-muted-foreground">No values found for this relationship in the current scope.</p> : null}
                      <div className="min-w-0 flex-1 overflow-y-auto p-3">
                        <div className="flex flex-col gap-3">
                        {visibleGroupValues.map((groupValue) => {
                          const groupValueLabel = groupValue.termType === "uri" ? toLabel(groupValue.uri, "OBJECT") : groupValue.title || groupValue.uri;
                          const memberKey = `${selectedGroupByOption!.key}::${groupValueKey(groupValue)}`;
                          const members = groupMembers[memberKey] ?? { results: [], loading: true, error: "" };
                          const selectedRelationshipNode = findQueryNode(queryTree.children, selectedGroupByOption!.nodeId);
                          const expectedBinding = groupValueBinding(groupValue);
                          const bound = (selectedRelationshipNode?.children ?? []).some((child) => child.name === "value" && child.text === expectedBinding.text && (child.attributes.datatype ?? "uri") === expectedBinding.datatype && (child.attributes["xml:lang"] ?? "") === (expectedBinding.lang ?? ""));
                          return <article key={memberKey} ref={(element) => { if (element) groupCardRefs.current.set(memberKey, element); else groupCardRefs.current.delete(memberKey); }} data-group-card="true" className="flex min-w-0 flex-col rounded-md border border-border">
                            <header className="group/header flex items-start gap-2 border-b border-border bg-muted px-3 py-2">
                              <input type="checkbox" checked={bound} onChange={(event) => {
                                if (selectedGroupByOption!.direction === "forward") setPropertyValue(activeLeafId, selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                                else setRoleValue(selectedGroupByOption!.uri, { text: expectedBinding.text, datatype: expectedBinding.datatype, ...(expectedBinding.lang ? { lang: expectedBinding.lang } : {}) }, event.currentTarget.checked);
                              }} aria-label={`Filter ${selectedGroupByOption!.label} by ${groupValueLabel}`} className="mt-0.5 size-4 shrink-0 accent-current" />
                              <div className="min-w-0 flex-1">
                                <Tooltip><TooltipTrigger render={<button type="button" onClick={() => setSelectedUri(groupValue.uri)} className="block max-w-full cursor-pointer break-words text-left text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{groupValueLabel}</button>} /><TooltipContent>{"Load this group value in the Record viewer"}</TooltipContent></Tooltip>
                                <p className="mt-0.5 break-all text-xs text-muted-foreground">{groupValue.uri}</p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">{shortenCount(Number(groupValue.columns?.[1]?.value ?? 0))} in group</span>
                              <QueryInspectorButton query={serializeFctQuery(createGroupMemberQuery(queryTree, selectedGroupByOption!, groupValue))} filename={`group-${groupValueLabel.replace(/[^a-z0-9_-]+/gi, "-")}.xml`} />
                            </header>
                            <div className="flex flex-col gap-1 p-2">
                              {members.error ? <p className="px-2 py-2 text-xs text-destructive">{members.error}</p> : members.loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading matching Results items…</p> : members.results.length > 0 ? members.results.map((item) => <button key={item.uri} type="button" onClick={() => setSelectedUri(item.uri)} className={`flex min-w-0 flex-col rounded-md px-2 py-2 text-left hover:bg-accent/50 ${selectedUri === item.uri ? "bg-accent/40" : ""}`}><span className="break-words text-sm font-medium cursor-pointer">{item.termType === "uri" ? toLabel(item.uri, "Class") : item.title || item.uri}</span><span className="mt-0.5 break-all text-xs text-muted-foreground">{item.uri}</span></button>) : <p className="px-2 py-2 text-xs text-muted-foreground">No Results items match this value.</p>}
                            </div>
                          </article>;
                        })}
                        </div>
                      </div>
                    </div>
                  ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Select a property or role in Focus, then choose it from Group by.</p>}
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
                    <ButtonGroup aria-label="Query source format">
                      <Toggle pressed={querySourceFormat === "xml"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("xml"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">XML</Toggle>
                      <Toggle pressed={querySourceFormat === "sparql"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("sparql"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">SPARQL</Toggle>
                      <Toggle pressed={querySourceFormat === "alphabet-xml"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("alphabet-xml"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">Alphabet XML</Toggle>
                      <Toggle pressed={querySourceFormat === "alphabet-sparql"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("alphabet-sparql"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">Alphabet SPARQL</Toggle>
                      <Toggle pressed={querySourceFormat === "response"} onPressedChange={(pressed) => { if (pressed) setQuerySourceFormat("response"); }} className="rounded-none border-0 px-3 py-1.5 text-xs">FCT response</Toggle>
                    </ButtonGroup>
                    <button type="button" onClick={() => { setCentralTab(groupByPropertyUri ? "groups" : "results"); setQueryTreeOpen(true); }} className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Back to Query</button>
                  </div>
                  <CodeBlock
                    className="h-full min-h-0"
                    language={querySourceFormat === "xml" || querySourceFormat === "alphabet-xml" || querySourceFormat === "response" ? "xml" : "sparql"}
                    code={querySourceFormat === "xml" ? prettyQueryXml
                      : querySourceFormat === "sparql" ? sourceSparql
                      : querySourceFormat === "alphabet-xml" ? xmlFormat(alphabetQueryXml, { indentation: "  " })
                      : querySourceFormat === "response" ? resultsRawResponse
                      : alphabetSparql}
                    filename={querySourceFormat === "xml" ? "fct-query.xml"
                      : querySourceFormat === "sparql" ? "query.sparql"
                      : querySourceFormat === "alphabet-xml" ? "alphabet-query.xml"
                      : querySourceFormat === "response" ? "results-fct-response.xml"
                      : "alphabet-query.sparql"}
                  />
                </div>
              )}
              {/* Drag the separator to resize the Results / Query Tree split. */}
              {workspaceTab === "browse" && queryTreeOpen && <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize Query Tree height"
                aria-valuemin={15}
                aria-valuemax={75}
                aria-valuenow={Math.round(queryTreeHeightPercent)}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!(event.buttons & 1) || !centralPaneRef.current) return;
                  const bounds = centralPaneRef.current.getBoundingClientRect();
                  if (bounds.height <= 0) return;
                  const next = Math.max(15, Math.min(75, ((bounds.bottom - event.clientY) / bounds.height) * 100));
                  setQueryTreeHeightPercent(Math.round(next * 10) / 10);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setQueryTreeHeightPercent((height) => Math.max(15, Math.min(75, height + (event.key === "ArrowUp" ? 2 : -2))));
                }}
                className="z-10 flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-border bg-muted/70 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              ><span className="h-0.5 w-10 rounded-full bg-muted-foreground/60" /></div>}
              {/* Query Tree pane: its height is user-resizable and persisted in IndexedDB. */}
              {workspaceTab === "browse" && <div
                id="central-panel-query-tree"
                role="region"
                aria-label="Query Tree"
                aria-hidden={!queryTreeOpen}
                style={{ height: queryTreeOpen ? `${queryTreeHeightPercent}%` : "0%" }}
                className={`shrink-0 overflow-hidden bg-background ${queryTreeOpen ? "visible border-t" : "invisible"}`}
              >
                <div className="h-full overflow-auto p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Live query structure. Changes in Filters, Focus, navigation, and bindings appear here immediately.
                    </p>
                  </div>
                  <ul className="space-y-1">
                    {!search.trim() && !searchNode && !uriNode?.text?.trim() && renderQueryNode({
                      id: "query-everything",
                      name: "everything",
                      attributes: {},
                      children: [],
                    })}
                    {/* <text> and <value> always lead the tree; the sort is stable, so the rest keep query order. */}
                    {queryTree.children
                      .filter((node) => node.name !== "class")
                      .sort((left, right) => Number(right.name === "text" || right.name === "value") - Number(left.name === "text" || left.name === "value"))
                      .map((node) => <Fragment key={node.id}>{renderQueryNode(node)}</Fragment>)}
                  </ul>
                </div>
              </div>}
              {workspaceTab === "browse" && <div className="group/header shrink-0 border-t bg-muted p-3">
                {centralTab === "chat" ? (
                  <div id="maestro-assistant-composer-slot" className="w-full" />
                ) : (<>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      onFocus={() => setCentralTab("chat")}
                      aria-label="Ask the assistant"
                      placeholder="Message Maestro…"
                      value={assistantPromptDraft}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAssistantPromptDraft(value);
                        if (value.length > 0) setCentralTab("chat");
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) return;
                        event.preventDefault();
                        const text = assistantPromptDraft.trim();
                        if (!text) return;
                        const id = ++assistantPromptIdRef.current;
                        setAssistantPendingPrompt({ id, text });
                        setAssistantPromptDraft("");
                        setCentralTab("chat");
                      }}
                      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <ButtonGroup
                    aria-label="Results, badges, and query inspector"
                    className="hidden shrink-0 items-center [&>*+*]:border-l [&>*+*]:border-input group-hover/header:inline-flex"
                  >
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={queryTreeOpen}
                          onPressedChange={setQueryTreeOpen}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label={queryTreeOpen ? "Hide Query Tree" : "Show Query Tree"}
                          aria-controls="central-panel-query-tree"
                          aria-expanded={queryTreeOpen}
                        >
                          <ListTree aria-hidden="true" className="size-4" />
                        </Toggle>
                      } />
                      <TooltipContent>{queryTreeOpen ? "Hide Query Tree" : "Show Query Tree"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={showResultBadges}
                          onPressedChange={(pressed) => {
                            setShowResultBadges(pressed);
                            // Badges start with the record's types, so make sure rdf:type is in the query.
                            if (pressed && !activeViewPropertyFilters.some((node) => node.attributes.iri === RDF_TYPE_URI)) {
                              handlePropertyCheckboxChange(RDF_TYPE_URI, true, false);
                            }
                          }}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label={showResultBadges ? "Badges On" : "Badges Off"}
                        >
                          {showResultBadges ? <Tags aria-hidden="true" className="size-4" /> : <Tag aria-hidden="true" className="size-4" />}
                        </Toggle>
                      } />
                      <TooltipContent>{showResultBadges ? "Badges On" : "Badges Off"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={
                        <button
                          type="button"
                          onClick={() => {
                            resetQuery();
                            setSearch("");
                            setGroupByPropertyUri("");
                            if (centralTab === "groups") setCentralTab("results");
                            setSearchPipelineRun((current) => current + 1);
                          }}
                          className="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label="Reset query"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      } />
                      <TooltipContent>Reset query</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger render={
                        <Toggle
                          pressed={centralTab === "view-query"}
                          onPressedChange={(pressed) => {
                            if (pressed) {
                              groupByBeforeCodeViewRef.current = groupByPropertyUri;
                              setCentralTab("view-query");
                            } else {
                              const retainedGroupBy = groupByBeforeCodeViewRef.current || groupByPropertyUri;
                              if (retainedGroupBy) setGroupByPropertyUri(retainedGroupBy);
                              setCentralTab(retainedGroupBy ? "groups" : "results");
                            }
                          }}
                          className="size-9 shrink-0 border-0 p-0 text-sm data-[state=on]:bg-black data-[state=on]:text-white dark:data-[state=on]:bg-black dark:data-[state=on]:text-white"
                          aria-label="View source"
                        >
                          <Code2 aria-hidden="true" className="size-4" />
                        </Toggle>
                      } />
                      <TooltipContent>View source</TooltipContent>
                    </Tooltip>
                  </ButtonGroup>
                </div>
                {searchError && endpointReadyForQuery && <p className="mt-2 text-sm text-destructive">{searchError}{searchError.includes("Could not load graphs from the personal SPARQL store") && <> Check that your <a href={personalSparqlEndpoint || undefined} target="_blank" rel="noreferrer" className="underline underline-offset-2">personal graph server</a> is online.</>}</p>}
                </>)}
              </div>}
            </section>
            </ResizablePanel>
            {workspaceTab === "browse" && <><ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={18} className="min-w-0">
            <section className="flex h-full min-h-0 min-w-0 flex-col">
              <Collapsible open={recordControlsOpen} onOpenChange={setRecordControlsOpen} className="shrink-0 border-b">
                <div className="group/record-header flex items-center gap-2 px-4 py-3">
                  <CollapsibleTrigger aria-label={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} title={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    {recordControlsOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                  </CollapsibleTrigger>
                  <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
                  {recordFormatEnabled && Boolean(currentFormattedRecordHtml) && formattedRecordButtonsHtml.record_title_icon && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_title_icon }} />
                  )}
                  {recordDescribeIncomplete && <Tooltip><TooltipTrigger render={<span role="img" tabIndex={0} aria-label="Incomplete record description" className="inline-flex shrink-0"><CircleFadingCheck className="size-4" /></span>} /><TooltipContent>Virtuoso returned an incomplete DESCRIBE for this record.</TooltipContent></Tooltip>}
                  {selectedUri ? (
                    <Tooltip><TooltipTrigger render={<button
                      type="button"
                      className={`cursor-pointer text-left underline-offset-2 hover:underline ${facetHoverPreview?.kind === "record" && facetHoverPreview.uri === selectedUri ? "text-purple-700 dark:text-purple-300" : ""}`}
                      onClick={() => { clearTutorialPreview(); applyRecordAsRootValue(selectedUri); }}
                      onMouseEnter={() => beginRecordHoverPreview(selectedUri, selectedResult?.title ?? (selectedGroupRecord ? (selectedGroupRecord.termType === "uri" ? toLabel(selectedGroupRecord.uri) : selectedGroupRecord.title || selectedGroupRecord.uri) : toLabel(selectedUri)))}
                      onMouseLeave={clearTutorialPreview}
                    >{selectedResult?.title ?? (selectedGroupRecord ? (selectedGroupRecord.termType === "uri" ? toLabel(selectedGroupRecord.uri) : selectedGroupRecord.title || selectedGroupRecord.uri) : toLabel(selectedUri))}</button>} /><TooltipContent>{`Set ${selectedUri} as the root record value`}</TooltipContent></Tooltip>
                  ) : "Record"}
                  </h2>
                  {!recordControlsOpen && <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <Separator orientation="vertical" className="h-4 shrink-0" />
                    <span className="truncate" title={selectedRecordGraph || "All graphs"}>{selectedRecordGraph ? toLabel(selectedRecordGraph) : "All graphs"}</span>
                  </div>}
                  {recordControlsOpen && selectedUri && <div className="ml-auto inline-flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/record-header:opacity-100 focus-within:opacity-100">
                    <QueryInspectorButton
                      query={recordRootDebugQuery}
                      filename="record-describe.xml" label="Record queries" toolbarButton
                      extraQueries={[
                        { id: "record-describe-sparql", label: "Record SELECT SPARQL", query: recordDebug.sparql || "Record SELECT has not executed.", filename: "record-select.sparql", language: "sparql" },
                        { id: "formatter-describe-xml", label: "Shared Record DESCRIBE XML", query: recordDebug.formatterXml || "The formatter DESCRIBE has not run for this record.", filename: "record-formatter-describe.xml", language: "xml" },
                        { id: "formatter-describe-sparql", label: "Shared Record DESCRIBE SPARQL", query: recordDebug.formatterSparql || "The formatter DESCRIBE SPARQL is not yet available.", filename: "record-formatter-describe.sparql", language: "sparql" },
                        { id: "record-policy-discovery", label: "Policy discovery SPARQL", query: recordDebug.policyDiscovery || "Policy discovery has not run for this record.", filename: "record-policy-discovery.sparql", language: "sparql" },
                        { id: "record-template-lookup", label: "Format lookup SPARQL", query: recordDebug.templateLookup || "No format has been loaded for this record.", filename: "record-template-lookup.sparql", language: "sparql" },
                      ]}
                    />
                    <Tooltip>
                      <TooltipTrigger render={<button type="button" onClick={downloadRecordDescribe}
                        disabled={!recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || isDescribing}
                        aria-label="Download Record DESCRIBE RDF" title="Download Record DESCRIBE RDF"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40">
                        <Download className="size-4" aria-hidden="true" />
                      </button>} />
                      <TooltipContent>Download DESCRIBE RDF</TooltipContent>
                    </Tooltip>
                  </div>}
                </div>
                <CollapsibleContent className="px-4 pb-3">
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selectedUri}
                </p>
                {selectedUri && <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs">
                    <span className="inline-flex shrink-0 items-center border-r bg-muted/40 px-2 text-muted-foreground">Graphs</span>
                    <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" className="inline-flex min-w-0 max-w-64 items-center gap-1 px-3 py-1.5 hover:bg-accent" title={selectedRecordGraph || "All graphs"}>
                      <span className="truncate">{selectedRecordGraph ? toLabel(selectedRecordGraph) : "All graphs"}</span><ChevronDown className="size-3.5 shrink-0" />
                    </button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 w-80 overflow-auto">
                      <DropdownMenuItem onSelect={() => { setSelectedRecordGraph(""); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }}>All graphs</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {recordGraphOptions.map((graph) => <DropdownMenuItem key={graph} onSelect={() => { setSelectedRecordGraph(graph); setSelectedRecordAuthor(""); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }} title={graph}>{toLabel(graph)}</DropdownMenuItem>)}
                      {!recordGraphs.length && <DropdownMenuLabel>{loadingRecordGraphs ? "Loading graphs…" : "No named graphs found"}</DropdownMenuLabel>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </div>
                  <div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs">
                    <span className="inline-flex shrink-0 items-center border-r bg-muted/40 px-2 text-muted-foreground">Authors</span>
                    <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" disabled={!recordAuthors.length} className="inline-flex min-w-0 max-w-64 items-center gap-1 px-3 py-1.5 hover:bg-accent disabled:opacity-50" title={selectedRecordAuthor || "All authors"}>
                      <span className="truncate">{selectedRecordAuthor ? toLabel(recordAuthors.find((entry) => entry.graph === selectedRecordAuthor)?.author ?? selectedRecordAuthor) : "All authors"}</span><ChevronDown className="size-3.5 shrink-0" />
                    </button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 w-80 overflow-auto">
                      <DropdownMenuItem onSelect={() => { setSelectedRecordAuthor(""); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }}>All authors</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {recordAuthors.map((item) =>
                        <DropdownMenuItem key={`${item.graph}:${item.predicate}:${item.author}`} onSelect={() => { setSelectedRecordAuthor(item.graph); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }} title={`${item.author} · ${item.graph}`}>{toLabel(item.author)} <span className="ml-2 truncate text-xs text-muted-foreground">{item.graph.slice(item.graph.indexOf("#") + 1)}</span></DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {recordGraphError && endpointReadyForQuery && <span className="text-xs text-destructive" title={recordGraphError}>Graph discovery failed</span>}{loadingRecordAuthors && <span className="text-xs text-muted-foreground">Loading authors…</span>}{recordAuthorError && <span className="text-xs text-destructive" title={recordAuthorError}>Author metadata unavailable</span>}
                </div>}
                {(recordPolicy || isLoadingRecordPolicy || recordPolicyError) && <div id="record_button_bar" className="mt-3 flex flex-wrap items-center gap-2">
                  {recordPolicy && <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button type="button" disabled={isValidatingRecord} title="Validate record" aria-label="Validate record" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:cursor-wait disabled:opacity-50">{isValidatingRecord ? <LoaderCircle className="size-4 animate-spin" aria-label="Validating record" /> : <ClipboardCheck className="size-4" aria-hidden="true" />}<span>Validate</span>{recordPolicies.length > 1 && <ChevronDown className="size-3.5" />}</button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        {recordPolicies.map((policy) => <DropdownMenuItem key={policy.uri} onSelect={() => { const templateUri = policy.templates[0]?.uri ?? ""; manualRecordFormatSelectionRef.current = { recordUri: selectedUri, queryXml, policyUri: policy.uri, templateUri }; setRecordPolicy(policy); setSelectedRecordTemplateUri(templateUri); setRecordValidation(null); try { const store = queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences"); const policyKey = recordFormatPreferenceKey("policy"); const templateKey = recordFormatPreferenceKey("template"); if (policyKey) store?.put(policy.uri, policyKey); if (templateKey) store?.put(templateUri, templateKey); } catch (error) { console.warn("Maestro could not persist the selected record policy in IndexedDB", error); } void validateSelectedRecord(policy); }}>{policy.label}</DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu open={recordFormatMenuOpen} onOpenChange={setRecordFormatMenuOpen}>
                      <DropdownMenuTrigger asChild><button type="button" aria-pressed={recordFormatEnabled} disabled={!recordFormatPreferenceLoaded} className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:cursor-wait disabled:opacity-50 ${recordFormatEnabled ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`} title="Format record" aria-label="Format record"><Eye className="size-4" aria-hidden="true" /><span>Format</span><ChevronDown className="size-3.5" /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-80">
                        <DropdownMenuItem onSelect={() => {
                          setRecordFormatEnabled(false);
                          setSelectedRecordTemplateUri("");
                          setFormattedRecordHtml("");
                          setFormattedRecordButtonsHtml({});
                          setRecordFormatError("");
                          try { const key = recordFormatPreferenceKey("template"); if (key) queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences").put("", key); } catch (error) { console.warn("Maestro could not persist the default record format", error); }
                        }} className="flex items-start gap-3 py-3">
                          <span className="flex h-24 w-24 shrink-0 flex-col gap-1 overflow-hidden rounded border bg-background p-2" aria-hidden="true">
                            <span className="border-b pb-1 text-[9px] font-semibold">Name　 Value</span>
                            <span className="h-2 rounded-sm bg-muted" /><span className="h-2 rounded-sm bg-muted/70" /><span className="h-2 rounded-sm bg-muted/50" />
                          </span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium">Default{!recordFormatEnabled && <Check className="size-4 text-primary" aria-label="Selected format" />}</span><span className="block text-xs text-muted-foreground">Property/value table and roles</span></span>
                        </DropdownMenuItem>
                        {recordPolicies.flatMap((policy) => policy.templates.map((template) => ({ policy, template }))).map(({ policy, template }) => <DropdownMenuItem key={`${policy.uri}:${template.uri}`} onSelect={() => { manualRecordFormatSelectionRef.current = { recordUri: selectedUri, queryXml, policyUri: policy.uri, templateUri: template.uri }; setRecordPolicy(policy); setSelectedRecordTemplateUri(template.uri); setRecordValidation(null); setFormattedRecordHtml(""); setFormattedRecordButtonsHtml({}); setRecordFormatError(""); try { const store = queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences"); const policyKey = recordFormatPreferenceKey("policy"); const templateKey = recordFormatPreferenceKey("template"); if (policyKey) store?.put(policy.uri, policyKey); if (templateKey) store?.put(template.uri, templateKey); } catch (error) { console.warn("Maestro could not persist the selected record format in IndexedDB", error); } if (!recordFormatEnabled) setRecordFormatEnabled(true); }} className="flex items-start gap-3 py-3">
                          <span className="mt-0.5 block h-24 w-24 shrink-0 overflow-hidden rounded border bg-background"><span className="pointer-events-none block h-24 w-44 origin-top-left scale-[0.5] overflow-hidden" dangerouslySetInnerHTML={{ __html: (policy.uri === recordPolicy.uri ? recordFormatPreviews[template.uri] : undefined) ?? "<div class=\"p-2 text-xs text-muted-foreground\">Preview available after selection</div>" }} /></span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium">{template.label}{recordFormatEnabled && recordPolicy.uri === policy.uri && selectedRecordTemplateUri === template.uri && <Check className="size-4 shrink-0 text-primary" aria-label="Selected format" />}</span><span className="block break-all text-xs text-muted-foreground">{template.uri}</span></span>
                        </DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>}
                  {isLoadingRecordPolicy && <span className="text-xs text-muted-foreground">Looking for a record policy…</span>}
                  {recordPolicyError && <span className="text-xs text-destructive">{recordPolicyError}</span>}
                  {formattedRecordButtonsHtml.record_button_bar && <div className="contents" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_button_bar }} />}
                </div>}
                {recordValidation && <div className={`mt-3 rounded-md border p-3 text-sm ${recordValidation.conforms ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
                  <button type="button" onClick={() => setRecordValidation(null)} title="Dismiss validation report" aria-label="Dismiss validation report" className="float-right ml-2 inline-flex size-7 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"><X className="size-4" aria-hidden="true" /></button>
                  <p className="font-semibold">{recordValidation.complete ? (recordValidation.conforms ? "SHACL validation passed" : "SHACL validation failed") : "Partial SHACL validation"}</p>
                  <p className="mt-1">{recordValidation.message}</p>
                  {recordValidation.violations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{recordValidation.violations.map((violation, index) => <li key={`${violation.path}-${index}`}>{violation.message}</li>)}</ul>}
                  {(recordValidation.optionalMissing?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">Optional fields not present in this Record snapshot: {Array.from(new Set(recordValidation.optionalMissing!.map((item) => item.name))).join(", ")}. These fields are not required by the selected SHACL shape.</p>}
                  {recordValidation.unsupportedConstraints.length > 0 && <p className="mt-2 break-all text-xs">Unsupported constraints: {recordValidation.unsupportedConstraints.join(", ")}</p>}
                </div>}
                {recordDescriptionError && endpointReadyForQuery && <p role="alert" className="mt-2 text-sm text-destructive">{recordDescriptionError}</p>}
                {recordFormatError && recordFormatError !== recordDescriptionError && <p className="mt-2 text-sm text-destructive">{recordFormatError}</p>}
                {!isDescribing && describedRecordUri === selectedUri &&
                 recordDescriptionSnapshot?.key === currentRecordDescriptionKey && (
                <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t pt-3">
                {describedRecord.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {[
                      describedPropertyCount > 0 ? `${shortenCount(describedPropertyCount)} properties` : null,
                      describedRoleCount > 0 ? `${shortenCount(describedRoleCount)} roles` : null,
                      describedRecord.length > 0 ? `${shortenCount(describedRecord.length)} values` : null,
                    ].filter((part): part is string => part !== null).join(" · ")}
                  </span>
                ) : <span />}
                {describedProperties.length > RECORD_DESCRIPTION_PAGE_SIZE && (
  <div className="flex items-center justify-between gap-2 text-xs">
    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage((page) => Math.max(0, page - 1))}
      disabled={recordDescriptionPage === 0}
    >
      Previous
    </button>

    <span className="text-muted-foreground">
      Page {recordDescriptionPage + 1} of {Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE)}
    </span>

    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage((page) =>
        Math.min(
          Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1,
          page + 1,
        )
      )}
      disabled={recordDescriptionPage >= Math.ceil(describedProperties.length / RECORD_DESCRIPTION_PAGE_SIZE) - 1}
    >
      Next
    </button>
  </div>
)}
                </div>
                )}
                </CollapsibleContent>
              </Collapsible>
              {recordFormatPreferenceLoaded && recordFormatEnabled && selectedUri && !recordDescriptionError && (isDescribing || isLoadingRecordPolicy || (Boolean(authSession) && recordPolicyCheckedUri !== selectedUri) || (Boolean(recordPolicy) && (!recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || (!currentFormattedRecordHtml && !recordFormatError)))) ? (
                <div className="min-h-0 flex-1 overflow-auto p-4 text-sm text-muted-foreground" role="status">Loading formatted record…</div>
              ) : currentFormattedRecordHtml ? (
                <>
                  <div ref={formattedRecordContainerRef} className="min-h-0 flex-1 overflow-auto" dangerouslySetInnerHTML={{ __html: currentFormattedRecordHtml }} />
                  {recordServiceDom && recordServices.length > 0 && createPortal(recordServices.map((service) => (
                    <button key={service.uri} type="button" role="tab" aria-selected={recordServiceTab === service.uri}
                      onClick={() => {
                        setRecordServiceTab(service.uri);
                        if (!recordServiceResults[service.uri]) {
                          const first = service.operations.find((op) => op.requires.length === 0);
                          if (first) void invokeRecordService(service, first);
                        }
                      }}
                      className={`rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent ${recordServiceTab === service.uri ? "bg-accent" : ""}`}>
                      {service.label}
                    </button>
                  )), recordServiceDom.tabs)}
                  {recordServiceDom && createPortal(recordServices.map((service) => {
                    const result = recordServiceResults[service.uri];
                    const args = recordServiceArguments[service.uri] ?? {};
                    return <section key={service.uri} role="tabpanel" hidden={recordServiceTab !== service.uri} className="py-4" aria-label={service.label}>
                      <div className="mb-3 flex flex-wrap gap-2">
                        {service.operations.map((operation) => <button key={operation.uri} type="button"
                          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={Boolean(result?.loading) || operation.requires.some((name) => !args[name])}
                          onClick={() => void invokeRecordService(service, operation)} title={operation.requires.some((name) => !args[name]) ? "Find the book first to resolve the required identifier" : operation.label}>
                          {operation.label}
                        </button>)}
                      </div>
                      {result?.loading && <p role="status" className="text-sm text-muted-foreground">Loading {result.name}…</p>}
                      {result?.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
                      {result?.html && <div className="max-h-[36rem] overflow-auto rounded-md border bg-background p-3" dangerouslySetInnerHTML={{__html:result.html}} />}
                      {!result && <p className="text-sm text-muted-foreground">Select an action to retrieve service data.</p>}
                    </section>;
                  }), recordServiceDom.host)}
                </>
              ) : (
              <section id="maestro-record-viewer" className="min-h-0 flex-1 overflow-auto p-4">
                {describedPropertyRows.length > 0 && <section>
                  <h3 className="mb-2 text-sm font-semibold">Properties</h3>
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="w-[1%] whitespace-nowrap px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {describedPropertyRows.flatMap((item) => item.values.map((value, index) => (
                        <tr key={`${item.property}-${index}`} className="border-b">
                          {index === 0 && <td rowSpan={item.values.length} className="w-[1%] whitespace-nowrap px-3 py-3 align-top font-medium"><button type="button" className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400" title={`Open ${item.property} as a URI query`} onClick={() => openRecordPropertyUri(item.property)}>{toLabel(item.property)}</button></td>}
                          <td className="break-all px-3 py-3 align-top">
                            {value.termType === "bnode" ? (
                              <span title={value.value}>{value.value}</span>
                            ) : (
                              <Tooltip><TooltipTrigger render={<button type="button"
                                className="cursor-pointer break-all text-left font-inherit hover:underline underline-offset-2"
                                onClick={() => navigateResultBadge(item.property, {
                                  value: value.value, type: value.termType,
                                  ...(value.datatype ? { datatype: value.datatype } : {}),
                                  ...(value.lang ? { lang: value.lang } : {}),
                                }, item.direction === "property-of" ? "reverse" : "forward")}
                              ><span className="break-all">{value.termType === "uri"
                                ? (recordUriLabelCacheRef.current.get(`${queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`}\u0000${value.value}`) ?? value.value)
                                : value.value}</span></button>} /><TooltipContent>{`${toLabel(item.property)}${item.direction === "property-of" ? " of" : ""}: ${value.value}${value.lang ? ` @${value.lang}` : ""}${value.datatype ? `^^${value.datatype}` : ""}`}</TooltipContent></Tooltip>
                            )}
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </section>}
                {describedRoleRows.length > 0 && <section className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold">Roles</h3>
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="w-[1%] whitespace-nowrap px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {describedRoleRows.flatMap((item) => item.values.map((value, index) => (
                        <tr key={`${item.property}-of-${index}`} className="border-b">
                          {index === 0 && <td rowSpan={item.values.length} className="w-[1%] whitespace-nowrap px-3 py-3 align-top font-medium"><button type="button" className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400" title={`Open ${item.property} as a URI query`} onClick={() => openRecordPropertyUri(item.property)}>{toLabel(item.property)} of</button></td>}
                          <td className="break-all px-3 py-3 align-top">
                            {value.termType === "bnode" ? (
                              <span title={value.value}>{value.value}</span>
                            ) : (
                              <Tooltip><TooltipTrigger render={<button type="button"
                                className="cursor-pointer break-all text-left font-inherit hover:underline underline-offset-2"
                                onClick={() => navigateResultBadge(item.property, {
                                  value: value.value, type: value.termType,
                                  ...(value.datatype ? { datatype: value.datatype } : {}),
                                  ...(value.lang ? { lang: value.lang } : {}),
                                }, item.direction === "property-of" ? "reverse" : "forward")}
                              ><span className="break-all">{value.termType === "uri"
                                ? (recordUriLabelCacheRef.current.get(`${queryTree.attributes.addr || `${queryTree.attributes.graph?.trim() ?? ""}@${fctEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)?.url ?? ""}`}\u0000${value.value}`) ?? value.value)
                                : value.value}</span></button>} /><TooltipContent>{`${toLabel(item.property)}${item.direction === "property-of" ? " of" : ""}: ${value.value}${value.lang ? ` @${value.lang}` : ""}${value.datatype ? `^^${value.datatype}` : ""}`}</TooltipContent></Tooltip>
                            )}
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </section>}
                {describedRecord.length === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {recordDescriptionError || (isDescribing ? "Loading record…" : selectedUri ? "No description data returned." : "Select a result to describe it.")}
                  </p>
                )}
              </section>
              )}
            </section>
            </ResizablePanel></>}
          </ResizablePanelGroup>

      </div>
      <Dialog open={bookmarkQueryDebugOpen} onOpenChange={setBookmarkQueryDebugOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Bookmark query Code Block</DialogTitle><DialogDescription>Inspect the bounded FCT query, the SPARQL returned by Virtuoso FCT, and both raw responses.</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            <section><h3 className="mb-2 text-sm font-semibold">FCT query XML</h3><CodeBlock code={bookmarkQueryDebug.xml || "No saved query has run yet."} language="xml" filename="bookmark-history-query.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Translated SPARQL</h3><CodeBlock code={bookmarkQueryDebug.sparql} language="sparql" filename="bookmark-history-query.sparql" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">FCT results response</h3><CodeBlock code={bookmarkQueryDebug.response} language="xml" filename="bookmark-history-query-response.xml" /></section>
            <section><h3 className="mb-2 text-sm font-semibold">Count response</h3><CodeBlock code={bookmarkQueryDebug.countResponse} language="xml" filename="bookmark-history-query-count-response.xml" /></section>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
