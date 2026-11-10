"use client";

import { useEffect, useState } from "react";
import { ClockFading } from "lucide-react";
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
      <TooltipTrigger render={<span className="inline-flex shrink-0 items-center" role="img" aria-label="Incomplete Virtuoso results" tabIndex={0}>
        <ClockFading className="size-4" aria-hidden="true" />
      </span>} />
      <TooltipContent className="z-[100] max-w-xs break-words">
        <span className="font-medium">Incomplete Virtuoso Anytime results</span>
        <span className="mt-1 block">{status.message || "The graph server stopped the query before completion. Available rows are shown."}</span>
        {status.requestId && <span className="mt-1 block">Request: {status.requestId}</span>}
      </TooltipContent>
    </Tooltip>
  );
}


