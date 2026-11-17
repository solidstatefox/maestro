"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { readClientProviderDiagnostics, type ProviderDiagnostic } from "@/lib/client-provider-diagnostics";

/** Hover-only, read-only provider diagnostic; never changes the selected tab.
 * Red/green are reserved for a *real* SHACL ValidationReport. */
export function ViewDiagnosticsHover({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [entries, setEntries] = useState<ProviderDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!hovered || !enabled) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void readClientProviderDiagnostics(controller.signal)
      .then(result => { if (!controller.signal.aborted) setEntries(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hovered, enabled]);
  return <span className="relative inline-flex shrink-0 items-stretch"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    {children}
    {enabled && hovered && <span role="status" aria-label="View provider diagnostics"
      className="absolute left-0 top-full z-[500] block max-h-[min(70vh,32rem)] w-[min(36rem,90vw)] overflow-auto rounded-md border border-border bg-popover p-3 text-left text-popover-foreground shadow-xl">
      <span className="block pb-2 text-xs font-semibold">Loaded policies and provider definitions</span>
      {loading && <span className="block text-xs text-muted-foreground">Reading personal graph…</span>}
      {error && <span className="block text-xs text-destructive">{error}</span>}
      {(["Policies", "mui:Providers"] as const).map(category => <span key={category} className="block pb-2">
        <span className="block border-b py-1 text-xs font-semibold">{category}</span>
        {!loading && !entries.some(entry => entry.category === category) && <span className="block py-1 text-xs text-muted-foreground">No definitions found</span>}
        {entries.filter(entry => entry.category === category).map(entry => {
          const Indicator = entry.validation === "pass" ? CircleCheck : entry.validation === "fail" ? CircleX : CircleAlert;
          const color = entry.validation === "pass" ? "text-green-600 dark:text-green-400" : entry.validation === "fail" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
          return <span key={`${category}:${entry.uri}`} className="flex items-start gap-2 border-b border-border/40 px-1 py-1.5 text-xs">
            <span title={entry.validation === "unknown" ? "No conclusive SHACL ValidationReport" : `SHACL ${entry.validation}`} className="mt-0.5 inline-flex size-3.5 shrink-0">
              <Indicator className={`size-3.5 ${color}`} aria-label={`SHACL: ${entry.validation}`} />
            </span>
            <span className="block min-w-0 flex-1">
              <span className="block truncate font-medium" title={entry.uri}>{entry.name}</span>
              <span className="block truncate text-muted-foreground" title={entry.component}>Caller: {entry.component}</span>
            </span>
          </span>;
        })}
      </span>)}
      <span className="block text-[11px] text-muted-foreground">Green: conforms · Red: fails · Amber: report unavailable or inconclusive. Read-only; no navigation.</span>
    </span>}
  </span>;
}
