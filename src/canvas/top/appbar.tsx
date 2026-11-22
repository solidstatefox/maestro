"use client";

import { BadgeQuestionMark, BadgeCheck, BadgeX, BadgeAlert } from "lucide-react";

export type EndpointStatus = {
  id: string;
  status: number | null;
  state: "ok" | "degraded" | "server-error" | "http-error" | "timeout" | "unreachable" | "probe-error";
  testedUrl?: string;
  diagnostic?: string;
  attempts?: Array<{ url: string; status: number | null; state: string; method?: string; query?: string;
    statusText?: string; contentType?: string; responseUrl?: string; location?: string;
    responseBody?: string; responseHeaders?: Record<string, string>; error?: string; errorName?: string; durationMs?: number }>;

};
/** Full diagnostic remains available to the browser rather than a generic state label. */
export function endpointHealthDetails(status?: EndpointStatus): string {
  if (!status) return "Not yet pinged";
  const header = status.status === null ? status.state : `HTTP ${status.status} (${status.state})`;
  return [header, status.testedUrl, status.diagnostic,
    ...(status.attempts ?? []).map(a => [a.method, a.query, a.status === null ? a.state : `HTTP ${a.status}`,
      a.statusText, a.errorName, a.error, a.contentType, a.location,
      a.responseHeaders ? JSON.stringify(a.responseHeaders) : "", a.responseBody,
      a.durationMs === undefined ? "" : `${a.durationMs} ms`].filter(Boolean).join(" · "))].filter(Boolean).join("\n");
}

export type EndpointOption = { id: string; label: string; url: string; group: string; schemeInferred?: boolean };

export function EndpointStatusIcon({ status }: { status?: EndpointStatus }) {
  // Distinguish "not yet polled" from a completed probe without an HTTP response.
  if (!status) return <BadgeQuestionMark aria-label="Not yet polled" className="size-4 shrink-0 text-muted-foreground" />;
  const httpStatus = status.status;
  if (httpStatus === 200 && status.state === "ok") return <BadgeCheck aria-label="HTTP 200 OK" className="size-4 shrink-0 text-green-600" />;
  if (status.state === "degraded") return <BadgeAlert aria-label="Graph server connection degraded" className="size-4 shrink-0 text-amber-500" />;
  if (status.state === "probe-error") return <BadgeAlert aria-label="SPARQL health probe inconclusive" className="size-4 shrink-0 text-amber-500" />;
  if (httpStatus !== null && httpStatus >= 500) return <BadgeX aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-red-600" />;
  if (httpStatus !== null && httpStatus >= 400) return <BadgeAlert aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-orange-500" />;
  // A failed probe with no HTTP response must not be mistaken for "never polled".
  if (httpStatus === null) return <BadgeAlert aria-label={`Graph server ${status.state}`} className="size-4 shrink-0 text-orange-500" />;
  return <BadgeQuestionMark aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-muted-foreground" />;
}

