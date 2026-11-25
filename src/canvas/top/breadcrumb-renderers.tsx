"use client";

import { Signal } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { BreadcrumbNodeMinus } from "@/canvas/top/breadcrumb";

import { type ScopeValue } from "@/canvas/utils/fct-response";

import { findQueryNode, ellipsize } from "@/canvas/utils/query-controller";

import { renderValueOperator } from "@/canvas/top/breadcrumb";

import maestroLanguages from "@/data/maestro-languages.json";

import { toLabel } from "@/lib/uri-labels";

import { type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { OrUidIcon } from "@/components/ui/or-uid-label";

import { Badge } from "@/components/ui/badge";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Ban, CircleSlash, Slash, LoaderCircle } from "lucide-react";
import { shortenCount } from "@/lib/utils";
import { fctExamplePrefix } from "@/lib/fct-example-prefix";

import hljs from "highlight.js/lib/core";
import xmlLanguage from "highlight.js/lib/languages/xml";
import sqlLanguage from "highlight.js/lib/languages/sql";

hljs.registerLanguage("xml", xmlLanguage);
// SPARQL shares enough query syntax with SQL for useful keyword/string highlighting.
hljs.registerLanguage("sparql", sqlLanguage);

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
// Trial breadcrumb spacing: preserve the class/status superscript's top clearance.
// const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-1"; // previous value
const BREADCRUMB_NODE_BOTTOM_PADDING = "pb-0";

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

import type { WorkspaceController } from "@/canvas/utils/workspace-controller";

/** Breadcrumb/analysis rendering in the presentation layer, not the workspace lifecycle. */
export function createBreadcrumbRenderers(workspace: WorkspaceController) {
  const { rootBreadcrumb, ActiveSignalIcon, activeBreadcrumbButtonRef, activeBreadcrumbIndex, activeLeafId, boundValueLabel, boundValueNodes, breadcrumbBadgeMode, breadcrumbPreviewPendingIds, breadcrumbPreviewSummaries, classBreadcrumbLabels, clearTutorialPreview, compactIri, deleteNode, facetHoverPreview, getBreadcrumbSiblings, getPropertyPath, handleBreadcrumbClick, handleRootBreadcrumbClick, pasteRecentRootClipboard, hoveredBreadcrumbBadgeId, namePropertyMenuOpen, navigateResultBadge, navigateToPropertyPath, openBreadcrumbDropdownId, popBreadcrumbOrBinding, queryTree, renderBreadcrumbMenuHeader, renderBreadcrumbNodeMenuItem, rootBadgePossessive, rootLabelPossessive, rootSearchExpanded, rootSearchText, rootUriLabel, rootUriValues, search, searchInputGroup, setHoveredBreadcrumbBadgeId, setOpenBreadcrumbDropdownId, setRootSearchExpanded, setTextSearchMode, signalPickerExpanded, setSignalPickerExpanded, signalOptions, textSearchMode, toggleBreadcrumbBadgeMode, tutorialBreadcrumbPath, tutorialBreadcrumbTargetId, transportedPreviewIds, transportedFocusAtRoot, hoveredTransportedAnchor, setHoveredTransportedTargetId, toggleTransportedAnchorAt } = workspace;
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

function renderRootBreadcrumb(tableHeader = false, presentationStyle?: CSSProperties, showMetadata = true) {
    const rootLabel = facetHoverPreview?.kind === "record" ? facetHoverPreview.label
      : !search.trim() ? "Everything" : textSearchMode === "uri"
        ? `${rootUriLabel}${rootLabelPossessive}` : `"${search}"${rootLabelPossessive}`;
    const rootClassLabels = classBreadcrumbLabels(null);
    const rootConstraints = queryTree.children.filter((node) => node.name === "class" || node.name === "status");
    // The root is a specialized breadcrumb node, not a separate toolbar:
    // it keeps the existing navigation, metadata, and minus/stack-pop action.
    return <span data-maestro-root-editor="true"
      className="relative flex min-w-0 max-w-full shrink-0 items-center"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing && rootSearchExpanded) {
          rootBreadcrumb.send({ type: "SET_EDITOR", open: false });
        } else if (rootSearchExpanded && event.target instanceof HTMLElement &&
          event.target.matches('input, textarea, [contenteditable="true"]') &&
          (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) {
          rootBreadcrumb.send({ type: "EDIT_ACTIVITY" });
        }
      }}
      onMouseLeave={(event) => {
        // The signal region is a sibling of the label region. Leaving the
        // complete breadcrumb (not moving between its controls) ends the edit.
        if (event.relatedTarget instanceof Element &&
          event.relatedTarget.closest('[data-slot="combobox-content"], [data-slot="dropdown-menu-content"]')) return;
        if (!namePropertyMenuOpen) rootBreadcrumb.send({ type: "LABEL_LEAVE" });
      }}
      style={{ zIndex: hoveredBreadcrumbBadgeId === "query-root" ? tutorialBreadcrumbPath.length + 100 : 1 }}>
      <InputGroup aria-label="Root breadcrumb" data-maestro-breadcrumb-node="root"
        className={`relative isolate h-10 min-w-0 box-border flex-nowrap overflow-hidden rounded-md ${rootSearchExpanded ? "w-[min(34rem,calc(100vw-10rem))]" : "w-max max-w-[min(34rem,calc(100vw-10rem))]"} ${facetHoverPreview?.kind === "record" ? "text-purple-800 dark:text-purple-200" : ""} ${activeBreadcrumbIndex < 0 ? "border-ring bg-accent" : ""}`}>
        <span data-maestro-root-label-region="true" className="relative flex h-full min-w-0 flex-1 items-stretch"
          onMouseEnter={() => {
            rootBreadcrumb.send({ type: "LABEL_ENTER" });
            setHoveredBreadcrumbBadgeId("query-root");
            hoveredTransportedAnchor(queryTree.attributes.id ?? "");
            void pasteRecentRootClipboard();
          }}
          onMouseLeave={(event) => {
            // Portaled combobox or name-property menu is part of the editor.
            if (event.relatedTarget instanceof Element &&
              event.relatedTarget.closest('[data-slot="combobox-content"], [data-slot="dropdown-menu-content"]')) return;
            if (!namePropertyMenuOpen && !(event.relatedTarget instanceof Element &&
                event.relatedTarget.closest('[data-maestro-signal-region="true"]')))
              rootBreadcrumb.send({ type: "LABEL_LEAVE" });
            setHoveredBreadcrumbBadgeId((current) => current === "query-root" ? null : current);
            setHoveredTransportedTargetId(current => current === queryTree.attributes.id ? null : current);
          }}
          onFocusCapture={(event) => {
            // Focus on the ordinary breadcrumb's navigation button must not
            // unmount that button before its click is delivered.
            if ((event.target as HTMLElement).matches('input, textarea, [contenteditable="true"]'))
              rootBreadcrumb.send({ type: "INPUT_FOCUS" });
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !namePropertyMenuOpen &&
              !(event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-maestro-signal-region="true"]')))
              rootBreadcrumb.send({ type: "INPUT_BLUR" });
          }}>
          {rootClassLabels.length > 0 && <span
            className="pointer-events-none absolute left-2 top-0 z-10 max-w-[calc(100%-12px)] truncate text-[9px] leading-3 text-muted-foreground"
            aria-label={`Classes and Status: ${rootClassLabels.join(", ")}`}>
            {rootClassLabels.join(", ")}
          </span>}
          {rootSearchExpanded ? searchInputGroup : (
            <Tooltip><TooltipTrigger render={<button type="button"
              data-maestro-root-label="true" ref={getPropertyPath().length === 0 ? activeBreadcrumbButtonRef : undefined}
              onClick={(event) => { if (!toggleTransportedAnchorAt(queryTree.attributes.id ?? "",event.shiftKey)) handleRootBreadcrumbClick(); }} style={presentationStyle}
              className={`relative flex h-full min-w-0 flex-1 cursor-pointer items-center truncate px-2.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${transportedFocusAtRoot ? "!bg-emerald-100/80 !text-emerald-900 dark:!bg-emerald-950/50 dark:!text-emerald-100" : ""} ${activeBreadcrumbIndex < 0 ? "bg-accent font-medium text-foreground" : "bg-background text-foreground"}`}
              aria-label={`Return to the top-level query view: ${rootLabel}`}
              aria-current={activeBreadcrumbIndex < 0 ? "location" : undefined}>
              <span className={`truncate ${rootClassLabels.length ? "pt-2" : ""}`}>{rootLabel}</span>
            </button>} /><TooltipContent positionerClassName="z-[150]">{`Return to the top-level query view${textSearchMode === "uri" && rootSearchText ? ` · ${rootSearchText}` : ""}${rootClassLabels.length ? ` · Classes: ${rootClassLabels.join(", ")}` : ""}`}</TooltipContent></Tooltip>
          )}
        </span>
        {/* Inherited breadcrumb stack-pop action: position and semantics are fixed.
            It is rendered in BOTH the resting and editable root presentations. */}
        {rootConstraints.length > 0 && <BreadcrumbNodeMinus
          variant="input"
          ariaLabel="Remove the last root class or state constraint"
          tooltip="Remove the last root class or state constraint"
          onPop={() => deleteNode(rootConstraints[rootConstraints.length - 1].id)} />}
        <InputGroupAddon align="inline-end" data-maestro-signal-region="true"
          className="h-full gap-0 bg-background px-0"
          aria-label="Root search signals"
          onMouseEnter={() => rootBreadcrumb.send({ type: "SIGNAL_ENTER" })}
          onMouseLeave={() => rootBreadcrumb.send({ type: "SIGNAL_LEAVE" })}
          onFocusCapture={() => rootBreadcrumb.send({ type: "SIGNAL_ENTER" })}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              rootBreadcrumb.send({ type: "SIGNAL_LEAVE" });
          }}>
          {(signalPickerExpanded ? signalOptions : signalOptions.filter(option => option.mode === textSearchMode))
            .map(({ mode, Icon, label }) => (
              <Tooltip key={mode}><TooltipTrigger render={<InputGroupButton
                type="button" variant="ghost" size="icon-sm" aria-label={label}
                aria-pressed={textSearchMode === mode}
                className="h-9 w-8 rounded-none bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 aria-pressed:text-foreground"
                onClick={() => {
                  // Keep the expanded text editor mounted while committing the
                  // selected signal. Otherwise blur/leave can restore a stale
                  // mode before the FCT query transaction finishes.
                  if (rootSearchExpanded) rootBreadcrumb.send({ type: "SET_EDITOR", open: true });
                  setTextSearchMode(mode);
                  rootBreadcrumb.send({ type: "SIGNAL_SELECTED" });
                }}>
                <span className="relative flex size-4 items-center justify-center">
                  <Signal strokeWidth={2.5} className="absolute inset-0 size-4 opacity-30" aria-hidden="true" />
                  <Icon strokeWidth={2.5} className="absolute inset-0 size-4" aria-hidden="true" />
                </span>
              </InputGroupButton>} /><TooltipContent>{label}</TooltipContent></Tooltip>
            ))}
        </InputGroupAddon>
      </InputGroup>
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
  {fctExamplePrefix(rootUriValues)} 
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
    </span>;
  }

function renderPathBreadcrumb(crumb: WorkspaceController["tutorialBreadcrumbPath"][number], index: number, tableHeader = false, presentationStyle?: CSSProperties, showMetadata = true) {

  const isInactiveSuffix = index > activeBreadcrumbIndex;
          const breadcrumbClasses = classBreadcrumbLabels(crumb.id);
          const breadcrumbNode = findQueryNode(queryTree.children, crumb.id);
          const breadcrumbIsRole = crumb.name === "property-of";
          const breadcrumbBaseLabel = (breadcrumbNode?.attributes.label || toLabel(crumb.uri, breadcrumbIsRole ? "Role" : "Property")) + (breadcrumbIsRole ? " of" : "");
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
              onMouseEnter={() => {
                setHoveredBreadcrumbBadgeId(crumb.id);
              }}
              onMouseLeave={() => {
                setHoveredBreadcrumbBadgeId((current) => current === crumb.id ? null : current);
              }}>
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
  {fctExamplePrefix(breadcrumbBoundValues)} {ellipsize(summary.label || "—", 28)}{breadcrumbBadgeMode !== "classes" && breadcrumbHasSuccessor && !summary.zeroClasses && summary.label && summary.label !== "—" ? "’s" : ""}
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
              <InputGroup aria-label={`Controls for ${breadcrumbLabel}`} data-maestro-breadcrumb-node={crumb.id} className={`h-10 w-max max-w-full flex-nowrap overflow-hidden ${breadcrumbNode?.attributes.group === "true" ? "border-sky-300 bg-sky-100/80 dark:border-sky-800 dark:bg-sky-950/50" : ""} ${tableHeader ? "border-0 shadow-none" : ""} ${tutorialBreadcrumbTargetId === crumb.id ? "text-purple-700 dark:text-purple-300" : ""}`}>
                {breadcrumbNode?.attributes.uid && <InputGroupAddon align="inline-start" className={`h-full min-h-0 w-7 justify-center border-r border-border bg-muted/30 px-0 ${transportedPreviewIds.has(crumb.id) ? "!bg-emerald-100/80 dark:!bg-emerald-950/55" : ""}`}><OrUidIcon uid={breadcrumbNode.attributes.uid} bare /></InputGroupAddon>}
                <Tooltip><TooltipTrigger render={<InputGroupButton
                  type="button" variant="ghost"
                  ref={crumb.id === activeLeafId && index === activeBreadcrumbIndex ? activeBreadcrumbButtonRef : undefined}
                  onMouseEnter={() => hoveredTransportedAnchor(crumb.id)}
                  onMouseLeave={() => setHoveredTransportedTargetId(current => current === crumb.id ? null : current)}
                  data-maestro-anchor-preview={transportedPreviewIds.has(crumb.id) ? "true" : undefined}
                  onClick={(event) => {
                    if (!toggleTransportedAnchorAt(crumb.id, event.shiftKey)) handleBreadcrumbClick(crumb.id);
                  }}
                  style={presentationStyle}
                  className={`relative h-full min-h-0 min-w-0 cursor-pointer break-words rounded-none px-2.5 text-left text-sm hover:bg-accent ${transportedPreviewIds.has(crumb.id) ? "!bg-emerald-100/80 !text-emerald-900 dark:!bg-emerald-950/50 dark:!text-emerald-100" : ""} ${breadcrumbClasses.length ? `${BREADCRUMB_NODE_BOTTOM_PADDING} pt-3` : "py-0"} ${
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
<span className="inline-flex min-w-0 max-w-full items-center whitespace-nowrap"><span className="min-w-0 truncate">{breadcrumbBaseLabel}</span></span>
                  {breadcrumbBoundValues.map((value, index) => (
                    <span key={value.id} className="ml-1 inline-flex items-baseline gap-1">
                      {index > 0 && <span>,</span>}
                      {index === 0 || value.attributes.op !== breadcrumbBoundValues[0]?.attributes.op ? renderValueOperator(value) : null}
                      <span>{boundValueLabel(value)}</span>
                    </span>
                  ))}
                  {breadcrumbHasSuccessor && !breadcrumbIsRole ? "’s" : ""}
                </InputGroupButton>} /><TooltipContent positionerClassName="z-[150]">{`Navigate to ${crumb.uri}${breadcrumbClasses.length ? ` · Classes: ${breadcrumbClasses.join(", ")}` : ""} · Shift+click to toggle transported facet when this node precedes the focus`}</TooltipContent></Tooltip>
                <BreadcrumbNodeMinus variant="input"
                  ariaLabel={topBoundValue
                    ? `Remove value ${boundValueLabel(topBoundValue)} bound to ${breadcrumbLabel}`
                    : `Pop ${breadcrumbLabel} from the breadcrumb stack`}
                  tooltip={topBoundValue
                    ? "Remove the bound value; click again to pop this relationship"
                    : "Pop this relationship and its descendants; preserve a sibling when available"}
                  onPop={() => { clearTutorialPreview(); popBreadcrumbOrBinding(crumb); }} />
                {(() => {
					 const summary = breadcrumbPreviewSummaries[crumb.id] ?? breadcrumbNode?.uiResultSummary;
                  const hasMenu = breadcrumbSiblings.length > 0;
                  if (!hasMenu || tableHeader) return null;
                  return (
                    <DropdownMenu open={openBreadcrumbDropdownId === crumb.id} onOpenChange={(open) => setOpenBreadcrumbDropdownId(open ? crumb.id : null)}>
                      <DropdownMenuTrigger asChild><InputGroupButton
                          type="button" variant="ghost" size="icon-sm"
                          aria-label={`Choose a relationship for ${compactIri(crumb.uri)}`}
                          title="Choose a relationship"
                          className={`flex h-full min-h-0 w-8 shrink-0 self-stretch items-center justify-center rounded-none p-0 ${tutorialBreadcrumbTargetId === crumb.id ? "bg-transparent text-purple-800 dark:text-purple-200" : `bg-background ${isInactiveSuffix ? "text-muted-foreground" : "text-foreground"}`} outline-none hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=open]:bg-accent`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 6 4 4 4-4" /></svg>
                        </InputGroupButton></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-50 w-max min-w-44 max-w-[calc(100vw-2rem)]">
                        {renderBreadcrumbMenuHeader(summary, `Move view to ${breadcrumbBaseLabel}`, () => { clearTutorialPreview(); navigateToPropertyPath(crumb.id); }, breadcrumbBoundValues)}
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
              </InputGroup>

            </span>
          );
  }
  return { renderScopeValueBadge, renderRootBreadcrumb, renderPathBreadcrumb };
}
