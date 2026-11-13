"use client";
import { ErrorDetails } from "@/components/ui/error-details";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { formatPagePosition } from "@/canvas/utils/pagination";
import { RecordStatusButtons, RecordStarButton } from "@/canvas/right/record-status-buttons";

import { QueryInspectorButton } from "@/canvas/utils/query-inspector";

import { RecordValidationNotice, hasVisibleValidationWarning } from "@/canvas/right/validator";

import maestroLanguages from "@/data/maestro-languages.json";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { getMaestroComponentPortals } from "@/components/maestro-xslt-components";
import { toLabel } from "@/lib/uri-labels";

import { Separator } from "@/components/ui/separator";
import { RecordValuePages } from "@/components/ui/record-value-pages";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { Check, ChevronDown, ChevronRight, LoaderCircle, ClipboardCheck, ClockFading, Download, Eye } from "lucide-react";
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

/** UI owned by RightCanvasPanel. State and commands come from the shared workspace controller. */
export function RightCanvasPanel({ workspace }: { workspace: RecordPaneWorkspace }) {
  const [xsltPortals, setXsltPortals] = useState<ReturnType<typeof getMaestroComponentPortals>>([]);
  const {
    RECORD_DESCRIPTION_PAGE_SIZE,
    activeBlankNodeTab,
    applyRecordAsRootValue,
    authSession,
    beginRecordHoverPreview,
    blankNodeRecords,
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
    recordFormatEnabled,
    recordFormatError,
    recordStatus,
    recordFormatMenuOpen,
    recordFormatPreferenceKey,
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
    setActiveBlankNodeTab,
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
  // HTML is sanitized by the formatter before it enters this pane.
  // React portals mount only allowlisted shadcn components inside the HTML tree.
  useEffect(() => {
    const host = formattedRecordContainerRef.current;
    if (!host || !currentFormattedRecordHtml) { setXsltPortals([]); return; }
    setXsltPortals(getMaestroComponentPortals(host));
    return () => setXsltPortals([]);
  }, [currentFormattedRecordHtml, formattedRecordContainerRef]);

  return (
<>
{workspaceTab === "browse" && <>
            <RightPaneFrame>
            <RightPaneBody>
              <Collapsible open={recordControlsOpen} onOpenChange={setRecordControlsOpen} className="shrink-0 border-b">
                <div className="group/record-header flex items-center gap-2 px-4 py-3">
                  <CollapsibleTrigger aria-label={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} title={recordControlsOpen ? "Collapse Record controls" : "Expand Record controls"} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    {recordControlsOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                  </CollapsibleTrigger>
                  {recordStatus.enabled && selectedUri && selectedRecordTermType !== "bnode" && <RecordStarButton statuses={recordStatus} />}
                  <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
                  {recordFormatEnabled && Boolean(currentFormattedRecordHtml) && formattedRecordButtonsHtml.record_title_icon && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_title_icon }} />
                  )}
                  {recordDescribeIncomplete && <Tooltip><TooltipTrigger render={<span role="img" tabIndex={0} aria-label="Incomplete record description" className="inline-flex shrink-0"><ClockFading className="size-4" /></span>} /><TooltipContent>Virtuoso returned an incomplete DESCRIBE for this record.</TooltipContent></Tooltip>}
                  {selectedUri ? (
                    <Tooltip><TooltipTrigger render={<button
                      type="button"
                      className={`cursor-pointer text-left underline-offset-2 hover:underline ${facetHoverPreview?.kind === "record" && facetHoverPreview.uri === selectedUri ? "text-purple-700 dark:text-purple-300" : ""}`}
                      onClick={() => { if (selectedRecordTermType !== "bnode") { clearTutorialPreview(); applyRecordAsRootValue(selectedUri); } }}
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
                      query={selectedRecordTermType === "bnode" ? (recordDebug.xml || "A blank-node Record request has not executed yet.") : recordRootDebugQuery}
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
                        disabled={selectedRecordTermType === "bnode" || !recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || isDescribing}
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
                    {selectedRecordTermType === "bnode" && recordGraphs.length === 1 &&
                      queryTree.attributes.addr?.split("@", 1)[0] === recordGraphs[0] ? (
                      <span className="inline-flex min-w-0 max-w-64 items-center px-3 py-1.5 font-medium" title={recordGraphs[0]}>{toLabel(recordGraphs[0])}</span>
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
                  {recordStatus.enabled && selectedRecordTermType !== "bnode" && <RecordStatusButtons statuses={recordStatus} />}
                  {recordGraphError && endpointReadyForQuery && <ErrorDetails prefix="Graph discovery failed" error={recordGraphError} />}{loadingRecordAuthors && <span className="text-xs text-muted-foreground"><ElapsedStatus label="Loading authors" category="record" clockScope="recordAuthors" /></span>}{recordAuthorError && <ErrorDetails prefix="Author metadata" error={recordAuthorError} />}
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
                  {recordPolicyError && <ErrorDetails prefix="Record policy" error={recordPolicyError} />}
                  {formattedRecordButtonsHtml.record_button_bar && <div className="contents" dangerouslySetInnerHTML={{ __html: formattedRecordButtonsHtml.record_button_bar }} />}
                </div>}
                <RecordValidationNotice report={recordValidation} onDismiss={() => setRecordValidation(null)} />
                {recordDescriptionError && endpointReadyForQuery && <ErrorDetails prefix="Record SELECT" error={recordDescriptionError} className="mt-2" />}
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
                      selectedRecordTermType === "bnode" && blankNodeRecords.length > 0 ? `${shortenCount(blankNodeRecords.length)} sibling blank nodes` : null,
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
              {selectedRecordTermType !== "bnode" && recordFormatPreferenceLoaded && recordFormatEnabled && selectedUri && !recordDescriptionError && (isDescribing || isLoadingRecordPolicy || (Boolean(authSession) && recordPolicyCheckedUri !== selectedUri) || (Boolean(recordPolicy) && (!recordDescriptionSnapshot || recordDescriptionSnapshot.key !== currentRecordDescriptionKey || (!currentFormattedRecordHtml && !recordFormatError)))) ? (
                <div className="min-h-0 flex-1 overflow-auto p-4 text-sm text-muted-foreground" role="status"><ElapsedStatus label={recordPolicy && selectedRecordTemplateUri ? "Loading record (formatted)" : "Loading record"} category="record" clockScope={recordPolicy && selectedRecordTemplateUri ? "policies" : isDescribing ? "record" : "policies"} /></div>
              ) : selectedRecordTermType !== "bnode" && currentFormattedRecordHtml ? (
                <>
                  <div ref={formattedRecordContainerRef} className="min-h-0 flex-1 overflow-auto" dangerouslySetInnerHTML={{ __html: currentFormattedRecordHtml }} />
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
              <section id="maestro-record-viewer" className="min-h-0 flex-1 overflow-auto p-4">
                {selectedRecordTermType === "bnode" && blankNodeRecords.length > 0 && (
                  <div className="mb-4" aria-label="Sibling blank-node records">
                    <Tabs value={String(activeBlankNodeTab)} onValueChange={(value) => {
                      const index = Number(value);
                      const node = blankNodeRecords[index];
                      if (!node) return;
                      setActiveBlankNodeTab(index);
                      setDescribedRecord(node.rows);
                      setRecordDescriptionPage(0);
                      setRecordDescriptionSnapshot({ key: currentRecordDescriptionKey, uri: selectedUri, xml: node.xml, incomplete: recordDescribeIncomplete });
                      setRecordValidation(null);
                      setFormattedRecordHtml("");
                    }}>
                      <TabsList className="flex h-auto max-w-full flex-wrap justify-start gap-1">
                        {blankNodeRecords.map((node, index) => <TabsTrigger key={node.id} value={String(index)} className="cursor-pointer" title={node.id}>Node {index + 1}</TabsTrigger>)}
                      </TabsList>
                    </Tabs>
                  </div>
                )}
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
                      {describedPropertyRows.map((item) => (
                        <tr key={`${item.property}`} className="border-b">
                          <td className="w-[1%] whitespace-nowrap px-3 py-3 align-top font-medium">
                            <button type="button" className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                              title={`Open ${item.property} as a URI query`}
                              onClick={() => openRecordPropertyUri(item.property)}>{toLabel(item.property)}</button>
                          </td>
                          <td className="break-all px-3 py-3 align-top">
                            <RecordValuePages pageSize={5} id={`${item.property}-values`}>
                              {item.values.map((value, index) => (
                                <div key={`${item.property}-${value.termType}-${value.value}-${index}`} className="min-w-0 break-all">
                            {value.termType === "bnode" ? (
                              item.direction === "property" && selectedRecordTermType === "uri" ?
                                <button type="button" className="cursor-pointer text-primary hover:underline" title="Open blank-node Record and its sibling nodes" onClick={() => {
                                  setExplicitBlankNodeAnchor({ label: value.value, parent: selectedUri, predicate: item.property });
                                  setSelectedUri(value.value);
                                }}>{value.value}</button> : <span title={value.value}>{value.value}</span>
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
                                </div>
                              ))}
                            </RecordValuePages>
                          </td>
                        </tr>
                      ))}
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
                      {describedRoleRows.map((item) => (
                        <tr key={`${item.property}-of`} className="border-b">
                          <td className="w-[1%] whitespace-nowrap px-3 py-3 align-top font-medium">
                            <button type="button" className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                              title={`Open ${item.property} as a URI query`}
                              onClick={() => openRecordPropertyUri(item.property)}>{toLabel(item.property)} of</button>
                          </td>
                          <td className="break-all px-3 py-3 align-top">
                            <RecordValuePages pageSize={5} id={`${item.property}-of-values`}>
                              {item.values.map((value, index) => (
                                <div key={`${item.property}-${value.termType}-${value.value}-${index}`} className="min-w-0 break-all">
                            {value.termType === "bnode" ? (
                              item.direction === "property" && selectedRecordTermType === "uri" ?
                                <button type="button" className="cursor-pointer text-primary hover:underline" title="Open blank-node Record and its sibling nodes" onClick={() => {
                                  setExplicitBlankNodeAnchor({ label: value.value, parent: selectedUri, predicate: item.property });
                                  setSelectedUri(value.value);
                                }}>{value.value}</button> : <span title={value.value}>{value.value}</span>
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
                      : recordDescriptionError || (isDescribing ? <ElapsedStatus label="Loading record" category="record" clockScope="record" /> : selectedUri ? "No description data returned." : "Select a result to describe it.")}
                  </p>
                )}
              </section>
              )}
            </RightPaneBody>
            </RightPaneFrame></>}
</>
  );
}
