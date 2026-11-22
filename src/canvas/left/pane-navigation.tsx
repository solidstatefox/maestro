"use client";

import { ErrorDetails } from "@/components/ui/error-details";
import { retryMaestroComponent } from "@/lib/maestro-component-retry";
import { ElapsedStatus } from "@/components/ui/elapsed-status";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MousePointerClick, LoaderCircle } from "lucide-react";
import { ReturnToFiltersButton } from "@/canvas/left/return-to-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { shortenCount } from "@/lib/utils";
import type { LeftPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";
import type { LeftSkeletonPane } from "@/lib/app-lifecycle/skeleton-boundaries";

/** The single, real left-pane toolbar, reused during restoration. The skeleton
 * projects the saved pane, but never fabricates working Configure buttons or
 * dispatches a query before the authoritative FCT restore has completed. */
export function LeftPaneNavigation({ workspace, restoring = false, pane }: {
  workspace: LeftPaneWorkspace;
  restoring?: boolean;
  pane?: LeftSkeletonPane;
}) {
  const {
    defaultLeftTab, commitConfigureFacetChanges, personalWidgets,
    activeRoleFilters, classFacets, graphFacets, isLoadingClasses,
    isLoadingProperties, propertyFacets, isLoadingRoles, roleFacets,
    propertyFacetError, roleFacetError, showConfigureProperties,
    showConfigureRoles, showPropertiesSpinner, showRolesSpinner,
    setFocusListOrder, setResultsPage, resultsBatchSize, setDefaultLeftTab,
    autoConfigureFacetCount, runAutoConfigure,
  } = workspace;
  const activePane = pane ?? defaultLeftTab;
  return (
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">
                {activePane === "facets" ? (
                  <>
                    <ButtonGroup aria-label="Return to filters">
                      <ReturnToFiltersButton onClick={commitConfigureFacetChanges} disabled={restoring} />

                      <Tooltip><TooltipTrigger render={<Button
                        type="button"
                        onClick={commitConfigureFacetChanges}
                        disabled={restoring}
                        variant="outline" size="sm" className="cursor-pointer"
                        aria-label={restoring ? "Loading Filters count" : `Show Filters, ${personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)} facets`}
                      >
                        {restoring ? <Skeleton className="h-3 w-5" /> : personalWidgets.length + activeRoleFilters.length + (classFacets.length > 0 && !isLoadingClasses ? 1 : 0) + (graphFacets.length > 0 ? 1 : 0)}
                      </Button>} /><TooltipContent>{"Show Filters"}</TooltipContent></Tooltip>
                    </ButtonGroup>
                  </>
                ) : activePane === "personal" ? (
                  <>
                    {!restoring && ((isLoadingProperties && propertyFacets.length === 0) ||
                    (isLoadingRoles && roleFacets.length === 0)) ? (
                      <span role="status" aria-live="polite" className="px-2 text-xs text-muted-foreground">
                        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                          {isLoadingProperties && propertyFacets.length === 0 ? <ElapsedStatus label="Fetching properties" category="properties" clockScope="properties" /> : null}
                          {isLoadingRoles && roleFacets.length === 0 ? <ElapsedStatus label="Fetching roles" category="roles" clockScope="roles" /> : null}
                        </span>
                      </span>
                    ) : null}
                    {!restoring && ((!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError) || (!isLoadingRoles && roleFacets.length === 0 && roleFacetError)) ? (
                      <div role="alert" className="flex min-w-0 max-w-full flex-col gap-0.5 px-2 text-xs text-destructive">
                        {!isLoadingProperties && propertyFacets.length === 0 && propertyFacetError ? (
                          <ErrorDetails prefix="Properties" error={propertyFacetError} onRetry={() => retryMaestroComponent("properties")} />
                        ) : null}
                        {!isLoadingRoles && roleFacets.length === 0 && roleFacetError ? (
                          <ErrorDetails prefix="Roles" error={roleFacetError} onRetry={() => retryMaestroComponent("roles")} />
                        ) : null}
                      </div>
                    ) : null}
                    {!restoring && showConfigureProperties && (
                      <ButtonGroup aria-label="Configure properties">
                        <Button variant="outline" size="sm" type="button" onClick={() => { setFocusListOrder("Properties"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="cursor-pointer gap-1" title="Configure Properties" aria-label="Configure Properties"><MousePointerClick className="size-3.5" aria-hidden="true" /> Properties</Button>

                        <Tooltip><TooltipTrigger render={<Button variant="outline" size="sm"
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Properties");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="cursor-pointer gap-1"
                          aria-label={`Show Focus properties, ${propertyFacets.length} properties`}
                        >{showPropertiesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading properties" role="status" /> : shortenCount(propertyFacets.length)}</Button>} /><TooltipContent>{"Show Focus properties first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {!restoring && showConfigureRoles && (
                      <ButtonGroup aria-label="Configure roles">
                        <Button variant="outline" size="sm" type="button" onClick={() => { setFocusListOrder("Roles"); setResultsPage(resultsBatchSize, 0); setDefaultLeftTab("facets"); }} className="cursor-pointer gap-1" title="Configure Roles" aria-label="Configure Roles"><MousePointerClick className="size-3.5" aria-hidden="true" /> Roles</Button>

                        <Tooltip><TooltipTrigger render={<Button variant="outline" size="sm"
                          type="button"
                          onClick={() => {
                            setFocusListOrder("Roles");
                            setResultsPage(resultsBatchSize, 0);
                            setDefaultLeftTab("facets");
                          }}
                          className="cursor-pointer gap-1"
                          aria-label={`Show Focus roles, ${roleFacets.length} roles`}
                        >{showRolesSpinner ? <LoaderCircle className="size-4 animate-spin" aria-label="Loading roles" role="status" /> : shortenCount(roleFacets.length)}</Button>} /><TooltipContent>{"Show Focus roles first"}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                    {!restoring && autoConfigureFacetCount > 0 && (
                      <ButtonGroup aria-label="Auto-configure facets">
                        <Tooltip><TooltipTrigger render={<Button variant="outline" size="sm"
                          type="button"
                          onClick={runAutoConfigure}
                          className="cursor-pointer gap-1"
                        >Auto-configure</Button>} /><TooltipContent>{"Add high-frequency Properties and Roles that apply to the current query scope"}</TooltipContent></Tooltip>

                        <Tooltip><TooltipTrigger render={<Button variant="outline" size="sm"
                          type="button"
                          onClick={runAutoConfigure}
                          className="cursor-pointer gap-1"
                          aria-label={`Auto-configure ${autoConfigureFacetCount} facets`}
                        >{shortenCount(autoConfigureFacetCount)}</Button>} /><TooltipContent>{`${autoConfigureFacetCount} facets will be added`}</TooltipContent></Tooltip>
                      </ButtonGroup>
                    )}
                  </>
                ) : <span className="px-2 text-xs font-medium">Community</span>}
              </div>
  );
}
