"use client";

import { DEFAULT_RECORD_TABLE, DEFAULT_RECORD_ROW, DEFAULT_RECORD_PROPERTY_CELL, DEFAULT_RECORD_VALUE_CELL, DEFAULT_RECORD_PROPERTY_BUTTON, DEFAULT_RECORD_VALUE_BUTTON } from "@/canvas/right/default-record-row-style";


import { browserLog } from "@/lib/maestro-client-logging";

import { ErrorDetails } from "@/components/ui/error-details";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { FormattedRecordSkeleton } from "@/canvas/right/formatted-record-skeleton";
import { RecordPerformanceDebug } from "@/canvas/right/record-performance-debug";
import { formatPagePosition } from "@/canvas/utils/pagination";
import { classifyRecordValue, RECORD_VALUE_KINDS, type RecordValueKind } from "@/lib/record-explorer-query";
import { normalizeMaestroKind } from "@/lib/maestro-kinds";
import { buildRecordKindsInspectorSparql } from "@/lib/record-kinds-inspector";
import dynamic from "next/dynamic";
const RecordExplorer = dynamic(() => import("@/canvas/right/record-explorer").then(module => module.RecordExplorer), { ssr: false });
import { decorateFollowedRecordSource, decorateRecordInteractiveTargets, decorateWandedRecordProperties, resolveFullscreenRecordTarget, resolveRecordInteraction, type RecordStatement } from "@/canvas/controllers/record-rdfa-decoration";
import "./record-source-highlight.css";
import { RecordStatusButtons, RecordStarButton } from "@/canvas/right/record-status-buttons";

import { QueryInspectorButton } from "@/canvas/utils/query-inspector";

import { ValidationNotice, hasVisibleValidationWarning } from "@/components/ui/validation-notice";

import maestroLanguages from "@/data/maestro-languages.json";

import { createPortal } from "react-dom";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createRecordExplorerPresentationController } from "@/lib/app-lifecycle/record-explorer-presentation";
import { getMaestroComponentPortals } from "@/components/maestro-xslt-components";
import { toLabel } from "@/lib/uri-labels";

import { Separator } from "@/components/ui/separator";
import { RecordValuePages } from "@/components/ui/record-value-pages";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { materializeBlankNodeRecord } from "@/lib/bnode";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RECORD_EXPORT_FORMATS, type RecordExportFormat } from "@/canvas/right/record-export";

import { Check, ChevronDown, ChevronRight, LoaderCircle, ClipboardCheck, ClockFading, Download, Eye, Expand, FileSearch, Pin, PinOff } from "lucide-react";
import { retryMaestroComponent } from "@/lib/maestro-component-retry";
import { shortenCount } from "@/lib/utils";

import { RightPaneFrame, RightPaneBody } from "@/canvas/workspace-pane-shells";

// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.

const MAESTRO_ALPHABET_LANGUAGES = maestroLanguages;

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
  { label: "schema:name (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/name" },
  { label: "schema:alternateName (HTTP)", description: "Schema.org HTTP namespace", uri: "http://schema.org/alternateName" },
] as const;

import type { RecordPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";

/** One Record viewer for Browse session 0 and every fullscreen pivot session.
 * The controller decides which RDFa actions can touch the live query. */
export type RecordRdfaAction = { sessionIndex: number; statement: RecordStatement; intent: "pivot" | "wand"; kind: "property" | "value" };

type InlineWandItem = { host: HTMLElement; item: NonNullable<Parameters<typeof RightCanvasPanel>[0]["queuedProperties"]>[number]; displayKind: "property" | "value" };

function RecordPaneShell({ fullscreen, children }: { fullscreen: boolean; children: ReactNode }) {
  return fullscreen ? <div className="h-full min-h-0 min-w-0 overflow-hidden">{children}</div>
    : <RightPaneFrame>{children}</RightPaneFrame>;
}

export function RightCanvasPanel({ workspace, sessionIndex = 0, fullscreenPane = false,
  interactionMode = "pointer", followedSource = null, queuedProperties = [], onRdfaAction }: {
  workspace: RecordPaneWorkspace;
  sessionIndex?: number;
  fullscreenPane?: boolean;
  interactionMode?: "pointer" | "wand";
  followedSource?: RecordStatement | null;
  queuedProperties?: readonly {
    predicate: string; direction: "property" | "property-of";
    kind?: "property" | "value"; value?: string;
    termType?: "uri" | "literal" | "bnode";
    datatype?: string; lang?: string; nodeId?: string;
  }[];
  onRdfaAction?: (action: RecordRdfaAction) => void;
}) {
  // XState owns entry/exit and the Pointer/Wand interaction state. Browse's
  // live-query actions are not available inside this fullscreen presentation.
  const [recordExplorerPresentation] = useState(createRecordExplorerPresentationController);
  const recordExplorerSnapshot = useSyncExternalStore(
    recordExplorerPresentation.subscribe, recordExplorerPresentation.getSnapshot,
    recordExplorerPresentation.getSnapshot);
  useEffect(() => {
    // Only the Browse owner runs the fullscreen presentation actor. Each
    // fullscreen Record receives the parent's mode and retains its own data
    // actor, so a pivot cannot accidentally create a second fullscreen owner.
    if (fullscreenPane) return;
    recordExplorerPresentation.start();
    return () => recordExplorerPresentation.stop();
  }, [recordExplorerPresentation, fullscreenPane]);
  const fullscreenRecord = recordExplorerSnapshot.matches("fullscreen");
  const [recordKindFilter,setRecordKindFilterState]=useState<RecordValueKind|"all">(()=>{
    if(typeof window==="undefined")return "all";
    try{const saved=window.localStorage.getItem("maestro:kind:record")||"all";return saved==="all"?"all":normalizeMaestroKind(saved)??"all";}catch{return "all";}
  });
  const setRecordKindFilter=(kind:RecordValueKind|"all")=>{
    setRecordKindFilterState(kind);
    if(typeof window!=="undefined")try{window.localStorage.setItem("maestro:kind:record",kind);}catch{}
  };
  const [xsltPortals, setXsltPortals] = useState<ReturnType<typeof getMaestroComponentPortals>>([]);
  const [recordExportOpen, setRecordExportOpen] = useState(false);
  const [recordExportFormat, setRecordExportFormat] = useState<RecordExportFormat>("turtle");
  const fullscreenFormattedRef = useRef<HTMLDivElement>(null);
  const rdfaHostRef = useRef<HTMLElement>(null);
  const {
    RECORD_DESCRIPTION_PAGE_SIZE,
    activeBlankNodeTab,
    applyRecordAsRootValue,
    authSession,
    beginRecordHoverPreview,
    blankNodeRecords, recordDescriptionRetrySource,
    clearTutorialPreview,
    currentFormattedRecordHtml,
    currentRecordDescriptionKey,
    describedProperties,
    describedPropertyCount,
    describedPropertyRows,
    describedRecord,
    describedRecordUri,
    describedRoleCount,
    describedRoleRows,
    displayedRecord,
    displayedRecordPage,
    displayedRecordPageCount,
    downloadRecordDescribe,
    endpointReadyForQuery,
    facetHoverPreview,
    fctEndpoints,
    formattedRecordButtonsHtml,
    formattedRecordContainerRef,
    invokeRecordService,
    isDescribing,
    isFormattingRecord,
    isLoadingRecordPolicy,
    isValidatingRecord,
    loadingRecordAuthors,
    loadingRecordGraphs,
    manualRecordFormatSelectionRef,
    navigateResultBadge,
    openRecordPropertyUri,
    queryTree,
    queryTreeHeightDbRef,
    queryXml,
    recordAuthorError,
    recordAuthors,
    recordControlsOpen,
    recordDebug,
    recordDescribeIncomplete,
    recordDescriptionError,
    recordDescriptionSnapshot,
    recordDescriptionQueryLimit,
    preferredAlphabetLanguage,
    recordFormatEnabled,
    recordFormatError,
    recordStatus,
    recordFormatMenuOpen,
    recordFormatPreferenceKey, recordFormatPinned, setRecordFormatPinned, recordFormatMemoryEnabled,
    recordFormatPreferenceLoaded,
    recordFormatPreviews,
    recordGraphError,
    recordGraphOptions,
    recordGraphs,
    recordPolicies,
    recordPolicy,
    recordPolicyCheckedUri,
    recordPolicyError,
    recordRootDebugQuery,
    recordServiceArguments,
    recordServiceDom,
    recordServiceResults,
    recordServiceTab,
    recordServices,
    recordUriLabelCacheRef,
    recordValidation,
    selectedEndpointId,
    selectedGroupRecord,
    selectedRecordAuthor,
    selectedRecordGraph,
    selectedRecordTemplateUri,
    selectedRecordTermType,
    selectedResult,
    selectedUri,
    recordSelectionCleared,
    recordIdentityPending,
    setActiveBlankNodeTab,
    chooseBlankNodeSibling,
    setDescribedRecord,
    setExplicitBlankNodeAnchor,
    setFormattedRecordButtonsHtml,
    setFormattedRecordHtml,
    setRecordControlsOpen,
    setRecordDescriptionPage,
    setRecordDescriptionSnapshot,
    setRecordFormatEnabled,
    setRecordFormatError,
    setRecordFormatMenuOpen,
    setRecordPolicy,
    setRecordServiceTab,
    setRecordValidation,
    setSelectedRecordAuthor,
    setSelectedRecordGraph,
    setSelectedRecordTemplateUri,
    setSelectedUri,
    validateSelectedRecord,
    workspaceTab,
  } = workspace;
  // Match the Graph Server menu: a dropdown trigger and a sibling action in one ButtonGroup.
  const recordFormatButtonClass = `inline-flex items-center justify-center gap-1 rounded-md border py-1.5 text-sm font-medium disabled:cursor-wait disabled:opacity-50 ${recordFormatEnabled ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-background hover:bg-accent"}`;
  const recordTitleShimmer = Boolean(selectedUri && (isLoadingRecordPolicy || isFormattingRecord) && !workspace.queryExecutionCancelled);
  const recordHeaderLabel = selectedRecordTermType === "bnode" ? blankNodeRecords[activeBlankNodeTab]?.id ?? selectedUri : [selectedResult?.title, selectedGroupRecord?.title,
    recordUriLabelCacheRef.current.get(`${queryTree.attributes.addr ?? ""}\u0000${selectedUri}`)]
    .find(label => label?.trim() && label !== selectedUri) || toLabel(selectedUri);
  // Fullscreen is a Browse presentation, not a durable global navigation mode.
  // Leaving Browse or clearing session zero closes it without committing a Wand.
  useEffect(() => {
    if (!fullscreenPane && (workspaceTab !== "browse" || !selectedUri)) recordExplorerPresentation.shrink();
  }, [fullscreenPane, workspaceTab, selectedUri, recordExplorerPresentation]);
  // Record description values have already been fetched; scanning them is
  // exact for the currently loaded page and avoids redundant endpoint ASKs.
  const recordKindsScopeXml = `${recordRootDebugQuery}\n<!-- Kinds filter: ${recordKindFilter}. Record Kinds are classified over fetched RDF values in the browser; no separate FCT Kinds request is executed. -->`;
  const recordKindsDiagnosticSparql = buildRecordKindsInspectorSparql(
    selectedUri, selectedRecordTermType, queryTree.attributes.addr ?? "", selectedRecordGraph, recordKindFilter,
  );
  const existingKinds = new Set([...describedPropertyRows, ...describedRoleRows]
    .flatMap(item => item.values.map(value => classifyRecordValue(value.value, value.termType, value.datatype))));
  const availableRecordKinds = RECORD_VALUE_KINDS.filter(kind => existingKinds.has(kind) || kind === recordKindFilter);
  const blankNodeSnapshotReady = selectedRecordTermType !== "bnode" || (activeBlankNodeTab >= 0 && recordDescriptionSnapshot?.key === currentRecordDescriptionKey && Boolean(blankNodeRecords[activeBlankNodeTab]));
  const visibleProperties = (blankNodeSnapshotReady ? describedPropertyRows : []).map(item => ({...item,values:item.values.filter(value => recordKindFilter === "all" || classifyRecordValue(value.value, value.termType, value.datatype) === recordKindFilter)})).filter(item => item.values.length > 0);
  const visibleRoles = (blankNodeSnapshotReady ? describedRoleRows : []).map(item => ({...item,values:item.values.filter(value => recordKindFilter === "all" || classifyRecordValue(value.value, value.termType, value.datatype) === recordKindFilter)})).filter(item => item.values.length > 0);
  const [inlineWands, setInlineWands] = useState<InlineWandItem[]>([]);
  const wandPortalsRef = useRef<InlineWandItem[]>([]);
  const formattedRef = fullscreenPane ? fullscreenFormattedRef : formattedRecordContainerRef;
  // React portals mount only allowlisted shadcn components inside the HTML tree.
  useEffect(() => {
    const host = formattedRef.current;
    if (!host || !currentFormattedRecordHtml) { setXsltPortals([]); return; }
    setXsltPortals(getMaestroComponentPortals(host));
    return () => setXsltPortals([]);
  }, [currentFormattedRecordHtml, formattedRef]);

  // Selection is derived from the successor session's RDF statement. A click
  // does not paint transient classes; every format renders identically.
  useEffect(() => {
    const host = rdfaHostRef.current;
    if (!host || !fullscreenPane) return;
    const paint = () => {
      const rows: RecordStatement[] = describedRecord.map(row => ({
        predicate: row.property, direction: row.direction, value: row.value,
        termType: row.termType, ...(row.datatype ? { datatype: row.datatype } : {}),
        ...(row.lang ? { lang: row.lang } : {}),
      }));
      decorateRecordInteractiveTargets(host, rows);
      decorateFollowedRecordSource(host, followedSource);
      decorateWandedRecordProperties(host, queuedProperties, rows);
      // Keep the selected RDFa original in the DOM (including all RDFa
      // attributes) but replace its visual text with a real inline InputGroup.
      // Never move a selection into a detached toolbar.
      const next: InlineWandItem[] = [];
      for (const atom of Array.from(host.querySelectorAll<HTMLElement>("[data-maestro-wanded]"))) {
        const found = resolveFullscreenRecordTarget(atom, rows);
        if (!found) continue;
        // A value Wand also adorns its predicate, using the SAME query-node
        // identity.  It does not add a separate predicate-only query binding.
        const item = queuedProperties.find(selected =>
          selected.predicate === found.statement.predicate &&
          selected.direction === found.statement.direction &&
          (found.kind === "property" ||
           ((selected.kind ?? "property") === "value" &&
            selected.value === found.statement.value && selected.termType === found.statement.termType &&
            (selected.datatype ?? "") === (found.statement.datatype ?? "") &&
            (selected.lang ?? "").toLowerCase() === (found.statement.lang ?? "").toLowerCase())));
        if (!item) continue;
        let slot = atom.nextElementSibling;
        if (!slot?.hasAttribute("data-maestro-inline-wand-slot")) {
          slot = document.createElement("div");
          slot.setAttribute("data-maestro-inline-wand-slot", "true");
          slot.className = "inline-flex min-w-0 max-w-full align-middle";
          atom.after(slot);
        }
        atom.setAttribute("data-maestro-wand-inline-replaced", "true");
        next.push({host:slot as HTMLElement,item,displayKind:found.kind});
      }
      const remaining = new Set(next.map(portal => portal.host));
      for (const old of wandPortalsRef.current) {
        if (!remaining.has(old.host)) old.host.remove();
      }
      // Any previously selected text that is no longer in the queue becomes
      // visible again. These attributes are DOM decorations, never RDF edits.
      for (const atom of Array.from(host.querySelectorAll<HTMLElement>("[data-maestro-wand-inline-replaced]"))) {
        if (!atom.hasAttribute("data-maestro-wanded")) atom.removeAttribute("data-maestro-wand-inline-replaced");
      }
      const previous = wandPortalsRef.current;
      if (previous.length !== next.length || next.some((entry,index) =>
          entry.host !== previous[index]?.host || entry.item !== previous[index]?.item || entry.displayKind !== previous[index]?.displayKind)) {
        wandPortalsRef.current = next;
        setInlineWands(next);
      }
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(host, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const entry of wandPortalsRef.current) entry.host.remove();
      wandPortalsRef.current = [];
    };
  }, [fullscreenPane, currentFormattedRecordHtml, describedRecord, recordKindFilter,
      followedSource?.predicate, followedSource?.direction, followedSource?.termType,
      followedSource?.value, followedSource?.datatype, followedSource?.lang,
      queuedProperties.map(item => [item.kind, item.direction, item.predicate,
        item.value, item.termType, item.datatype, item.lang].join("\u0000")).join("\u0001")]);

  const onRecordClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (fullscreenPane) {
      // The inline shadcn Wand group is its OWN selection control. It toggles
      // once via its React portal; never also dispatch the underlying RDFa dt.
      if (target.closest("[data-maestro-inline-wand-slot]")) return;
      // These are local record controls, not query actions. Let the formatter
      // drive its own carousel without delegating to Browse's query API.
      if (target.closest("[data-maestro-carousel]")) {
        const control = target.closest("[data-maestro-carousel]");
        const direction = control?.getAttribute("data-maestro-carousel") === "previous" ? -1 : 1;
        const carousel = control?.closest("#record-carousel, [id$='-record-carousel']");
        const track = carousel?.querySelector<HTMLElement>("#record-carousel-track, [id$='-record-carousel-track']");
        if (track) track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" });
        event.preventDefault(); event.stopPropagation();
        return;
      }
      const rows: RecordStatement[] = describedRecord.map(row => ({
        predicate: row.property, direction: row.direction, value: row.value,
        termType: row.termType,
        ...(row.datatype ? { datatype: row.datatype } : {}),
        ...(row.lang ? { lang: row.lang } : {}),
      }));
      const picked = resolveFullscreenRecordTarget(target, rows);
      if (picked) {
        // Fullscreen owns both property and value clicks. Never execute any
        // legacy Browse live-query handler from a fullscreen Record pane.
        event.preventDefault(); event.stopPropagation();
        if (!onRdfaAction) return;
        if (interactionMode === "wand") {
          onRdfaAction({ sessionIndex, statement: picked.statement, intent: "wand", kind: picked.kind });
        } else if (picked.kind === "value" && picked.statement.value) {
          // Ordinary pointer click opens the next Record; Shift-click is also
          // supported for backwards-compatible pivot navigation.
          onRdfaAction({ sessionIndex, statement: picked.statement, intent: "pivot", kind: "value" });
        }
        return;
      }
      // An unannotated formatter button or record hyperlink can contain a
      // legacy mui:action. Block that action without blocking Record controls.
      if (target.closest("[mui\\:action],[data-maestro-filter-property],a[href]") &&
          !target.closest("[data-maestro-record-control]")) {
        event.preventDefault(); event.stopPropagation();
      }
      return;
    }
    // Browse's URI values now behave like the Record title: plain click opens
    // that resource as the root query. Shift-click keeps the historical
    // predicate/value lookup. Fullscreen remains entirely independent.
    const rows: RecordStatement[] = describedRecord.map(row => ({ predicate: row.property,
      direction: row.direction, value: row.value, termType: row.termType,
      ...(row.datatype ? { datatype: row.datatype } : {}),
      ...(row.lang ? { lang: row.lang } : {}) }));
    // Preserve Browse's existing legacy formatter actions; only fullscreen
    // substitutes the independent session/Wand interaction semantics.
    if (sessionIndex === 0 &&
        target.closest('[data-maestro-filter-property],[mui\\:action],[data-maestro-carousel]') &&
        interactionMode === "pointer" && !event.shiftKey) return;
    const binding = resolveRecordInteraction(target, rows, false);
    const label = target.closest("button[about][data-maestro-predicate]");
    if (label && sessionIndex === 0 && interactionMode === "pointer") {
      event.preventDefault(); event.stopPropagation();
      const predicate = label.getAttribute("data-maestro-predicate");
      if (predicate) openRecordPropertyUri(predicate);
      return;
    }
    if (binding && binding.value && sessionIndex === 0 && interactionMode === "pointer" && target.closest("a,button,[role=button]")) {
      // A literal/blank node has no ordinary root-URI navigation; its existing
      // predicate/value action is available only via Shift+click.
      if (binding.termType !== "uri" && !event.shiftKey) return;
      event.preventDefault(); event.stopPropagation();
      if (binding.termType === "bnode") {
        if (selectedRecordTermType === "uri") {
          setExplicitBlankNodeAnchor({ label: binding.value, parent: selectedUri, predicate: binding.predicate, direction: binding.direction === "property-of" ? "reverse" : "forward", queryXml });
          setSelectedUri(binding.value);
        }
      } else if (!event.shiftKey && binding.termType === "uri") {
        clearTutorialPreview();
        applyRecordAsRootValue(binding.value);
      } else {
        navigateResultBadge(binding.predicate, { value: binding.value, type: binding.termType,
          ...(binding.datatype ? { datatype: binding.datatype } : {}),
          ...(binding.lang ? { lang: binding.lang } : {}) },
          binding.direction === "property-of" ? "reverse" : "forward");
      }
    }
  }, [describedRecord, interactionMode, fullscreenPane, onRdfaAction, sessionIndex,
      openRecordPropertyUri, selectedRecordTermType, selectedUri, setExplicitBlankNodeAnchor, queryXml,
      setSelectedUri, navigateResultBadge, applyRecordAsRootValue, clearTutorialPreview]);

  useEffect(() => {
    const host = rdfaHostRef.current;
    if (!host || fullscreenPane) return;
    const update = (event: KeyboardEvent) => { host.dataset.maestroRecordShift = event.shiftKey ? "true" : "false"; };
    const clear = () => { host.dataset.maestroRecordShift = "false"; };
    document.addEventListener("keydown", update);
    document.addEventListener("keyup", update);
    window.addEventListener("blur", clear);
    return () => { document.removeEventListener("keydown", update); document.removeEventListener("keyup", update); window.removeEventListener("blur", clear); };
  }, [fullscreenPane]);

  return (
<>
{fullscreenPane && inlineWands.map(({host,item,displayKind},index) => createPortal(
  <InputGroup key={`${sessionIndex}:${index}:${item.nodeId ?? "?"}`}
    className="!inline-flex !w-auto min-w-0 max-w-full !flex-wrap break-words border-sky-400/60 bg-sky-100/70 text-sky-900 shadow-none cursor-pointer hover:bg-sky-200/80 dark:border-sky-400/50 dark:bg-sky-900/30 dark:text-sky-100"
    role="button" tabIndex={0} aria-pressed="true"
    onClick={event => { event.preventDefault(); event.stopPropagation();
      onRdfaAction?.({sessionIndex,intent:"wand",kind:item.kind ?? "property",
        statement:{predicate:item.predicate,direction:item.direction,value:item.value ?? "",
          termType:item.termType ?? "uri",datatype:item.datatype,lang:item.lang}});
    }}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();
      onRdfaAction?.({sessionIndex,intent:"wand",kind:item.kind ?? "property",
        statement:{predicate:item.predicate,direction:item.direction,value:item.value ?? "",
          termType:item.termType ?? "uri",datatype:item.datatype,lang:item.lang}});
    } }}
    aria-label={`Unselect ${displayKind === "value" ? "bound value" : "property"} for node ${item.nodeId ?? "?"}`}>
    <InputGroupAddon className="shrink-0 border-r border-sky-400/30 px-2">
      <InputGroupText className="font-mono text-xs font-semibold text-inherit">{item.nodeId ?? "?"}</InputGroupText>
    </InputGroupAddon>
    <InputGroupAddon align="inline-end" className="min-w-0 flex-[1_1_auto] gap-1 px-2 !whitespace-normal">
      <InputGroupText className="min-w-0 !whitespace-normal break-all text-xs text-inherit" title={displayKind === "value" ? item.value : item.predicate}>
        {displayKind === "value" ? `= ${item.termType === "uri" ? toLabel(item.value ?? "") : item.value ?? ""}` :
          `${toLabel(item.predicate)}${item.direction === "property-of" ? " of" : ""}`}
      </InputGroupText>
    </InputGroupAddon>
  </InputGroup>, host,
))}
{workspaceTab === "browse" && <>
            <RecordPaneShell fullscreen={fullscreenPane}>
            <RightPaneBody paneRef={rdfaHostRef} onClickCapture={onRecordClickCapture}>
              <Collapsible open={recordControlsOpen} onOpenChange={setRecordControlsOpen} className="shrink-0 border-b">
                <div className="group/record-header px-4 pt-1 pb-0"
                ><div className="flex min-w-0 items-center gap-2">
                  {sessionIndex === 0 && workspace.accessCapabilities.canShowRecordStatusActions && recordStatus.enabled && selectedUri && selectedRecordTermType !== "bnode" && <RecordStarButton statuses={recordStatus} />}
                  <div className="min-w-0 flex-1"><h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
                  {recordFormatEnabled && Boolean(currentFormattedRecordHtml) && formattedRecordButtonsHtml.record_title_icon && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_title_icon }} />
                  )}
                  {recordDescribeIncomplete && <Tooltip><TooltipTrigger render={<button type="button" onClick={() => retryMaestroComponent(recordDescriptionRetrySource)} aria-label="Retry only this Record DESCRIBE" title="Retry only this Record DESCRIBE" className="inline-flex shrink-0 items-center rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><ClockFading className="size-4" /></button>} /><TooltipContent>Virtuoso returned an incomplete DESCRIBE. Click to retry this Record without refreshing Browse.</TooltipContent></Tooltip>}
                  {selectedUri && (selectedRecordTermType === "bnode" || fullscreenPane || sessionIndex > 0) ? <span title={selectedRecordTermType === "bnode" ? `${recordHeaderLabel} (reconstructed Record; blank-node labels are response-local)` : selectedUri} className={`truncate ${recordTitleShimmer ? "shimmer motion-reduce:shimmer-none" : ""}`}>{recordHeaderLabel}</span> : selectedUri ? (
                    <Tooltip><TooltipTrigger render={<button
                      type="button"
                      className={`cursor-pointer text-left underline-offset-2 hover:underline ${recordTitleShimmer ? "shimmer motion-reduce:shimmer-none" : ""} ${facetHoverPreview?.kind === "record" && facetHoverPreview.uri === selectedUri ? "text-purple-700 dark:text-purple-300" : ""}`}
                      onClick={() => { if (selectedRecordTermType !== "bnode") { clearTutorialPreview(); applyRecordAsRootValue(selectedUri); } }}
                      onMouseEnter={() => beginRecordHoverPreview(selectedUri, selectedResult?.title ?? (selectedGroupRecord ? (selectedGroupRecord.termType === "uri" ? toLabel(selectedGroupRecord.uri) : selectedGroupRecord.title || selectedGroupRecord.uri) : toLabel(selectedUri)))}
                      onMouseLeave={clearTutorialPreview}
                    >{recordHeaderLabel}</button>} /><TooltipContent>{`Set ${selectedUri} as the root record value`}</TooltipContent></Tooltip>
                  ) : recordSelectionCleared ? "Common values across the result set" : "Record"}
                  </h2>
                  </div>
                  {!recordControlsOpen && <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <Separator orientation="vertical" className="h-4 shrink-0" />
                    <span className="truncate" title={selectedRecordTermType === "bnode" ? (recordGraphs[0] || "All graphs query scope") : selectedRecordGraph || "All graphs"}>{selectedRecordTermType === "bnode" ? (recordGraphs[0] ? toLabel(recordGraphs[0]) : "All graphs query scope") : selectedRecordGraph ? toLabel(selectedRecordGraph) : "All graphs"}</span>
                  </div>}
                  {selectedUri && <div className="inline-flex max-w-0 shrink-0 items-center gap-1 overflow-hidden relative -top-1 p-1 opacity-0 transition-all duration-150 group-hover/record-header:max-w-[22rem] group-hover/record-header:overflow-visible group-hover/record-header:opacity-100 focus-within:max-w-[22rem] focus-within:overflow-visible focus-within:opacity-100">
                    <CollapsibleTrigger aria-label={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} title={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground">
                      {recordControlsOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                    </CollapsibleTrigger>
                    {!fullscreenPane && <Tooltip><TooltipTrigger render={<button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground" title="Expand Record to fullscreen explorer" aria-label="Expand Record" onClick={() => recordExplorerPresentation.expand()}><Expand className="size-4" /></button>} /><TooltipContent>Expand Record</TooltipContent></Tooltip>}
                    <QueryInspectorButton
                      query={selectedRecordTermType === "bnode" ? (recordDebug.xml || "A blank-node Record request has not executed yet.") : recordRootDebugQuery}
                      filename="record-describe.xml" label="Record queries" toolbarButton
                      extraQueries={[
                        { id: "record-kinds-xml", label: "Kinds XML", query: recordKindsScopeXml, filename: "record-kinds-scope.xml", language: "xml" },
                        { id: "record-kinds-sparql", label: "Kinds SPARQL", query: recordKindsDiagnosticSparql, filename: "record-kinds-preview.sparql", language: "sparql" },
                        { id: "record-describe-sparql", label: "Record SELECT SPARQL", query: recordDebug.sparql || "Record SELECT has not executed.", filename: "record-select.sparql", language: "sparql" },
                        { id: "formatter-describe-xml", label: "Shared Record DESCRIBE XML", query: recordDebug.formatterXml || "The formatter DESCRIBE has not run for this record.", filename: "record-formatter-describe.xml", language: "xml" },
                        { id: "formatter-describe-sparql", label: "Shared Record DESCRIBE SPARQL", query: recordDebug.formatterSparql || "The formatter DESCRIBE SPARQL is not yet available.", filename: "record-formatter-describe.sparql", language: "sparql" },
                        { id: "record-policy-discovery", label: "Policy discovery SPARQL", query: recordDebug.policyDiscovery || "Policy discovery has not run for this record.", filename: "record-policy-discovery.sparql", language: "sparql" },
                        { id: "record-template-lookup", label: "Format lookup SPARQL", query: recordDebug.templateLookup || "No format has been loaded for this record.", filename: "record-template-lookup.sparql", language: "sparql" },
                      ]}
                    />
                    <Tooltip>
                      <TooltipTrigger render={<button type="button" onClick={() => setRecordExportOpen(true)}
                        disabled={selectedRecordTermType === "bnode" || !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || isDescribing}
                        aria-label="Download Record DESCRIBE RDF" title="Download Record DESCRIBE RDF"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40">
                        <Download className="size-4" aria-hidden="true" />
                      </button>} />
                      <TooltipContent>Download DESCRIBE RDF</TooltipContent>
                    </Tooltip>
                  </div>}
                  <Dialog open={recordExportOpen} onOpenChange={setRecordExportOpen}>
                    <DialogContent showCloseButton>
                      <DialogHeader><DialogTitle>Download Record DESCRIBE</DialogTitle>
                        <DialogDescription>Choose the RDF serialization and MIME type. Downloads use the complete, validated Record snapshot and preserve RDF term identities.</DialogDescription>
                      </DialogHeader>
                      <label htmlFor="record-rdf-format" className="text-sm font-medium">RDF serialization</label>
                      <Select value={recordExportFormat} onValueChange={(format) => setRecordExportFormat(format as RecordExportFormat)}>
                        <SelectTrigger id="record-rdf-format" aria-label="Record download MIME type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECORD_EXPORT_FORMATS).map(([id, entry]) => <SelectItem key={id} value={id}>{entry.name} — {entry.mime} (.{entry.extension})</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setRecordExportOpen(false)}>Cancel</Button>
                        <Button type="button" onClick={() => { void downloadRecordDescribe(recordExportFormat); setRecordExportOpen(false); }}><Download className="mr-1 size-4"/>Download</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                  {selectedUri && <p className="min-w-0 w-full break-all text-xs leading-tight text-muted-foreground">{selectedRecordTermType === "bnode" ? recordHeaderLabel : selectedUri}</p>}
                </div>
                <CollapsibleContent className="px-4 pb-2">
                {selectedUri && <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs">
                    <span className="inline-flex shrink-0 items-center border-r bg-muted/40 px-2 text-muted-foreground">Graphs</span>
                    {selectedRecordTermType === "bnode" ? (
                      <span className="inline-flex min-w-0 max-w-64 items-center px-3 py-1.5 font-medium" title={recordGraphs[0] || "Query scope; individual blank-node graph provenance is not known"}>{recordGraphs[0] ? toLabel(recordGraphs[0]) : "Query scope (all graphs)"}</span>
                    ) : <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" className="inline-flex min-w-0 max-w-64 items-center gap-1 px-3 py-1.5 hover:bg-accent" title={selectedRecordGraph || "All graphs"}>
                      <span className="truncate">{selectedRecordGraph ? toLabel(selectedRecordGraph) : "All graphs"}</span><ChevronDown className="size-3.5 shrink-0" />
                    </button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 w-80 overflow-auto">
                      <DropdownMenuItem onSelect={() => { setSelectedRecordGraph(""); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }}>All graphs</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {recordGraphOptions.map((graph) => <DropdownMenuItem key={graph} onSelect={() => { setSelectedRecordGraph(graph); setSelectedRecordAuthor(""); setRecordDescriptionPage(0); setFormattedRecordHtml(""); }} title={graph}>{toLabel(graph)}</DropdownMenuItem>)}
                      {!recordGraphs.length && <DropdownMenuLabel>{loadingRecordGraphs ? <ElapsedStatus label="Loading graphs" category="record" clockScope="recordGraphs" /> : "No named graphs found"}</DropdownMenuLabel>}
                    </DropdownMenuContent>
                  </DropdownMenu>}
                  </div>
                  <div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs">
                    <span className="inline-flex shrink-0 items-center border-r bg-muted/40 px-2 text-muted-foreground">Authors</span>
                    <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" disabled={selectedRecordTermType === "bnode" || !recordAuthors.length} className="inline-flex min-w-0 max-w-64 items-center gap-1 px-3 py-1.5 hover:bg-accent disabled:opacity-50" title={selectedRecordAuthor || "All authors"}>
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
                  <div className="inline-flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs">
                    <span className="inline-flex shrink-0 items-center border-r bg-muted/40 px-2 text-muted-foreground">Kind</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button type="button" aria-label="Record object kind" title="Filter Record RDF objects by kind" className="inline-flex min-w-0 items-center gap-1 px-3 py-1.5 hover:bg-accent">
                        <span>{recordKindFilter === "all" ? "All kinds" : recordKindFilter}</span><ChevronDown className="size-3.5 shrink-0" />
                      </button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => setRecordKindFilter("all")}>All kinds</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {availableRecordKinds.map(kind => <DropdownMenuItem key={kind} onSelect={() => setRecordKindFilter(kind)}>{kind}</DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {sessionIndex === 0 && workspace.accessCapabilities.canShowRecordStatusActions && recordStatus.enabled && selectedRecordTermType !== "bnode" && <RecordStatusButtons statuses={recordStatus} />}
                  {recordGraphError && endpointReadyForQuery && <ErrorDetails prefix="Graph discovery failed" error={recordGraphError} />}{loadingRecordAuthors && <span className="text-xs text-muted-foreground"><ElapsedStatus label="Loading authors" category="record" clockScope="recordAuthors" /></span>}{recordAuthorError && <ErrorDetails prefix="Author metadata" error={recordAuthorError} />}
                </div>}
                {(recordPolicy || isLoadingRecordPolicy || recordPolicyError) && <div id="record_button_bar" className="mt-3 flex flex-wrap items-center gap-2">
                  {recordPolicy && <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button type="button" disabled={isValidatingRecord} title="Validate record" aria-label="Validate record" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:cursor-wait disabled:opacity-50">{isValidatingRecord ? <LoaderCircle className="size-4 animate-spin" aria-label="Validating record" /> : <ClipboardCheck className="size-4" aria-hidden="true" />}<span>Validate</span>{recordPolicies.length > 1 && <ChevronDown className="size-3.5" />}</button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className={fullscreenPane ? "z-[120] w-72" : "w-72"}>
                        {recordPolicies.map((policy) => <DropdownMenuItem key={policy.uri} onSelect={() => { const templateUri = policy.templates[0]?.uri ?? ""; manualRecordFormatSelectionRef.current = { recordUri: selectedUri, queryXml, policyUri: policy.uri, templateUri }; setRecordPolicy(policy); setSelectedRecordTemplateUri(templateUri); setRecordValidation(null); try { const store = recordFormatMemoryEnabled() ? queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences") : undefined; const policyKey = recordFormatPreferenceKey("policy"); const templateKey = recordFormatPreferenceKey("template"); if (policyKey) store?.put(policy.uri, policyKey); if (templateKey) store?.put(templateUri, templateKey); } catch (error) { browserLog.warn("record.policy.persist-failed", error); } void validateSelectedRecord(policy); }}>{policy.label}</DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ButtonGroup aria-label="Record format and pin" className="shrink-0">
                    <DropdownMenu open={recordFormatMenuOpen} onOpenChange={setRecordFormatMenuOpen}>
                      <DropdownMenuTrigger asChild><button type="button" aria-pressed={recordFormatEnabled} disabled={!recordFormatPreferenceLoaded} className={`${recordFormatButtonClass} px-3`} title="Format record" aria-label="Format record"><Eye className="size-4" aria-hidden="true" /><span>Format</span><ChevronDown className="size-3.5" /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className={fullscreenPane ? "z-[120] w-80" : "w-80"}>
                        <DropdownMenuItem onSelect={() => {
                          manualRecordFormatSelectionRef.current = { recordUri: selectedUri, queryXml, policyUri: recordPolicy.uri, templateUri: "" };
                          setRecordFormatEnabled(false);
                          setSelectedRecordTemplateUri("");
                          setFormattedRecordHtml("");
                          setFormattedRecordButtonsHtml({});
                          setRecordFormatError("");
                          try { const key = recordFormatPreferenceKey("template"); if (key) queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences").put("", key); } catch (error) { browserLog.warn("record.default-format.persist-failed", error); }
                        }} className="flex items-start gap-3 py-3">
                          <span className="flex h-24 w-24 shrink-0 flex-col gap-1 overflow-hidden rounded border bg-background p-2" aria-hidden="true">
                            <span className="border-b pb-1 text-[9px] font-semibold">Name　 Value</span>
                            <span className="h-2 rounded-sm bg-muted" /><span className="h-2 rounded-sm bg-muted/70" /><span className="h-2 rounded-sm bg-muted/50" />
                          </span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium">Default{!recordFormatEnabled && <Check className="size-4 text-primary" aria-label="Selected format" />}</span><span className="block text-xs text-muted-foreground">Property/value table and roles</span></span>
                        </DropdownMenuItem>
                        {recordPolicies.flatMap((policy) => policy.templates.map((template) => ({ policy, template }))).map(({ policy, template }) => <DropdownMenuItem key={`${policy.uri}:${template.uri}`} onSelect={() => { manualRecordFormatSelectionRef.current = { recordUri: selectedUri, queryXml, policyUri: policy.uri, templateUri: template.uri }; setRecordPolicy(policy); setSelectedRecordTemplateUri(template.uri); setRecordValidation(null); setFormattedRecordHtml(""); setFormattedRecordButtonsHtml({}); setRecordFormatError(""); try { const store = recordFormatMemoryEnabled() ? queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences") : undefined; const policyKey = recordFormatPreferenceKey("policy"); const templateKey = recordFormatPreferenceKey("template"); if (policyKey) store?.put(policy.uri, policyKey); if (templateKey) store?.put(template.uri, templateKey); } catch (error) { browserLog.warn("record.format.persist-failed", error); } if (!recordFormatEnabled) setRecordFormatEnabled(true); }} className="flex items-start gap-3 py-3">
                          <span className="mt-0.5 block h-24 w-24 shrink-0 overflow-hidden rounded border bg-background"><span className="pointer-events-none block h-24 w-44 origin-top-left scale-[0.5] overflow-hidden" dangerouslySetInnerHTML={{ __html: (policy.uri === recordPolicy.uri ? recordFormatPreviews[template.uri] : undefined) ?? "<div class=\"p-2 text-xs text-muted-foreground\">Preview available after selection</div>" }} /></span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-medium">{template.label}{recordFormatEnabled && recordPolicy.uri === policy.uri && selectedRecordTemplateUri === template.uri && <Check className="size-4 shrink-0 text-primary" aria-label="Selected format" />}</span><span className="block break-all text-xs text-muted-foreground">{template.uri}</span></span>
                        </DropdownMenuItem>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                      <button type="button" className={`${recordFormatButtonClass} w-8`} aria-pressed={recordFormatPinned}
                        disabled={!recordFormatPreferenceLoaded} title={recordFormatPinned ? "Unpin Format" : "Pin Format"}
                        aria-label={recordFormatPinned ? "Unpin Format" : "Pin Format"} onClick={() => {
                          const pinned = !recordFormatPinned;
                          // Changing memory mode must not change the current Record's format.
                          const currentChoice = recordPolicy && recordPolicyCheckedUri === selectedUri && !isLoadingRecordPolicy
                            ? { recordUri: selectedUri, queryXml, policyUri: recordPolicy.uri, templateUri: recordFormatEnabled ? selectedRecordTemplateUri : "" }
                            : null;
                          if (currentChoice) manualRecordFormatSelectionRef.current = currentChoice;
                          setRecordFormatPinned(pinned);
                          if (!pinned || !currentChoice) return;
                          try {
                            const policyKey = recordFormatPreferenceKey("policy"), templateKey = recordFormatPreferenceKey("template");
                            const store = queryTreeHeightDbRef.current?.transaction("preferences", "readwrite").objectStore("preferences");
                            if (policyKey) store?.put(currentChoice.policyUri, policyKey);
                            if (templateKey) store?.put(currentChoice.templateUri, templateKey);
                          } catch (error) { browserLog.warn("record.format.pin-persist-failed", error); }
                        }}>
                        {recordFormatPinned ? <Pin className="size-4 fill-current" aria-hidden="true"/> : <PinOff className="size-4" aria-hidden="true"/>}
                      </button>
                    </ButtonGroup>
                  </>}
                  {isLoadingRecordPolicy && <span className="text-xs text-muted-foreground">Looking for a record policy…</span>}
                  {recordPolicyError && <ErrorDetails prefix="Record policy" error={recordPolicyError} />}
                  {formattedRecordButtonsHtml.record_button_bar && <div className="contents" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_button_bar }} />}
                </div>}
                <ValidationNotice report={recordValidation} onDismiss={() => setRecordValidation(null)} />
                {recordDescriptionError && endpointReadyForQuery && <ErrorDetails prefix="Record SELECT" error={recordDescriptionError} className="mt-2" onRetry={() => retryMaestroComponent(recordDescriptionRetrySource)} />}
                {recordFormatError && recordFormatError !== recordDescriptionError && !hasVisibleValidationWarning(recordValidation) && <ErrorDetails prefix="Record formatter" error={recordFormatError} className="mt-2" />}
                {!isDescribing && describedRecordUri === selectedUri &&
                 recordDescriptionSnapshot?.key === currentRecordDescriptionKey && (
                <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t pt-3">
                {displayedRecord.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {[
                      describedPropertyCount > 0 ? `${shortenCount(describedPropertyCount)} properties` : null,
                      describedRoleCount > 0 ? `${shortenCount(describedRoleCount)} roles` : null,
                      displayedRecord.length > 0 ? `${shortenCount(displayedRecord.length)} values` : null,
                    ].filter((part): part is string => part !== null).join(" · ")}
                  </span>
                ) : <span />}
                {describedProperties.length > RECORD_DESCRIPTION_PAGE_SIZE && (
  <div className="flex items-center justify-between gap-2 text-xs">
    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage(Math.max(0, displayedRecordPage - 1))}
      disabled={displayedRecordPage === 0}
    >
      Previous
    </button>

    <span className="text-muted-foreground">
      {formatPagePosition(displayedRecordPage, displayedRecordPageCount)}
    </span>

    <button
      type="button"
      className="rounded border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => setRecordDescriptionPage(Math.min(displayedRecordPageCount - 1, displayedRecordPage + 1))}
      disabled={displayedRecordPage >= displayedRecordPageCount - 1}
    >
      Next
    </button>
  </div>
)}
                </div>
                )}
                </CollapsibleContent>
              </Collapsible>
              {!selectedUri && !recordSelectionCleared && !recordIdentityPending ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No Record selected — select a result to inspect its properties and roles</p>
              ) : recordIdentityPending ? (
                <FormattedRecordSkeleton
                  label="Waiting for Results"
                  pending={recordIdentityPending}
                  state="unconfirmed"
                />
              ) : selectedRecordTermType !== "bnode" && recordFormatPreferenceLoaded && recordFormatEnabled && selectedUri && !recordDescriptionError && (isDescribing || isLoadingRecordPolicy || isFormattingRecord || isValidatingRecord) ? (
                <FormattedRecordSkeleton
                  label={recordPolicy && selectedRecordTemplateUri ? ("Loading record (formatted)") : "Loading record"}
                  clockScope={recordPolicy && selectedRecordTemplateUri ? "policies" : isDescribing ? "record" : "policies"}
                  state="loading"
                />
              ) : selectedRecordTermType !== "bnode" && currentFormattedRecordHtml ? (
                <>
                  <RecordPerformanceDebug />
                  <div key={currentFormattedRecordHtml} ref={formattedRef} className="maestro-record-format-surface min-h-0 w-full min-w-0 flex-1 overflow-auto" dangerouslySetInnerHTML={{ __html: currentFormattedRecordHtml }} />
                  {xsltPortals}
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
                          onClick={() => void invokeRecordService(service, operation)} title={operation.requires.some((name) => !args[name]) ? "Resolve the required identifier before running this operation" : operation.label}>
                          {operation.label}
                        </button>)}
                      </div>
                      {result?.loading && <p role="status" className="text-sm text-muted-foreground"><ElapsedStatus label={`Loading ${result.name}`} category="policies" clockScope="policies" /></p>}
                      {result?.error && <ErrorDetails error={result.error} />}
                      {result?.html && <div className="max-h-[36rem] overflow-auto rounded-md border bg-background p-3" dangerouslySetInnerHTML={{__html:result.html}} />}
                      {!result && <p className="text-sm text-muted-foreground">Select an action to retrieve service data.</p>}
                    </section>;
                  }), recordServiceDom.host)}
                </>
              ) : (
              <section id="maestro-record-viewer" about={selectedUri && selectedRecordTermType === "uri" ? selectedUri : undefined} className="min-h-0 flex-1 overflow-auto p-4">
                {sessionIndex === 0 && recordSelectionCleared && !selectedUri && <p className="mb-3 text-xs text-muted-foreground">Virtual Record · properties and RDF values shared by every matching member of the active FCT result set.</p>}
                {selectedRecordTermType === "bnode" && blankNodeSnapshotReady && blankNodeRecords.length > 1 && (
                  <div className="mb-4" aria-label="Sibling blank-node records">
                    <Tabs value={String(activeBlankNodeTab)} onValueChange={(value) => {
                      const index = Number(value);
                      const node = blankNodeRecords[index];
                      if (!node || !chooseBlankNodeSibling(index)) return;
                      setActiveBlankNodeTab(index);
                      setDescribedRecord(node.rows);
                      setRecordDescriptionPage(0);
                      setRecordDescriptionSnapshot({ key: currentRecordDescriptionKey, uri: selectedUri, xml: materializeBlankNodeRecord(node, recordDescribeIncomplete), incomplete: recordDescribeIncomplete });
                      setRecordValidation(null);
                      setFormattedRecordHtml("");
                    }}>
                      <TabsList className="flex h-auto max-w-full flex-wrap justify-start gap-1">
                        {blankNodeRecords.map((node, index) => <TabsTrigger key={node.id} value={String(index)} className="cursor-pointer" title={node.id}>Node {index + 1}</TabsTrigger>)}
                      </TabsList>
                    </Tabs>
                  </div>
                )}
                {visibleProperties.length > 0 && <section>
                  <h3 className="mb-2 text-sm font-semibold">Properties</h3>
                  <table className={DEFAULT_RECORD_TABLE}>
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="w-[1%] whitespace-nowrap px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProperties.map((item) => (
                        <tr key={`${item.property}`} data-maestro-predicate={item.property} data-maestro-direction={item.direction} className={DEFAULT_RECORD_ROW}>
                          <td className={DEFAULT_RECORD_PROPERTY_CELL}>
                            <button type="button" className={DEFAULT_RECORD_PROPERTY_BUTTON}
                              about={item.property} data-maestro-predicate={item.property} data-maestro-direction={item.direction}
                              title={`Open ${item.property} as a URI query`}
                              onClick={() => { if (!fullscreenPane) openRecordPropertyUri(item.property); }}>{toLabel(item.property)}</button>
                          </td>
                          <td className={DEFAULT_RECORD_VALUE_CELL}>
                            <RecordValuePages pageSize={5} id={`${item.property}-values`}>
                              {item.values.map((value, index) => (
                                <div key={`${item.property}-${value.termType}-${value.value}-${index}`}
                                  data-maestro-property-value="true"
                                  data-maestro-predicate={item.property}
                                  data-maestro-direction={item.direction}
                                  {...(value.termType === "uri" ? {
                                    [item.direction === "property-of" ? "rev" : "rel"]: item.property,
                                    resource: value.value,
                                  } : value.termType === "bnode" ? {
                                    [item.direction === "property-of" ? "rev" : "rel"]: item.property,
                                    resource: value.value,
                                  } : value.termType === "literal" ? {
                                    property: item.property, content: value.value,
                                    ...(value.datatype ? { datatype: value.datatype } : {}),
                                    ...(value.lang ? { lang: value.lang } : {}),
                                  } : {})}
                                  className="min-w-0 break-all">
                            {value.termType === "bnode" ? (
                              selectedRecordTermType === "uri" ?
                                <button type="button" className="text-primary" data-maestro-shift-only="true" title="Shift-click to open the blank-node Record" onClick={(event) => {
                                  if (fullscreenPane || !event.shiftKey) return;
                                  setExplicitBlankNodeAnchor({ label: value.value, parent: selectedUri, predicate: item.property, direction: item.direction === "property-of" ? "reverse" : "forward", queryXml });
                                  setSelectedUri(value.value);
                                }}>{value.value}</button> : <span title={value.value}>{value.value}</span>
                            ) : (
                              <Tooltip><TooltipTrigger render={<button type="button"
                                data-maestro-shift-only={value.termType === "uri" ? undefined : "true"}
                                className={value.termType === "uri" ? DEFAULT_RECORD_VALUE_BUTTON : "break-all text-left font-inherit"}
                                onClick={(event) => { if (!fullscreenPane && event.shiftKey) navigateResultBadge(item.property, {
                                  value: value.value, type: value.termType,
                                  ...(value.datatype ? { datatype: value.datatype } : {}),
                                  ...(value.lang ? { lang: value.lang } : {}),
                                }, item.direction === "property-of" ? "reverse" : "forward"); }}
                              ><span className="break-all">{value.termType === "uri"
                                ? (recordUriLabelCacheRef.current.get(`${queryTree.attributes.addr ?? ""}\u0000${value.value}`) ?? value.value)
                                : value.value}</span></button>} /><TooltipContent>{`${toLabel(item.property)}${item.direction === "property-of" ? " of" : ""}: ${value.value}${value.lang ? ` @${value.lang}` : ""}${value.datatype ? `^^${value.datatype}` : ""}`}</TooltipContent></Tooltip>
                            )}
                                </div>
                              ))}
                            </RecordValuePages>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>}
                {visibleRoles.length > 0 && <section className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold">Roles</h3>
                  <table className={DEFAULT_RECORD_TABLE}>
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="w-[1%] whitespace-nowrap px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRoles.map((item) => (
                        <tr key={`${item.property}-of`} data-maestro-predicate={item.property} data-maestro-direction={item.direction} className={DEFAULT_RECORD_ROW}>
                          <td className={DEFAULT_RECORD_PROPERTY_CELL}>
                            <button type="button" className={DEFAULT_RECORD_PROPERTY_BUTTON}
                              about={item.property} data-maestro-predicate={item.property} data-maestro-direction={item.direction}
                              title={`Open ${item.property} as a URI query`}
                              onClick={() => { if (!fullscreenPane) openRecordPropertyUri(item.property); }}>{toLabel(item.property)} of</button>
                          </td>
                          <td className={DEFAULT_RECORD_VALUE_CELL}>
                            <RecordValuePages pageSize={5} id={`${item.property}-of-values`}>
                              {item.values.map((value, index) => (
                                <div key={`${item.property}-${value.termType}-${value.value}-${index}`}
                                  data-maestro-property-value="true"
                                  data-maestro-predicate={item.property}
                                  data-maestro-direction={item.direction}
                                  {...(value.termType === "uri" ? {
                                    [item.direction === "property-of" ? "rev" : "rel"]: item.property,
                                    resource: value.value,
                                  } : value.termType === "bnode" ? {
                                    [item.direction === "property-of" ? "rev" : "rel"]: item.property,
                                    resource: value.value,
                                  } : value.termType === "literal" ? {
                                    property: item.property, content: value.value,
                                    ...(value.datatype ? { datatype: value.datatype } : {}),
                                    ...(value.lang ? { lang: value.lang } : {}),
                                  } : {})}
                                  className="min-w-0 break-all">
                            {value.termType === "bnode" ? (
                              selectedRecordTermType === "uri" ?
                                <button type="button" className="text-primary" data-maestro-shift-only="true" title="Shift-click to open the blank-node Record" onClick={(event) => {
                                  if (fullscreenPane || !event.shiftKey) return;
                                  setExplicitBlankNodeAnchor({ label: value.value, parent: selectedUri, predicate: item.property, direction: item.direction === "property-of" ? "reverse" : "forward", queryXml });
                                  setSelectedUri(value.value);
                                }}>{value.value}</button> : <span title={value.value}>{value.value}</span>
                            ) : (
                              <Tooltip><TooltipTrigger render={<button type="button"
                                data-maestro-shift-only={value.termType === "uri" ? undefined : "true"}
                                className={value.termType === "uri" ? DEFAULT_RECORD_VALUE_BUTTON : "break-all text-left font-inherit"}
                                onClick={(event) => { if (!fullscreenPane && event.shiftKey) navigateResultBadge(item.property, {
                                  value: value.value, type: value.termType,
                                  ...(value.datatype ? { datatype: value.datatype } : {}),
                                  ...(value.lang ? { lang: value.lang } : {}),
                                }, item.direction === "property-of" ? "reverse" : "forward"); }}
                              ><span className="break-all">{value.termType === "uri"
                                ? (recordUriLabelCacheRef.current.get(`${queryTree.attributes.addr ?? ""}\u0000${value.value}`) ?? value.value)
                                : value.value}</span></button>} /><TooltipContent>{`${toLabel(item.property)}${item.direction === "property-of" ? " of" : ""}: ${value.value}${value.lang ? ` @${value.lang}` : ""}${value.datatype ? `^^${value.datatype}` : ""}`}</TooltipContent></Tooltip>
                            )}
                                </div>
                              ))}
                            </RecordValuePages>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>}
                {displayedRecord.length === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {describedRecord.length > 0
                      ? "No values match the preferred language in this Record view. Change Preferred language in the Sheet to see other language-tagged literals."
                      : recordDescriptionError || (isDescribing ? <ElapsedStatus label="Loading record" category="record" clockScope="record" /> : recordSelectionCleared ? "No common property/value pairs were found across the result set. Try narrowing the query by applying more filters." : selectedUri ? "No description data returned." : "Select a result to describe it.")}
                  </p>
                )}
              </section>
              )}
            </RightPaneBody>
            </RecordPaneShell>
            {!fullscreenPane && fullscreenRecord && selectedUri && <RecordExplorer workspace={workspace} presentation={recordExplorerPresentation} onClose={() => recordExplorerPresentation.shrink()} />}
            </>}
</>
  );
}
