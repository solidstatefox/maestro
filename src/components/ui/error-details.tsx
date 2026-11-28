"use client";

import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertTriangle, Check, Copy, RotateCw } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** Summarize a remote error without losing the original diagnostics. Never display
 * an echoed SPARQL query, stack trace, or HTML response inline in a small widget. */
export function shortErrorName(details: string): string {
  const value = details.trim();
  if (!value) return "Unknown error";
  const sqlCode = value.match(/\b(?:SR|SQ)\d{3}\b/i)?.[0];
  const procedure = value.match(/(?:undefined|unknown) procedure\s+([\w.]+)/i)?.[1];
  if (procedure) return `${sqlCode ? `${sqlCode}: ` : ""}Undefined ${procedure.split(".").at(-1)}`;
  const http = value.match(/\b(?:HTTP\s*|status\s*)([45]\d\d)\b/i)?.[1];
  if (http) return `HTTP ${http}${sqlCode ? ` · ${sqlCode}` : ""}`;
  if (sqlCode) return `Virtuoso ${sqlCode}`;
  const head = value.split(/\r?\n|(?:SPARQL|SQL) query\s*:/i)[0]
    .replace(/\s+/g, " ").replace(/\s*:\s*$/, "").trim();
  return head.length > 66 ? `${head.slice(0, 63).trimEnd()}…` : head;
}

/** Gateway failures are typically transient; other errors remain diagnostic-only.
 * The retry callback is supplied by the request owner, never by this generic UI. */
export function isRetryableGatewayError(error: string): boolean {
  return /\b(?:HTTP\s*|status\s*)(?:502|503|504)\b/i.test(error) ||
    /\b(?:502|503|504)\s+(?:bad gateway|service unavailable|gateway time-?out)\b/i.test(error);
}

/** Shared error affordance: compact label, full diagnostic popover, and copy/check feedback.
 * Render in the same place as an existing inline error; errors remain selectable and accessible.
 */
export function ErrorDetails({ error, prefix, className, onRetry, verbatim = false, iconOnly = false }: { error: string; prefix?: string; className?: string; onRetry?: () => void; verbatim?: boolean; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [error]);
  if (!error) return null;
  const summary = shortErrorName(error);
  // The prefix is part of the diagnostic context; do not discard it in the
  // details pane or clipboard (previously "Graph server" was lost on Copy).
  const fullDiagnostic = !verbatim && prefix && !error.trimStart().startsWith(`${prefix}:`)
    ? `${prefix}: ${error}` : error;
  const copy = async () => {
    try { await navigator.clipboard.writeText(fullDiagnostic); setCopied(true); }
    catch { setCopied(false); }
  };
  return <Popover.Root>
    <Popover.Trigger aria-label={`Error details: ${prefix ? `${prefix}: ` : ""}${summary}`}
      className={cn("inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      {!iconOnly && <span className="truncate">{prefix ? `${prefix}: ` : ""}{summary}</span>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" align="start" sideOffset={6} className="z-[220]">
        <Popover.Popup className="w-[min(36rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl outline-none">
          <div className="mb-2 flex items-start justify-between gap-2">
            <strong className="min-w-0 text-sm">{prefix ? `${prefix}: ${summary}` : summary}</strong>
            <ButtonGroup aria-label="Error actions" className="shrink-0">
              <Button type="button" variant="outline" size="xs" onClick={() => void copy()} title={copied ? "Copied" : "Copy full error"}
                aria-label={copied ? "Error copied" : "Copy full error"}>
                {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {onRetry && (iconOnly || isRetryableGatewayError(error)) && <Button type="button" variant="outline" size="xs"
                onClick={onRetry} title="Retry this component only" aria-label="Retry this component only">
                <RotateCw className="size-3.5" aria-hidden="true" />Retry
              </Button>}
            </ButtonGroup>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-xs select-text">{fullDiagnostic}</pre>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
