"use client";
import { Fragment, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { CornerDownLeft } from "lucide-react";
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
  facetHoverPreview: Preview;
  tutorialMode: boolean;
  onSelectResult: (uri: string) => void;
  onNavigateClass: (uri: string) => void;
  renderBadge: (scope: ScopeValue, value: ScopeValue["values"][number], index: number) => ReactNode;
}
export function BrowseResults({ results, selectedUri, expandedUris, setExpandedUris, showResultBadges, isRootView, liveQueryHasText, search, searchError, isLoading, facetHoverPreview, tutorialMode, onSelectResult, onNavigateClass, renderBadge }: BrowseResultsProps) {
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
                          onClick={() => onSelectResult(item.uri)}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium cursor-pointer">
                            <span>{item.termType === "uri" ? toLabel(item.uri, "Class") : item.title || item.uri}</span>
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
                      : isLoading
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
              </div>;
}

