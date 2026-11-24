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
      const [subjectCell, predicateCell, objectCell] = cells;
      const subject = subjectCell.textContent ?? "";
      const predicate = predicateCell.textContent ?? "";
      const object = objectCell.textContent ?? "";
      if (!subject || !predicate) return [];
      // The Record loader preserves RDF term metadata; never infer a literal's
      // type from its lexical form or discard language/whitespace.
      const subjectType = subjectCell.getAttribute("termType");
      const objectType = objectCell.getAttribute("termType");
      if (subjectType !== "uri" && subjectType !== "bnode") throw new Error(`Invalid Record subject term type: ${JSON.stringify(subjectType)} for ${JSON.stringify(subject)}`);
      if (objectType !== "uri" && objectType !== "bnode" && objectType !== "literal") throw new Error(`Invalid Record object term type: ${JSON.stringify(objectType)} for ${JSON.stringify(object)}`);
      const datatype = objectCell.getAttribute("datatype") || undefined;
      const lang = objectCell.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") || undefined;
      return [{ subject, subjectType, predicate, object, objectType, ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}) }];
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

