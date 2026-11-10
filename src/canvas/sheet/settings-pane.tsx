"use client";

import { RESULTS_BATCH_SIZE_OPTIONS, LEFT_WIDGET_LIMIT_KEYS, LEFT_WIDGET_LIMIT_OPTIONS, LEFT_WIDGET_LIMIT_LABELS, CENTER_PANEL_LIMIT_STORAGE_KEY, CENTER_GROUP_LIMIT_STORAGE_KEY, RIGHT_PANEL_DESCRIBE_LIMIT_STORAGE_KEY, RIGHT_PANEL_PAGE_LIMIT_STORAGE_KEY, RIGHT_PANEL_DESCRIBE_LIMIT_OPTIONS, RIGHT_PANEL_PAGE_LIMIT_OPTIONS } from "@/canvas/sheet/settings";

import { getLocalStorageUsageBytes, formatStorageBytes } from "@/canvas/sheet/settings";

import { FACET_ADD_COUNTS_STORAGE_KEY, FACET_AUTOFILL_STORAGE_KEY, AUTO_CONFIGURED_FACETS_STORAGE_KEY, FACET_EXCLUDE_STORAGE_KEY } from "@/canvas/left/configure";

import maestroLanguages from "@/data/maestro-languages.json";

import { ThemeToggle } from "@/components/theme-toggle";
import { type BrowserLogLevel } from "@/lib/maestro-client-logging";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { ChevronsDownUp, ChevronsUpDown, Settings, Download, Upload } from "lucide-react";

import { MAESTRO_TIMEOUT_CATEGORIES } from "@/lib/maestro-query-timeouts";

import { maestroStorageSet } from "@/lib/maestro-storage";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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

import type { SettingsPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";

/** Full Settings sheet, independent of the application header. */
export function SettingsPane({ workspace }: { workspace: SettingsPaneWorkspace }) {
  const {
    authSession,
    queryConcurrency,
    changeQueryConcurrency,
    bookmarkImportFileRef,
    browserLogLevel,
    browserLogging,
    changeWidgetTimeout,
    clearTutorialPreview,
    controlsSheetOpen,
    deleteBookmarks,
    deleteCurrentQueryHistory,
    exportBookmarks,
    groupBatchSize,
    historyBookmarkId,
    importBookmarks,
    isDeletingCurrentHistory,
    isDeletingHistory,
    isExportingBookmarks,
    isImportingBookmarks,
    isLoadingHistoryQuery,
    leftPanelLimit,
    leftWidgetLimits,
    setLeftWidgetLimit,
    loadHistoryQuery,
    localStorageUsageBytes,
    orderResults,
    panelLimitsOpen,
    pendingCenterBatchLimit,
    pendingGroupsBatchLimit,
    pendingLeftPanelLimit,
    pendingRecordDescriptionLimit,
    personalSparqlEndpoint,
    preferredAlphabetLanguage,
    prefixSource,
    prefixStatus,
    queryTree,
    queryTreeHeightDbRef,
    recordDescriptionPageSize,
    recordDescriptionQueryLimit,
    resultsBatchSize,
    setAutoConfiguredFacetKeys,
    setBrowserLogLevel,
    setBrowserLogging,
    setClearCacheDialogOpen,
    setControlsSheetOpen,
    setDeleteHistoryDialogOpen,
    setFacetAutofillCandidates,
    setFacetUsageRevision,
    setIsRdfLoaderOpen,
    setLocalStorageUsageBytes,
    setOrderResults,
    setPanelLimitsOpen,
    setPendingCenterBatchLimit,
    setPendingGroupsBatchLimit,
    setPendingLeftPanelLimit,
    setPendingRecordDescriptionLimit,
    setPreferredAlphabetLanguage,
    setPrefixSource,
    setQueryAttribute,
    setRecordDescriptionPage,
    setRecordDescriptionPageSize,
    setTimeoutEditorOpen,
    setTutorialMode,
    setWidgetTimeouts,
    timeoutEditorOpen,
    tutorialMode,
    widgetTimeouts,
  } = workspace;
  return (
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
                <Label htmlFor="maestro-alphabet-language">Preferred language</Label>
                <select id="maestro-alphabet-language" className="rounded-md border bg-background px-2 py-1.5 text-sm" value={preferredAlphabetLanguage}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!(next === "all" || MAESTRO_ALPHABET_LANGUAGES.some((option) => option.code === next))) return;
                    setPreferredAlphabetLanguage(next);
                    void maestroStorageSet("maestro-alphabet-preferred-language", next);
                  }}>
                  <option value="all">All languages</option>
                  {MAESTRO_ALPHABET_LANGUAGES.map(({ code, name }) => <option key={code} value={code}>{name} ({code})</option>)}
                </select>
                <p className="text-xs text-muted-foreground">The selected language (plus language-neutral literals) applies to Personal facet values, Results, and alphabet filtering. All languages removes the language restriction.</p>
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
              <div className="rounded-md border p-3 space-y-3">
                <Label>Query concurrency</Label>
                <p className="text-xs text-muted-foreground">Proxy connections limit the number of simultaneous browser requests, including requests waiting inside the proxy. Queries per graph server is a total ceiling, not a guaranteed dispatch count. Heavy queries (including COUNT, DISTINCT and GROUP BY) have their own smaller concurrent limit. The proxy reports actual Virtuoso dispatch times; changes take effect without reloading.</p>
                {([
                  ["proxyConnections", "Proxy connections", 1, 16],
                  ["lightPerServer", "Queries per graph server", 1, 16],
                  ["heavyPerServer", "Heavy queries per graph server", 1, 8],
                ] as const).map(([key, label, min, max]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`query-concurrency-${key}`} className="text-xs">{label}</Label>
                    <select id={`query-concurrency-${key}`} value={queryConcurrency[key]}
                      onChange={(event) => changeQueryConcurrency({ ...queryConcurrency, [key]: Number(event.currentTarget.value) })}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {Array.from({ length: max - min + 1 }, (_, i) => i + min)
                        .filter((n) => key !== "heavyPerServer" || n <= queryConcurrency.lightPerServer)
                        .map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
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
              <p className="text-xs text-muted-foreground">Maximum items requested from each widget's query. Display pagination remains ten items per page.</p>
              {LEFT_WIDGET_LIMIT_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <Label htmlFor={`left-limit-${key}`}>{LEFT_WIDGET_LIMIT_LABELS[key]}</Label>
                  <select id={`left-limit-${key}`} aria-label={`${LEFT_WIDGET_LIMIT_LABELS[key]} query LIMIT`}
                    value={leftWidgetLimits[key]}
                    onChange={(event) => setLeftWidgetLimit(key, Number(event.currentTarget.value))}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm">
                    {LEFT_WIDGET_LIMIT_OPTIONS.map((size) => <option key={size} value={size}>{size.toLocaleString()}</option>)}
                  </select>
                </div>
              ))}
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
  );
}
