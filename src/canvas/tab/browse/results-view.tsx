"use client";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { Fragment, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { CornerDownLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_RECORD_TABLE, DEFAULT_RECORD_PROPERTY_CELL, DEFAULT_RECORD_VALUE_CELL, DEFAULT_RECORD_PROPERTY_BUTTON, DEFAULT_RECORD_VALUE_BUTTON } from "@/canvas/right/default-record-row-style";
import { RDF_TYPE_URI } from "@/canvas/utils/query-controller";
import { toLabel } from "@/lib/uri-labels";
import type { FctResult, ScopeValue } from "@/canvas/utils/fct-response";
type Preview = { kind: "record" | "facet"; label: string; direction: "forward" | "reverse" } | null;
export interface BrowseResultsProps {
  results: FctResult[];
  selectedUri: string;
  expandedUris: Set<string>;
  setExpandedUris: Dispatch<SetStateAction<Set<string>>>;
  showResultBadges: boolean;
  isRootView: boolean;
  liveQueryHasText: boolean;
  search: string;
  searchError: string;
  isLoading: boolean;
  endpointReady: boolean;
  facetHoverPreview: Preview;
  tutorialMode: boolean;
  onSelectResult: (uri: string, shiftKey: boolean) => void;
  onNavigateClass: (uri: string) => void;
  onNavigateMatchProperty: (uri: string) => void;
  renderBadge: (scope: ScopeValue, value: ScopeValue["values"][number], index: number) => ReactNode;
}
/** Preserve FCT's trusted <b> match highlighting while treating every other
 * markup tag as text. The excerpt is a snippet, not an RDF term or HTML page. */
export function recordMatchBoldMarkup(excerpt: string): string {
  return excerpt.replace(/&lt;(\/?)b&gt;/gi, "<$1b>")
    .replace(/<[^>]*>/g, tag => /^<\/?b>$/i.test(tag) ? tag : tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}
export function BrowseResults({ results, selectedUri, expandedUris, setExpandedUris, showResultBadges, isRootView, liveQueryHasText, search, searchError, isLoading, endpointReady, facetHoverPreview, tutorialMode, onSelectResult, onNavigateClass, onNavigateMatchProperty, renderBadge }: BrowseResultsProps) {
  return               <div className="relative min-h-0 flex-1 overflow-y-auto p-2">
                {!facetHoverPreview && results.map((item, index) => {
                  const isExpanded = expandedUris.has(item.uri);
                  const recordClasses = Array.from(new Set(
                    (item.scopeValues ?? [])
                      .filter((scopeValue) => scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward")
                      .flatMap((scopeValue) => scopeValue.values)
                      .map((term) => term.value)
                      .filter((value) => Boolean(value) && value !== "-")
                  ));

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
                      {showResultBadges && item.termType === "uri" && recordClasses.length > 0 && (
                        <div
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-t-[5px] bg-sky-100 px-3 py-2 text-xs font-medium text-sky-950 dark:bg-sky-950/60 dark:text-sky-100"
                          aria-label="Record classes"
                        >
                          {recordClasses.map((classIri, classIndex) => (
                            <Fragment key={classIri}>
                              {classIndex > 0 && <span className="text-sky-600/70 dark:text-sky-300/70" aria-hidden="true">·</span>}
                              <button type="button" title={`Show all records of class ${classIri}`}
                                onClick={() => onNavigateClass(classIri)}
                                className="cursor-pointer break-words rounded px-1 hover:bg-sky-200 hover:text-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-sky-800 dark:hover:text-sky-100">{toLabel(classIri, "Class")}</button>
                            </Fragment>
                          ))}
                        </div>
                      )}
                      <div className="flex items-start gap-2 p-3">
                        <button
                          onClick={(event) => onSelectResult(item.uri,event.shiftKey)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium cursor-pointer">
                            <span>{item.title || (item.termType === "uri" ? toLabel(item.uri, "Class") : item.uri)}</span>
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
                        <div className="px-3 py-2" aria-label="Matching Record properties">
                          <table className={DEFAULT_RECORD_TABLE}>
                            <tbody>{item.matches.map((match, matchIndex) => (
                              <tr key={`${item.uri}-match-${matchIndex}`} className={matchIndex ? "border-t border-border" : ""}
                                data-maestro-predicate={match.predicate ?? ""} data-maestro-direction="property">
                                <td className={DEFAULT_RECORD_PROPERTY_CELL}>
                                  {match.predicate ? <button type="button" about={match.predicate}
                                    data-maestro-predicate={match.predicate} data-maestro-direction="property"
                                    className={DEFAULT_RECORD_PROPERTY_BUTTON}
                                    title={`Open ${match.predicate} as a URI query`}
                                    onClick={() => onNavigateMatchProperty(match.predicate!)}>
                                    {toLabel(match.predicate, "Property")}
                                  </button> : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className={DEFAULT_RECORD_VALUE_CELL}>
                                  <Tooltip><TooltipTrigger render={<button type="button"
                                    className={DEFAULT_RECORD_VALUE_BUTTON}
                                    onClick={() => onSelectResult(item.uri, false)}
                                    title="Open this matching resource in Record">
                                    {match.excerpt ? <span className="break-all" dangerouslySetInnerHTML={{
                                      __html: recordMatchBoldMarkup(match.excerpt),
                                    }}/> : "(No excerpt available)"}
                                  </button>} /><TooltipContent>Open this resource in the Record viewer. This match excerpt is not an RDF term.</TooltipContent></Tooltip>
                                </td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      )}

                      {(showResultBadges && (item.scopeValues?.some((scopeValue) => !(scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward") && scopeValue.values.some((term) => term.value && term.value !== "-")) ?? false)) && (
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2" aria-label="Selected property values">
                          {item.scopeValues!.filter((scopeValue) => !(scopeValue.property === RDF_TYPE_URI && scopeValue.direction === "forward")).map((scopeValue) => scopeValue.values.filter((term) => term.value && term.value !== "-").map((term, termIndex) => {
                                return renderBadge(scopeValue, term, termIndex);
                              }))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {results.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {searchError
                      ? "Search could not be completed."
                      : !endpointReady
                        ? "The selected graph server is not configured for this query. Review the graph-server selector."
                      : isLoading
                        ? <ElapsedStatus label="Locating" category="results" clockScope="results" />
                        : !search.trim()
                          ? "No resources returned for the initial empty-text query."
                          : "No matching results."}
                  </p>
                )}
                {/* Decorative missing-data placeholders share the REAL Results
                    pane with its established ElapsedStatus timer. They cannot
                    replace controls, swallow errors or launch requests. */}
                {!results.length && !searchError && endpointReady && isLoading && !facetHoverPreview && (
                  <div aria-hidden="true" className="space-y-2 px-3 pb-3">
                    {[0, 1, 2].map(index => <div key={index} className="space-y-2 rounded-md border p-3">
                      <Skeleton className="h-3 w-2/5" /><Skeleton className="h-2 w-3/5" />
                    </div>)}
                  </div>
                )}
                {facetHoverPreview && tutorialMode && (
                  <div className="absolute inset-0 z-20 flex flex-col gap-3 bg-background/95 p-6" aria-live="polite" aria-label={facetHoverPreview.kind === "record" ? `Preview record ${facetHoverPreview.label}` : `Preview ${facetHoverPreview.label} ${facetHoverPreview.direction === "reverse" ? "role" : "property"} list`}>
                    <p className="text-base">{facetHoverPreview.kind === "record" ? <>Only the <span className="font-semibold text-purple-700 dark:text-purple-300">{facetHoverPreview.label}</span> item will load here</> : <>The <span className="font-semibold text-purple-700 dark:text-purple-300">{facetHoverPreview.label}</span> list will load here</>}</p>
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><CornerDownLeft className="size-4 shrink-0" aria-hidden="true" />{facetHoverPreview.kind === "record" ? "The filters for this record will appear on the left" : "The filters for this list will appear on the left"}</p>
                  </div>
                )}
              </div>;
}

