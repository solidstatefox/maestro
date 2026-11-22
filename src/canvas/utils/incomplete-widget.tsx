"use client";

import { useEffect, useState } from "react";
import { ClockFading } from "lucide-react";
import { retryMaestroComponent } from "@/lib/maestro-component-retry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getMaestroIncompleteResults, subscribeMaestroIncompleteResults } from "@/lib/maestro-incomplete-results";

/** Display an Anytime result marker only for a widget whose most recent query was incomplete. */

export function IncompleteWidgetIndicator({ source }: { source: string }) {
  const [status, setStatus] = useState(() => getMaestroIncompleteResults(source));
  useEffect(() => {
    setStatus(getMaestroIncompleteResults(source));
    return subscribeMaestroIncompleteResults(() => setStatus(getMaestroIncompleteResults(source)));
  }, [source]);
  if (!status?.incomplete) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" className="inline-flex shrink-0 cursor-pointer items-center rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={(event) => { event.stopPropagation(); retryMaestroComponent(source); }} aria-label={`Retry only ${source} query`} title={`Retry only ${source} query`}>
        <ClockFading className="size-4" aria-hidden="true" />
      </button>} />
      <TooltipContent className="z-[100] max-w-xs break-words">
        <span className="font-medium">Incomplete Virtuoso Anytime results · Click to retry this component only</span>
        <span className="mt-1 block">{status.message || "The graph server stopped the query before completion. Available rows are shown."}</span>
        {status.requestId && <span className="mt-1 block">Request: {status.requestId}</span>}
      </TooltipContent>
    </Tooltip>
  );
}


