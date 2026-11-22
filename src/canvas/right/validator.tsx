"use client";
import { clientRecordPolicyResponse } from "@/lib/client-record-policies";
import { type RecordPolicyOption } from "@/canvas/right/format";
import { maestroQueryFetch } from "@/lib/client-query-cache";
import { proxyDebugHeaders } from "@/lib/proxy-debug";


import type { ShaclValidationReport } from "@/lib/shacl-validation-report";

import { useState } from "react";
import type { MaestroRecordSessionController } from "@/lib/app-lifecycle/record-session";
/** Isolated SHACL validation response state. */
export function useRecordValidationState(lifecycle: MaestroRecordSessionController) {
  const [recordValidation, setRecordValidation] = useState<ShaclValidationReport | null>(null);
  const isValidatingRecord = lifecycle.getSnapshot().context.phases.validation === "loading";
  const setIsValidatingRecord = (loading: boolean) => {
    const key = lifecycle.getSnapshot().context.key;
    lifecycle.operation("validation", loading ? "OP_STARTED" : "OP_SUCCEEDED", key);
  };
  return { recordValidation, setRecordValidation, isValidatingRecord, setIsValidatingRecord };
}

  /** The validator and XSLT consume the same record/graph/author snapshot. */
export async function validateRecordSnapshot(
    policy: RecordPolicyOption,
    snapshot: { key: string; uri: string; xml: string; incomplete: boolean },
    signal?: AbortSignal,
  ): Promise<ShaclValidationReport> {
    const xml = new DOMParser().parseFromString(snapshot.xml, "application/xml");
    const parserError = xml.querySelector("parsererror");
    if (parserError) throw new Error(`Cannot validate malformed Record DESCRIBE XML.
Parser: ${parserError.textContent ?? "Unknown XML parse error"}
Snapshot URI: ${snapshot.uri}
Snapshot key: ${snapshot.key}
Snapshot complete: ${!snapshot.incomplete}
Raw DESCRIBE XML (verbatim):
${snapshot.xml}`);
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
    const response = await clientRecordPolicyResponse({
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-validate", "RecordPolicyValidation") },
      body: JSON.stringify({ action: "validate", recordUri: snapshot.uri, recordShape: policy.recordShape, triples }),
    });
    const payload = await response.json() as { report?: ShaclValidationReport; error?: string };
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

