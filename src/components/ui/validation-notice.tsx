"use client";

import { X } from "lucide-react";
import type { ShaclValidationReport } from "@/lib/shacl-validation-report";

/** A validation warning already explains the failure; avoid an additional red formatter error. */
export function hasVisibleValidationWarning(report: ShaclValidationReport | null): boolean {
  return report !== null && (!report.complete || !report.conforms);
}

export function ValidationNotice({ report, onDismiss }: { report: ShaclValidationReport | null; onDismiss: () => void }) {
  if (!report) return null;
  return <div className={`mt-3 rounded-md border p-3 text-sm ${report.conforms ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
    <button type="button" onClick={onDismiss} title="Dismiss validation report" aria-label="Dismiss validation report" className="float-right ml-2 inline-flex size-7 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"><X className="size-4" aria-hidden="true" /></button>
    <p className="font-semibold">{report.complete ? (report.conforms ? "SHACL validation passed" : "SHACL validation failed") : "Partial SHACL validation"}</p>
    <p className="mt-1">{report.message}</p>
    {report.violations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{report.violations.map((violation, index) => <li key={`${violation.path}-${index}`}>{violation.message}</li>)}</ul>}
    {(report.optionalMissing?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">Optional fields not present in the validated data: {Array.from(new Set(report.optionalMissing!.map((item) => item.name))).join(", ")}. These fields are not required by the selected SHACL shape.</p>}
    {report.unsupportedConstraints.length > 0 && <p className="mt-2 break-all text-xs">Unsupported constraints: {report.unsupportedConstraints.join(", ")}</p>}
    {report.reportNTriples && <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none">SHACL validation report (RDF)</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border p-2">{report.reportNTriples}</pre>
    </details>}
  </div>;
}
