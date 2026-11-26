"use client";
import { toast } from "@/components/ui/toast";
import { RECORD_EXPORT_FORMATS, snapshotRecordQuads, serializeRecordQuads, type RecordExportFormat } from "@/canvas/right/record-export";
import { sanitizeDownloadFilename } from "@/lib/download-filename";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { MaestroRecordSessionController } from "@/lib/app-lifecycle/record-session";

/** State and graph-provenance selection shared by Record subviews. */
import { createBlankNodeRecordContext, type RecordValueTerm, type BlankNodeRecord } from "@/lib/bnode";
export type { RecordValueTerm, BlankNodeRecord } from "@/lib/bnode";
export type RecordGraphAuthor = { graph: string; author: string; predicate: string };
export function useRecordCoreState() {
  // One XState blank-node context per Record viewer, initially inactive.
  // URI and literal Records cannot activate or select blank-node siblings.
  const [blankNodeContext] = useState(createBlankNodeRecordContext);
  useEffect(() => () => blankNodeContext.stop(), [blankNodeContext]);
  // An RDF blank-node label identifies a node only within the SELECT result set.
  // Retain its parent URI and predicate instead of attempting to query _:label.
  const [explicitBlankNodeAnchor, setExplicitBlankNodeAnchor] = useState<{
    label: string; parent: string; predicate: string; direction: "forward" | "reverse"; queryXml: string;
  } | null>(null);
  const [blankNodeResponse, setBlankNodeResponse] = useState<{ key: string; records: BlankNodeRecord[] } | null>(null);
  const [activeBlankNodeTab, setActiveBlankNodeTabState] = useState(-1);
  const activeBlankNodeTabRef = useRef(-1);
  const chooseBlankNodeSibling = useCallback((index: number) => blankNodeContext.choose(index), [blankNodeContext]);
  const setActiveBlankNodeTab = useCallback((update: SetStateAction<number>) => {
    const index = typeof update === "function" ? update(activeBlankNodeTabRef.current) : update;
    if (index !== -1 && !blankNodeContext.isChosen(index)) return;
    activeBlankNodeTabRef.current = index;
    setActiveBlankNodeTabState(index);
  }, [blankNodeContext]);
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

  return { blankNodeContext, chooseBlankNodeSibling, explicitBlankNodeAnchor, setExplicitBlankNodeAnchor, blankNodeResponse, setBlankNodeResponse, activeBlankNodeTab, setActiveBlankNodeTab, describedRecord, setDescribedRecord, describedRecordUri, setDescribedRecordUri, recordDescriptionSnapshot, setRecordDescriptionSnapshot, recordGraphs, setRecordGraphs, selectedRecordGraph, setSelectedRecordGraph, selectedRecordAuthor, setSelectedRecordAuthor, recordGraphError, setRecordGraphError, loadingRecordGraphs, setLoadingRecordGraphs, loadingRecordAuthors, setLoadingRecordAuthors, recordAuthorError, setRecordAuthorError, recordGraphAuthors, setRecordGraphAuthors, recordGraphOptions, graphsInSelectedFamily, recordAuthors, recordGraphFamily };
}

export type RecordService = { uri: string; label: string; operations: { uri: string; label: string; requires: string[] }[] };
export type ServiceResult = { html: string; error: string; loading: boolean; name: string };

/** Renderer state shared by Record default, format, and service views. */
export function useRecordPresentationState(preferredAlphabetLanguage: string, lifecycle: MaestroRecordSessionController) {
  const [formattedRecordHtml, setFormattedRecordHtmlState] = useState("");
  // Record enrichment can complete after its initial DOM snapshot is visible.
  // Resolve functional updates against the latest committed value immediately,
  // not inside React's state updater (which can be replayed in Strict Mode),
  // so XState lifecycle events remain one-to-one with intentional commits.
  const formattedRecordHtmlRef = useRef("");
  const setFormattedRecordHtml = (update: SetStateAction<string>) => {
    const html = typeof update === "function" ? update(formattedRecordHtmlRef.current) : update;
    formattedRecordHtmlRef.current = html;
    setFormattedRecordHtmlState(html);
    const snapshot = lifecycle.getSnapshot();
    if (html) lifecycle.operation("format", "OP_SUCCEEDED", snapshot.context.key);
    else if (snapshot.context.phases.format === "ready") lifecycle.operation("format", "OP_RESET", snapshot.context.key);
  };
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
  const recordFormatError = lifecycle.getSnapshot().context.errors.format;
  const setRecordFormatError = (message: string) => {
    const key = lifecycle.getSnapshot().context.key;
    lifecycle.send(message ? { type: "OP_FAILED", key, operation: "format", error: message }
      : { type: "ERROR_CLEARED", key, operation: "format" });
  };
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

/** Use exactly the selected Record subject; a linked value's title must not name this download. */
export function recordDownloadTitle(rows: readonly { property: string; value: string; direction: string }[], uri: string): string {
  const predicates = [
    "http://data.europa.eu/s66#title", "http://purl.org/dc/terms/title",
    "http://www.w3.org/2000/01/rdf-schema#label", "http://www.w3.org/2004/02/skos/core#prefLabel",
    "https://schema.org/name", "http://schema.org/name", "http://xmlns.com/foaf/0.1/name",
  ];
  for (const predicate of predicates) {
    const title = rows.find(row => row.direction === "property" && row.property === predicate && row.value.trim())?.value.trim();
    if (title) return title;
  }
  return decodeURIComponent(uri.split(/[\/#]/).pop() || "record");
}

/** Download one validated, term-accurate Record DESCRIBE in the user's selected MIME type. */
export async function downloadRecordDescribeSnapshot(
  recordDescriptionSnapshot: { key: string; uri: string; xml: string; incomplete: boolean } | null,
  currentRecordDescriptionKey: string,
  selectedUri: string,
  format: RecordExportFormat = "ntriples",
  title = "",
): Promise<void> {
  const snapshot = recordDescriptionSnapshot;
  if (!snapshot || snapshot.key !== currentRecordDescriptionKey || snapshot.uri !== selectedUri) {
    toast.add({ title: "Record changed before download", description: "Reload the current Record and try again.", type: "error" });
    return;
  }
  try {
    const quads = snapshotRecordQuads(snapshot);
    const content = await serializeRecordQuads(quads, format);
    const { mime, extension } = RECORD_EXPORT_FORMATS[format];
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeDownloadFilename(title || selectedUri.split(/[\/#]/).pop() || "record")}-describe.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast.add({ title: "Could not export the Record DESCRIBE", description: error instanceof Error ? error.message : String(error), type: "error" });
  }
}
