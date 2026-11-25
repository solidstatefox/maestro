"use client";
import { facetButtonFactory, completeFacetButton } from "@/components/ui/facet-button-factory";
import { ErrorDetails } from "@/components/ui/error-details";
import { useEffect, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { LeftWidgetButtonTray, type LeftWidgetTrayAction } from "@/components/ui/left-widget-button-tray";
import type { DerivedRegexField } from "@/lib/fct-derived-facets";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useFctQuery, type FctQueryNode } from "@/lib/fct-query";
import { discoverApprovedRegexDerivations } from "@/lib/client-derived-facet-providers";
import { spawnRegexDerivedFacets } from "@/lib/fct-derived-facets";

/** Generic action: the approval-filtered SHACL provider defines which
 * predicates and capture fields apply, never a hard-coded email name in JSX. */
export function DerivedFacetButton({ source }: { source: FctQueryNode }) {
  const { tree, replaceTree } = useFctQuery();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const controller=useRef<AbortController|null>(null);
  const extract=async () => {
    if (busy) return;
    controller.current?.abort();
    const next=new AbortController(); controller.current=next;
    setBusy(true); setError("");
    try {
      // Revalidate approvals at click time so revocations never apply stale fields.
      const currentFields = await discoverApprovedRegexDerivations(source.attributes.iri || "", next.signal);
      if (next.signal.aborted) return;
      if (!currentFields.length) { setError("Derived facet provider approval changed; refresh this facet."); return; }
      replaceTree(spawnRegexDerivedFacets(tree,source.id,currentFields));
    } catch (error) {
      if (!next.signal.aborted) setError(error instanceof Error ? error.message : "Derived facet creation failed.");
    } finally {if (controller.current===next) {setBusy(false);controller.current=null;}}
  };
  return <div className="inline-flex items-center gap-1">
    <Tooltip><TooltipTrigger render={completeFacetButton(facetButtonFactory(<Braces className="size-4" />), {"type":"button", "disabled":(busy), "className":"inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", "onClick":(() => void extract()), "aria-label":"Extract approved derived facets"})} /><TooltipContent>Extract fields using an approved facet provider</TooltipContent></Tooltip>
    {error && <ErrorDetails prefix="Facet provider" error={error} />}
  </div>;
}

/** An approved provider is a condition for offering the action at all, and
 * unapproved actions must not occupy a direct or overflow slot. The lookup is
 * cancelled on facet changes/unmount; discovery failures stay distinguishable
 * from a confirmed empty provider set. */
export function PersonalFacetButtonTray({ source, actions, approvalRevision, sessionKey, sessionActive }: {
  source?: FctQueryNode; actions: LeftWidgetTrayAction[]; approvalRevision: number; sessionKey: string; sessionActive: boolean;
}) {
  const property = source?.attributes.iri ?? "";
  const [approval, setApproval] = useState<{
    property: string; revision: number; sessionKey: string; fields: DerivedRegexField[]; error: string;
  } | null>(null);
  useEffect(() => {
    // XState signedIn is authoritative. A stale facet can remain mounted for a
    // render after logout; it may not contact the personal provider store.
    if (!sessionActive || !sessionKey || !property || !source) { setApproval(null); return; }
    const controller = new AbortController();
    discoverApprovedRegexDerivations(property, controller.signal)
      .then(fields => { if (!controller.signal.aborted) setApproval({property,revision:approvalRevision,sessionKey,fields,error:""}); })
      .catch(error => { if (!controller.signal.aborted && sessionActive) setApproval({property,revision:approvalRevision,sessionKey,fields:[],
        error: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [property, source?.id, approvalRevision, sessionKey, sessionActive]);
  const approvedForScope = sessionActive && !!sessionKey && approval?.property === property &&
    approval.revision === approvalRevision && approval.sessionKey === sessionKey;
  const fields = approvedForScope ? approval.fields : [];
  const available = actions.map(action => action.id === "derived" ? {
    ...action, when: Boolean(source && fields.length),
    render: source && fields.length ? <DerivedFacetButton source={source} /> : undefined,
  } : action);
  return <>
    <LeftWidgetButtonTray actions={available} />
    {approvedForScope && approval.error && <ErrorDetails prefix="Derived facet provider discovery" error={approval.error} />}
  </>;
}
