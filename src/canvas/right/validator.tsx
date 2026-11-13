"use client";
import { type RecordPolicyOption } from "@/canvas/right/format";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

import { X } from "lucide-react";

export type RecordValidationReport = {
  complete: boolean;
  conforms: boolean;
  message: string;
  violations: Array<{ path: string; message: string; value?: string }>;
  optionalMissing?: Array<{ path: string; name: string }>;
  unsupportedConstraints: string[];
  /** Standards-compliant RDF validation graph (N-Triples). */
  reportNTriples?: string;
  /** XSLT-friendly projection of the validation report. */
  reportXml?: string;
  standard?: "SHACL Core";
};

/** A validation warning already explains the failure; avoid an additional red formatter error. */
export function hasVisibleValidationWarning(report: RecordValidationReport | null): boolean {
  return report !== null && (!report.complete || !report.conforms);
}

export function RecordValidationNotice({ report, onDismiss }: { report: RecordValidationReport | null; onDismiss: () => void }) {
  if (!report) return null;
  return <div className={`mt-3 rounded-md border p-3 text-sm ${report.conforms ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
    <button type="button" onClick={onDismiss} title="Dismiss validation report" aria-label="Dismiss validation report" className="float-right ml-2 inline-flex size-7 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"><X className="size-4" aria-hidden="true" /></button>
    <p className="font-semibold">{report.complete ? (report.conforms ? "SHACL validation passed" : "SHACL validation failed") : "Partial SHACL validation"}</p>
    <p className="mt-1">{report.message}</p>
    {report.violations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{report.violations.map((violation, index) => <li key={`${violation.path}-${index}`}>{violation.message}</li>)}</ul>}
    {(report.optionalMissing?.length ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">Optional fields not present in this Record snapshot: {Array.from(new Set(report.optionalMissing!.map((item) => item.name))).join(", ")}. These fields are not required by the selected SHACL shape.</p>}
    {report.unsupportedConstraints.length > 0 && <p className="mt-2 break-all text-xs">Unsupported constraints: {report.unsupportedConstraints.join(", ")}</p>}
    {report.reportNTriples && <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none">SHACL validation report (RDF)</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border p-2">{report.reportNTriples}</pre>
    </details>}
  </div>;
}

import { useState } from "react";
/** Isolated SHACL validation response state. */
export function useRecordValidationState() {
  const [recordValidation, setRecordValidation] = useState<RecordValidationReport | null>(null);
  const [isValidatingRecord, setIsValidatingRecord] = useState(false);
  return { recordValidation, setRecordValidation, isValidatingRecord, setIsValidatingRecord };
}

  /** The validator and XSLT consume the same record/graph/author snapshot. */
export async function validateRecordSnapshot(
    policy: RecordPolicyOption,
    snapshot: { key: string; uri: string; xml: string; incomplete: boolean },
  ): Promise<RecordValidationReport> {
    const xml = new DOMParser().parseFromString(snapshot.xml, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("Cannot validate malformed Record DESCRIBE XML.");
    const ns = "http://openlinksw.com/services/facets/1.0/";
    const triples = Array.from(xml.getElementsByTagNameNS(ns, "row")).flatMap((row) => {
      const cells = Array.from(row.getElementsByTagNameNS(ns, "column"));
      if (cells.length < 3) return [];
      const [subject, predicate, object] = cells.slice(0, 3).map((cell) => cell.textContent?.trim() ?? "");
      if (!subject || !predicate) return [];
      // The viewer snapshot is normalized text-only FCT XML. Use the value's
      // lexical form for term-kind checks until term metadata is retained.
      const objectType = cells[2].getAttribute("termType") || (object.startsWith("_:") ? "bnode" : /^(?:https?:|gttp:|urn:)/i.test(object) ? "uri" : "literal");
      const datatype = cells[2].getAttribute("datatype") || undefined;
      return [{ subject, predicate, object, objectType, ...(datatype ? { datatype } : {}) }];
    });
    const response = await maestroQueryFetch("/proxy/api/service?service=maestro&operationId=policies", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-validate", "RecordPolicyValidation") },
      body: JSON.stringify({ action: "validate", recordUri: snapshot.uri, recordShape: policy.recordShape, triples }),
    });
    const payload = await response.json() as { report?: RecordValidationReport; error?: string };
    if (!response.ok || !payload.report) throw new Error(payload.error || `SHACL validation returned HTTP ${response.status}.`);
    // An incomplete description cannot establish full conformance: missing
    // values may reflect LIMIT/timeout rather than actual absence in the graph.
    if (snapshot.incomplete) return {
      ...payload.report,
      conforms: false,
      complete: false,
      message: "The Record DESCRIBE is incomplete. Increase the Right panel DESCRIBE limit or Record timeout, reload, and validate again. " + payload.report.message,
    };
    return payload.report;
  }

