"use client";
import { toast } from "@/components/ui/toast";

import { useEffect, useRef, useState } from "react";

/** State and graph-provenance selection shared by Record subviews. */
import type { RecordValueTerm, BlankNodeRecord } from "@/lib/bnode";
export type { RecordValueTerm, BlankNodeRecord } from "@/lib/bnode";
export type RecordGraphAuthor = { graph: string; author: string; predicate: string };
export function useRecordCoreState() {
  // An RDF blank-node label identifies a node only within the SELECT result set.
  // Retain its parent URI and predicate instead of attempting to query _:label.
  const [explicitBlankNodeAnchor, setExplicitBlankNodeAnchor] = useState<{
    label: string; parent: string; predicate: string;
  } | null>(null);
  const [blankNodeRecords, setBlankNodeRecords] = useState<BlankNodeRecord[]>([]);
  const [activeBlankNodeTab, setActiveBlankNodeTab] = useState(0);
  const [describedRecord, setDescribedRecord] = useState<RecordValueTerm[]>([]);
  const [describedRecordUri, setDescribedRecordUri] = useState("");
  // One authoritative SELECT snapshot feeds both Default and graph-stored XSLT formats.
  // Keep its XML, record identity, and completion flag together to prevent stale formatting.
  const [recordDescriptionSnapshot, setRecordDescriptionSnapshot] = useState<{
    key: string; uri: string; xml: string; incomplete: boolean;
  } | null>(null);

  // Graph provenance is discovered separately; Record SELECT is authoritative.
  const [recordGraphs, setRecordGraphs] = useState<string[]>([]);
  const [selectedRecordGraph, setSelectedRecordGraph] = useState("");
  const [selectedRecordAuthor, setSelectedRecordAuthor] = useState("");
  const [recordGraphError, setRecordGraphError] = useState("");
  const [loadingRecordGraphs, setLoadingRecordGraphs] = useState(false);
  const [loadingRecordAuthors, setLoadingRecordAuthors] = useState(false);
  const [recordAuthorError, setRecordAuthorError] = useState("");
  // A named graph's family is its full IRI before the first fragment delimiter.
  // Its #ID remains essential for physical named-graph selection and authorship.
  const [recordGraphAuthors, setRecordGraphAuthors] = useState<RecordGraphAuthor[]>([]);
  const recordGraphFamily = (iri: string): string => iri.split("#", 1)[0];
  const recordGraphOptions = Array.from(new Set(recordGraphs.map(recordGraphFamily)));
  const graphsInSelectedFamily = recordGraphs.filter((graph) =>
    !selectedRecordGraph || recordGraphFamily(graph) === selectedRecordGraph
  );
  const recordAuthors = recordGraphAuthors.filter((entry) => graphsInSelectedFamily.includes(entry.graph));

  return { explicitBlankNodeAnchor, setExplicitBlankNodeAnchor, blankNodeRecords, setBlankNodeRecords, activeBlankNodeTab, setActiveBlankNodeTab, describedRecord, setDescribedRecord, describedRecordUri, setDescribedRecordUri, recordDescriptionSnapshot, setRecordDescriptionSnapshot, recordGraphs, setRecordGraphs, selectedRecordGraph, setSelectedRecordGraph, selectedRecordAuthor, setSelectedRecordAuthor, recordGraphError, setRecordGraphError, loadingRecordGraphs, setLoadingRecordGraphs, loadingRecordAuthors, setLoadingRecordAuthors, recordAuthorError, setRecordAuthorError, recordGraphAuthors, setRecordGraphAuthors, recordGraphOptions, graphsInSelectedFamily, recordAuthors, recordGraphFamily };
}

export type RecordService = { uri: string; label: string; operations: { uri: string; label: string; requires: string[] }[] };
export type ServiceResult = { html: string; error: string; loading: boolean; name: string };

/** Renderer state shared by Record default, format, and service views. */
export function useRecordPresentationState(preferredAlphabetLanguage: string) {
  const [formattedRecordHtml, setFormattedRecordHtml] = useState("");
  // URI label lookups are presentation enhancements; never block the initial card.
  const recordUriLabelCacheRef = useRef(new Map<string, string>());
  // URI display labels also obey the preferred language. Never reuse labels
  // cached under a different selection.
  useEffect(() => { recordUriLabelCacheRef.current.clear(); }, [preferredAlphabetLanguage]);
  const [recordLabelRevision, setRecordLabelRevision] = useState(0);
  const [formattedRecordButtonsHtml, setFormattedRecordButtonsHtml] = useState<Record<string, string>>({});
  const [recordFormatPreviews, setRecordFormatPreviews] = useState<Record<string, string>>({});
  const [recordFormatMenuOpen, setRecordFormatMenuOpen] = useState(false);
  const [recordControlsOpen, setRecordControlsOpen] = useState(true);
  const [recordFormatError, setRecordFormatError] = useState("");
  const [bookmarkQueryDebugOpen, setBookmarkQueryDebugOpen] = useState(false);
  const [bookmarkQueryDebug, setBookmarkQueryDebug] = useState({ xml: "", sparql: "", response: "", countResponse: "" });
  // SHACL-discovered services use the same rendered Book XSLT tab host as
  // Other Properties. Their operations and XSLT live in the personal graph.
  const [recordServices, setRecordServices] = useState<RecordService[]>([]);
  const [recordServiceTab, setRecordServiceTab] = useState("");
  const [recordServiceResults, setRecordServiceResults] = useState<Record<string, ServiceResult>>({});
  const [recordServiceArguments, setRecordServiceArguments] = useState<Record<string, Record<string, string>>>({});
  const [recordServiceDom, setRecordServiceDom] = useState<{tabs: HTMLElement; host: HTMLElement} | null>(null);
  const activeServiceRecordRef = useRef("");
  const formattedRecordContainerRef = useRef<HTMLDivElement>(null);
  const [recordDebug, setRecordDebug] = useState({ xml: "", sparql: "", formatterXml: "", formatterSparql: "", policyDiscovery: "", templateLookup: "" });
  return { formattedRecordHtml, setFormattedRecordHtml, recordLabelRevision, setRecordLabelRevision, formattedRecordButtonsHtml, setFormattedRecordButtonsHtml, recordFormatPreviews, setRecordFormatPreviews, recordFormatMenuOpen, setRecordFormatMenuOpen, recordControlsOpen, setRecordControlsOpen, recordFormatError, setRecordFormatError, bookmarkQueryDebugOpen, setBookmarkQueryDebugOpen, bookmarkQueryDebug, setBookmarkQueryDebug, recordServices, setRecordServices, recordServiceTab, setRecordServiceTab, recordServiceResults, setRecordServiceResults, recordServiceArguments, setRecordServiceArguments, recordServiceDom, setRecordServiceDom, recordDebug, setRecordDebug, recordUriLabelCacheRef, activeServiceRecordRef, formattedRecordContainerRef };
}

/** Record paging and pending panel-size preferences. */
export function useRecordPageSettings() {
  const [recordDescriptionPage, setRecordDescriptionPage] = useState(0);
  const [recordDescriptionPageSize, setRecordDescriptionPageSize] = useState<number>(5);
  const [recordDescriptionQueryLimit, setRecordDescriptionQueryLimit] = useState<number>(10000);
  const [pendingRecordDescriptionLimit, setPendingRecordDescriptionLimit] = useState<number | null>(null);
  const [pendingCenterBatchLimit, setPendingCenterBatchLimit] = useState<number | null>(null);
  const [pendingLeftPanelLimit, setPendingLeftPanelLimit] = useState<number | null>(null);
  const [pendingGroupsBatchLimit, setPendingGroupsBatchLimit] = useState<number | null>(null);
  return { recordDescriptionPage, setRecordDescriptionPage, recordDescriptionPageSize, setRecordDescriptionPageSize, recordDescriptionQueryLimit, setRecordDescriptionQueryLimit, pendingRecordDescriptionLimit, setPendingRecordDescriptionLimit, pendingCenterBatchLimit, setPendingCenterBatchLimit, pendingLeftPanelLimit, setPendingLeftPanelLimit, pendingGroupsBatchLimit, setPendingGroupsBatchLimit };
}

/** Download the displayed immutable Record DESCRIBE as N-Triples. */
export function downloadRecordDescribeSnapshot(
  recordDescriptionSnapshot: { key: string; uri: string; xml: string; incomplete: boolean } | null,
  currentRecordDescriptionKey: string,
  selectedUri: string,
): void {
    const snapshot = recordDescriptionSnapshot;
    if (!snapshot || snapshot.key !== currentRecordDescriptionKey || snapshot.uri !== selectedUri) return;
    const parsed = new DOMParser().parseFromString(snapshot.xml, "application/xml");
    const ns = "http://openlinksw.com/services/facets/1.0/";
    const toTerm = (value: string, object = false): string => {
      if (/^_:[A-Za-z][\w-]*$/.test(value)) return value;
      if (/^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(value)) return `<${value}>`;
      if (!object) throw new Error(`Invalid RDF subject or predicate: ${value}`);
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
    };
    try {
      const lines: string[] = [];
      for (const row of Array.from(parsed.getElementsByTagNameNS(ns, "row"))) {
        const cells = Array.from(row.getElementsByTagNameNS(ns, "column"));
        if (cells.length < 3) continue;
        const [subject, predicate, object] = cells.slice(0, 3).map((c) => c.textContent?.trim() ?? "");
        if (subject && predicate && object) lines.push(`${toTerm(subject)} ${toTerm(predicate)} ${toTerm(object, true)} .`);
      }
      if (!lines.length) { toast.add({ title: "No DESCRIBE triples are available to download.", type: "error" }); return; }
      // RDF terms from the FCT projection have been normalized for display.
      // URI-looking objects are emitted as IRIs; all others as plain literals.
      const file = new Blob([`# Maestro Record DESCRIBE snapshot\n# Source: ${selectedUri}\n${snapshot.incomplete ? "# WARNING: Virtuoso reported an incomplete DESCRIBE.\n" : ""}${lines.join("\n")}\n`], { type: "application/n-triples;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${encodeURIComponent(selectedUri.split(/[\/#]/).pop() || "record")}-describe.nt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.add({ title: "Could not export the Record DESCRIBE", description: error instanceof Error ? error.message : "Could not export the Record DESCRIBE.", type: "error" });
    }
  }

