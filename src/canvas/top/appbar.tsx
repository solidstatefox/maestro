"use client";

import { BadgeQuestionMark, BadgeCheck, BadgeX, BadgeAlert } from "lucide-react";

export type EndpointStatus = {
  id: string;
  status: number | null;
  state: "ok" | "server-error" | "http-error" | "timeout" | "unreachable";
  testedUrl?: string;
  attempts?: Array<{ url: string; status: number | null; state: string }>;
};
export type EndpointOption = { id: string; label: string; url: string; group: string; schemeInferred?: boolean };

export function EndpointStatusIcon({ status }: { status?: EndpointStatus }) {
  // Distinguish "not yet polled" from a completed probe without an HTTP response.
  if (!status) return <BadgeQuestionMark aria-label="Not yet polled" className="size-4 shrink-0 text-muted-foreground" />;
  const httpStatus = status.status;
  if (httpStatus === 200) return <BadgeCheck aria-label="HTTP 200 OK" className="size-4 shrink-0 text-green-600" />;
  if (httpStatus !== null && httpStatus >= 500) return <BadgeX aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-red-600" />;
  if (httpStatus !== null && httpStatus >= 400) return <BadgeAlert aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-orange-500" />;
  // A failed probe with no HTTP response must not be mistaken for "never polled".
  if (httpStatus === null) return <BadgeAlert aria-label={`Graph server ${status.state}`} className="size-4 shrink-0 text-orange-500" />;
  return <BadgeQuestionMark aria-label={`HTTP ${httpStatus}`} className="size-4 shrink-0 text-muted-foreground" />;
}

