"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRecordSessionState } from "@/canvas/controllers/record-session-state";
import { useRecordValidationState, validateRecordSnapshot } from "@/canvas/right/validator";
import { loadRecordDescription } from "@/canvas/controllers/record-description-loader";
import type { RecordPaneWorkspace } from "@/canvas/controllers/workspace-interfaces";
import type { RecordSessionDescriptor, RecordSessionsController } from "@/canvas/controllers/record-session-model";
import { parseBlankNodeRecordBindings, type RecordValueTerm } from "@/lib/bnode";
import { cachedFetchFct, maestroQueryFetch } from "@/lib/client-query-cache";
import { readRecordGraphAuthors } from "@/lib/record-authors";
import { recordGraphFctQuery, readRecordGraphFctResponse } from "@/lib/record-graph-marshalling";
import { readRecordGraphDiscoveryLimits } from "@/lib/record-graph-limits";
import { proxyDebugHeaders } from "@/lib/proxy-debug";
import { downloadRecordDescribeSnapshot } from "@/canvas/right/record";
import { transformMaestroRecordXslt } from "@/lib/maestro-xslt";
import { queryDigest } from "@/canvas/controllers/personal-record-status";
import type { RecordPolicyOption } from "@/canvas/right/format";

/**
 * A pivot has all the same Record-local state hooks as session 0, but none of
 * Browse's Results subscriptions. Browse owns the identity of session 0;
 * controller-created sessions own independent RDF and format lifetimes.
 *
 * The normal RightCanvasPanel consumes this adapter without a second Record
 * renderer. The immutable FCT SELECT snapshot is built by the same loader
 * used by Browse's Record lifecycle.
 */
export function useRecordPivotWorkspace(
  session: RecordSessionDescriptor,
  controller: RecordSessionsController,
  browse: RecordPaneWorkspace,
): RecordPaneWorkspace {
  const own = useRecordSessionState(browse.preferredAlphabetLanguage);
  // Fullscreen pivot controls are initially collapsed independently of
  // policy discovery and automated validation. User expansion is preserved.
  useEffect(() => { own.setRecordControlsOpen(false); }, []); // mount only
  const validation = useRecordValidationState();
  const [formatEnabled, setFormatEnabled] = useState(browse.recordFormatEnabled);
  const { identity } = session;
  const selectedUri = identity.value;
  const recordTermType = identity.termType;
  // An RDFa pivot is a real Record visit, not necessarily a Results-page
  // selection. The controller requests the ordinary ViewRecord transition
  // only when the original live query's Bookmark gate is verified.
  useEffect(() => {
    if (!browse.recordStatus.enabled || !browse.authSession || recordTermType !== "uri" ||
        !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(selectedUri)) return;
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    void queryDigest(identity.queryXml).then(queryHash => {
      if (request.signal.aborted) return;
      return fetch("/proxy/api/service?service=maestro&operationId=record-status", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", queryHash, uri: selectedUri, status: "Seen", enabled: true }),
      }).then(async response => { if (!response.ok) throw new Error(`Record Seen transition failed (HTTP ${response.status})`); });
    }).catch(error => { if (!request.signal.aborted) console.warn("Maestro Record Seen transition", error); });
    return () => { request.abort(); release(); };
  }, [session.id, identity.queryXml, selectedUri, recordTermType, browse.recordStatus.enabled, browse.authSession, controller]);
  const currentRecordDescriptionKey = [session.id, selectedUri, recordTermType,
    identity.datatype ?? "", identity.lang ?? "", identity.bnodeQueryXml ?? "",
    own.selectedRecordGraph, own.selectedRecordAuthor,
    browse.recordDescriptionQueryLimit, browse.preferredAlphabetLanguage].join("\u0000");
  const requestKeyRef = useRef(currentRecordDescriptionKey);
  requestKeyRef.current = currentRecordDescriptionKey;
  const { describedRecord, describedRecordUri, recordDescriptionSnapshot, selectedRecordGraph,
    selectedRecordAuthor, recordGraphs, recordPolicies, recordPolicy,
    selectedRecordTemplateUri } = own;
  const graphsInSelectedFamily = useMemo(() => recordGraphs.filter(graph =>
    !selectedRecordGraph || graph.split("#", 1)[0] === selectedRecordGraph), [recordGraphs, selectedRecordGraph]);

  // All pending traffic is registered with the session lifecycle. A discarded
  // Shift-click successor cannot repaint its replacement, and Shrink aborts it.
  useEffect(() => {
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    own.setIsDescribing(true);
    own.setRecordDescriptionError("");
    own.setRecordDescribeIncomplete(false);
    own.setDescribedRecord([]);
    own.setDescribedRecordUri("");
    own.setRecordDescriptionSnapshot(null);
    own.setBlankNodeRecords([]);
    own.setActiveBlankNodeTab(0);
    own.setFormattedRecordHtml("");
    own.setRecordFormatError("");
    own.setRecordDescriptionPage(0);
    const selectedGraphs = own.selectedRecordAuthor ? [own.selectedRecordAuthor] :
      own.selectedRecordGraph ? recordGraphs.filter(graph => graph.split("#", 1)[0] === own.selectedRecordGraph) : [];
    void (async () => {
      try {
        if ((own.selectedRecordGraph || own.selectedRecordAuthor) && selectedGraphs.length === 0) {
          throw new Error("No named graphs are available for this Record graph or author.");
        }
        if (recordTermType === "bnode") {
          const queryXml = identity.bnodeQueryXml;
          const anchor = identity.bnodeAnchor;
          if (!queryXml || !anchor) throw new Error("This blank-node pivot needs the existing URI-anchored FCT blank-node query.");
          const response = await cachedFetchFct("/proxy/api/sparql", {
            method: "POST", cache: "no-store", signal: request.signal,
            headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-blank-node-siblings", "RecordDescription") },
            body: JSON.stringify({ recordBlankNodes: { queryXml, parent: anchor.parent,
              predicate: anchor.predicate, preferredLanguage: browse.preferredAlphabetLanguage,
              limit: browse.recordDescriptionQueryLimit,
              ...(selectedGraphs.length ? { graphs: selectedGraphs } : {}) } }),
          });
          const payload = await response.json() as {
            error?: string; query?: string; incomplete?: boolean;
            results?: { bindings?: Parameters<typeof parseBlankNodeRecordBindings>[0] };
          };
          if (!response.ok) throw new Error(payload.error || "Blank-node Record SELECT failed.");
          if (request.signal.aborted) return;
          const incomplete = Boolean(payload.incomplete) ||
            (payload.results?.bindings?.length ?? 0) >= browse.recordDescriptionQueryLimit;
          const siblings = parseBlankNodeRecordBindings(payload.results?.bindings ?? [], incomplete);
          const activeIndex = Math.max(0, siblings.findIndex(row => row.id === selectedUri));
          const chosen = siblings[activeIndex];
          own.setBlankNodeRecords(siblings);
          own.setActiveBlankNodeTab(activeIndex);
          own.setDescribedRecord(chosen?.rows ?? []);
          own.setDescribedRecordUri(selectedUri);
          own.setRecordDescribeIncomplete(incomplete);
          own.setRecordDescriptionSnapshot(chosen ? { key: currentRecordDescriptionKey, uri: selectedUri,
            xml: chosen.xml, incomplete } : null);
          own.setRecordDebug(current => ({ ...current, xml: queryXml, sparql: payload.query ?? "Record query unavailable." }));
        } else {
          const data = await loadRecordDescription({ queryXml: identity.queryXml,
            value: selectedUri, termType: recordTermType, datatype: identity.datatype,
            lang: identity.lang, limit: browse.recordDescriptionQueryLimit,
            preferredLanguage: browse.preferredAlphabetLanguage, signal: request.signal,
            graphs: selectedGraphs });
          if (request.signal.aborted) return;
          own.setDescribedRecord(data.rows);
          own.setDescribedRecordUri(selectedUri);
          own.setRecordDescriptionSnapshot({ key: currentRecordDescriptionKey, uri: selectedUri,
            xml: data.xml, incomplete: data.incomplete });
          own.setRecordDescribeIncomplete(data.incomplete);
          own.setRecordDebug(current => ({...current, xml: data.debug, sparql: data.query }));
        }
      } catch (error) {
        if (request.signal.aborted) return;
        own.setRecordDescriptionError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!request.signal.aborted) own.setIsDescribing(false);
        release();
      }
    })();
    return () => { request.abort(); release(); };
  // This work is keyed exclusively to the Record session, its explicit graph
  // choice, and the passed context; never to an incidental Browse re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, selectedUri, recordTermType, identity.bnodeQueryXml,
      identity.datatype, identity.lang, identity.queryXml, own.selectedRecordGraph,
      own.selectedRecordAuthor, recordGraphs.join("\u0000"), browse.recordDescriptionQueryLimit,
      browse.preferredAlphabetLanguage]);

  // Discovered graphs are independent of DESCRIBE. A graph-discovery timeout
  // must not hide otherwise valid Record properties or Roles.
  useEffect(() => {
    own.setRecordGraphs([]);
    own.setSelectedRecordGraph("");
    own.setSelectedRecordAuthor("");
    own.setRecordGraphError("");
    if (recordTermType === "literal") return;
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    own.setLoadingRecordGraphs(true);
    void (async () => {
      try {
        const projection = recordGraphFctQuery({ addr: browse.queryTree.attributes.addr,
          ...(recordTermType === "bnode" ? { blankQueryXml: identity.bnodeQueryXml || "" } : { uri: selectedUri }),
          limits: readRecordGraphDiscoveryLimits() });
        const response = await cachedFetchFct("/proxy/api/fct", {
          method: "POST", cache: "no-store", signal: request.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-graph-fct", "RecordGraphs") },
          body: JSON.stringify({ queryXml: projection }),
        });
        const raw = await response.text();
        if (!response.ok) throw new Error(raw.slice(0, 800));
        const data = readRecordGraphFctResponse(raw);
        if (!data.complete) throw new Error("Record graph discovery was incomplete.");
        if (!request.signal.aborted) own.setRecordGraphs(data.graphs ?? []);
      } catch (error) {
        if (!request.signal.aborted) own.setRecordGraphError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!request.signal.aborted) own.setLoadingRecordGraphs(false);
        release();
      }
    })();
    return () => { request.abort(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, selectedUri, recordTermType, identity.bnodeQueryXml, browse.queryTree.attributes.addr]);

  useEffect(() => {
    own.setRecordGraphAuthors([]);
    own.setSelectedRecordAuthor("");
    if (!own.selectedRecordGraph || !graphsInSelectedFamily.length) return;
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    own.setLoadingRecordAuthors(true);
    void readRecordGraphAuthors(browse.queryTree.attributes.addr ?? "", graphsInSelectedFamily, request.signal)
      .then(authors => { if (!request.signal.aborted) own.setRecordGraphAuthors(authors); })
      .catch(error => { if (!request.signal.aborted) own.setRecordAuthorError(String(error)); })
      .finally(() => { if (!request.signal.aborted) own.setLoadingRecordAuthors(false); release(); });
    return () => { request.abort(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, own.selectedRecordGraph, graphsInSelectedFamily.join("\u0000"), browse.queryTree.attributes.addr]);

  // Policy discovery is per pivot, not copied from Browse's selected Record.
  // The formatter is never chosen from a different Record's rdf:type.
  useEffect(() => {
    own.setRecordPolicy(null);
    own.setRecordPolicies([]);
    own.setRecordPolicyCheckedUri("");
    if (recordTermType === "bnode" || !browse.authSession || own.isDescribing ||
        describedRecordUri !== selectedUri) return;
    // An empty but completed DESCRIBE has no policy candidates. Do not leave
    // the Record formatter stuck on "Looking for a record policy" forever.
    if (!describedRecord.length) { own.setRecordPolicyCheckedUri(selectedUri); return; }
    const recordTypes = [...new Set(describedRecord.filter(r =>
      r.direction === "property" && r.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      /^[a-z][a-z0-9+.-]*:/i.test(r.value)).map(r => r.value))];
    if (recordTypes.length === 0) { own.setRecordPolicyCheckedUri(selectedUri); return; }
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    own.setIsLoadingRecordPolicy(true);
    void (async () => {
      try {
        const response = await maestroQueryFetch("/proxy/api/service?service=maestro&operationId=policies", {
          method: "POST", cache: "no-store", signal: request.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-discover", "RecordPolicyDiscovery") },
          body: JSON.stringify({ action: "discover", recordTypes, recordUri: selectedUri,
            queryXml: identity.queryXml,
            triples: describedRecord.filter(r => r.direction === "property").map(r => ({
              subject: selectedUri, predicate: r.property, object: r.value, objectType: r.termType,
              ...(r.datatype ? { datatype: r.datatype } : {}),
            })) }),
        });
        const data = await response.json() as { error?: string; debugSparql?: string;
          policies?: Array<{uri:string;label:string;recordShape:string;matchedClasses?:string[];
            templates:Array<{uri:string;label:string}>}> };
        if (!response.ok) throw new Error(data.error || `Policy discovery failed (${response.status}).`);
        if (request.signal.aborted) return;
        const policies: RecordPolicyOption[] = (data.policies ?? []).map(p => ({...p,
          matchedClasses: p.matchedClasses ?? [], template: p.templates[0]?.uri ?? null }));
        own.setRecordDebug(current => ({ ...current, policyDiscovery: data.debugSparql ?? "" }));
        own.setRecordPolicies(policies);
        const preferred = policies.find(p => recordTypes.some(type => p.matchedClasses.includes(type))) ?? policies[0] ?? null;
        own.setRecordPolicy(preferred);
        own.setSelectedRecordTemplateUri(preferred?.templates[0]?.uri ?? "");
      } catch (error) {
        if (!request.signal.aborted) own.setRecordPolicyError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!request.signal.aborted) { own.setRecordPolicyCheckedUri(selectedUri); own.setIsLoadingRecordPolicy(false); }
        release();
      }
    })();
    return () => { request.abort(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, selectedUri, identity.queryXml, recordTermType, describedRecord, describedRecordUri, own.isDescribing, browse.authSession]);

  async function validateSelectedRecord(policyOverride: RecordPolicyOption | null = recordPolicy) {
    if (!recordDescriptionSnapshot || !policyOverride) return;
    validation.setIsValidatingRecord(true);
    validation.setRecordValidation(null);
    try {
      const result = await validateRecordSnapshot(policyOverride, recordDescriptionSnapshot);
      if (requestKeyRef.current === recordDescriptionSnapshot.key) validation.setRecordValidation(result);
    } catch (error) {
      own.setRecordPolicyError(error instanceof Error ? error.message : String(error));
    } finally { validation.setIsValidatingRecord(false); }
  }

  // Same graph-stored template + SaxonJS adapter as Browse; the controller
  // owns the request. Untrusted template markup is sanitized before rendering.
  useEffect(() => {
    own.setFormattedRecordHtml("");
    own.setFormattedRecordButtonsHtml({});
    if (!formatEnabled || !recordPolicy || !selectedRecordTemplateUri || !recordDescriptionSnapshot ||
        recordDescriptionSnapshot.key !== currentRecordDescriptionKey ||
        recordTermType === "bnode" || own.isDescribing) return;
    const snapshot = recordDescriptionSnapshot;
    const request = new AbortController();
    const release = controller.registerRequest(session.id, request);
    void (async () => {
      try {
        const report = await validateRecordSnapshot(recordPolicy, snapshot);
        if (request.signal.aborted) return;
        validation.setRecordValidation(report);
        if (!report.complete || !report.conforms) throw new Error("Record format requires a complete, conforming SHACL description.");
        const response = await maestroQueryFetch("/proxy/api/service?service=maestro&operationId=policies", {
          method: "POST", cache: "no-store", signal: request.signal,
          headers: { "Content-Type": "application/json", ...proxyDebugHeaders("record-policy-template", "RecordPolicyTemplate") },
          body: JSON.stringify({ action: "template", template: selectedRecordTemplateUri }),
        });
        const data = await response.json() as { templateXslt?: string; error?: string; debugSparql?: string };
        if (!response.ok || !data.templateXslt) throw new Error(data.error || "The Record template could not be loaded.");
        const source = new DOMParser().parseFromString(snapshot.xml, "application/xml");
        if (source.querySelector("parsererror")) throw new Error("Malformed Record FCT XML.");
        const document = await transformMaestroRecordXslt(data.templateXslt, source, identity.queryXml,
          selectedUri, request.signal);
        const root = document.body.firstElementChild;
        if (!root || root.id !== "maestro-record-viewer" || root.tagName.toLowerCase() !== "section") {
          throw new Error("The Record formatter must produce <section id=\"maestro-record-viewer\">.");
        }
        sanitizePivotTemplate(document.body, session.id);
        if (request.signal.aborted) return;
        own.setRecordDebug(current => ({ ...current, templateLookup: data.debugSparql ?? "" }));
        own.setFormattedRecordHtml(document.body.innerHTML);
        own.setRecordFormatError("");
      } catch (error) {
        if (!request.signal.aborted) own.setRecordFormatError(error instanceof Error ? error.message : String(error));
      } finally { release(); }
    })();
    return () => { request.abort(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, formatEnabled, recordPolicy?.uri, selectedRecordTemplateUri,
      recordDescriptionSnapshot, currentRecordDescriptionKey, selectedUri, recordTermType,
      own.isDescribing, identity.queryXml]);

  const describedProperties = useMemo(() => [...describedRecord.reduce((map, row) => {
    const key = `${row.direction}\u0000${row.property}`;
    const group = map.get(key) ?? { property: row.property, direction: row.direction,
      values: [] as RecordValueTerm[] };
    group.values.push(row);
    map.set(key, group);
    return map;
  }, new Map<string, { property: string; direction: RecordValueTerm["direction"]; values: RecordValueTerm[] }>()).values()], [describedRecord]);
  const pageCount = Math.max(1, Math.ceil(describedProperties.length / browse.RECORD_DESCRIPTION_PAGE_SIZE));
  const page = Math.min(own.recordDescriptionPage, pageCount - 1);
  const visible = describedProperties.slice(page * browse.RECORD_DESCRIPTION_PAGE_SIZE, (page + 1) * browse.RECORD_DESCRIPTION_PAGE_SIZE);
  const recordFormatPreferenceKey = (kind: "policy" | "template") => {
    const type = describedRecord.find(row => row.direction === "property" &&
      row.property === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")?.value;
    return type ? `record-${kind}-category:${type}` : "";
  };
  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const uriValue = recordTermType === "uri" ? `<value datatype="uri">${selectedUri.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</value>` :
    `<value datatype="string">${selectedUri.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</value>`;
  const snapshot = recordDescriptionSnapshot;
  const currentFormattedRecordHtml = snapshot?.key === currentRecordDescriptionKey &&
    !own.isDescribing && formatEnabled ? own.formattedRecordHtml : "";
  const workspace: RecordPaneWorkspace = {
    ...browse,
    activeBlankNodeTab: own.activeBlankNodeTab,
    blankNodeRecords: own.blankNodeRecords,
    currentFormattedRecordHtml,
    currentRecordDescriptionKey,
    describedProperties,
    describedPropertyCount: describedProperties.filter(r => r.direction === "property").length,
    describedPropertyRows: visible.filter(r => r.direction === "property"),
    describedRecord, describedRecordUri,
    describedRoleCount: describedProperties.filter(r => r.direction === "property-of").length,
    describedRoleRows: visible.filter(r => r.direction === "property-of"),
    displayedRecord: describedRecord, displayedRecordPage: page, displayedRecordPageCount: pageCount,
    downloadRecordDescribe: () => downloadRecordDescribeSnapshot(snapshot, currentRecordDescriptionKey, selectedUri),
    formattedRecordButtonsHtml: own.formattedRecordButtonsHtml,
    formattedRecordContainerRef: own.formattedRecordContainerRef,
    invokeRecordService: async () => { /* Services are never invoked against session 0 from a pivot. */ },
    isDescribing: own.isDescribing,
    isLoadingRecordPolicy: own.isLoadingRecordPolicy,
    isValidatingRecord: validation.isValidatingRecord,
    loadingRecordAuthors: own.loadingRecordAuthors,
    loadingRecordGraphs: own.loadingRecordGraphs,
    manualRecordFormatSelectionRef: own.manualRecordFormatSelectionRef,
    queryXml: identity.queryXml,
    recordAuthorError: own.recordAuthorError,
    recordAuthors: own.recordAuthors,
    recordControlsOpen: own.recordControlsOpen,
    recordDebug: own.recordDebug,
    recordDescribeIncomplete: own.recordDescribeIncomplete,
    recordDescriptionError: own.recordDescriptionError,
    recordDescriptionSnapshot: snapshot,
    recordFormatEnabled: formatEnabled,
    recordFormatError: own.recordFormatError,
    recordFormatMenuOpen: own.recordFormatMenuOpen,
    recordFormatPreferenceKey,
    recordFormatPreviews: own.recordFormatPreviews,
    recordGraphError: own.recordGraphError,
    recordGraphOptions: own.recordGraphOptions,
    recordGraphs: own.recordGraphs,
    recordPolicies,
    recordPolicy,
    recordPolicyCheckedUri: own.recordPolicyCheckedUri,
    recordPolicyError: own.recordPolicyError,
    recordRootDebugQuery: recordTermType === "bnode" ? (identity.bnodeQueryXml ?? "") :
      `<?xml version="1.0"?><query xmlns="http://openlinksw.com/services/facets/1.0" addr="${escapeXml(browse.queryTree.attributes.addr ?? "")}">${uriValue}<view type="describe" limit="${browse.recordDescriptionQueryLimit}" offset="0"/></query>`,
    recordServiceArguments: own.recordServiceArguments,
    recordServiceDom: own.recordServiceDom,
    recordServiceResults: own.recordServiceResults,
    recordServiceTab: own.recordServiceTab,
    recordServices: own.recordServices,
    recordUriLabelCacheRef: own.recordUriLabelCacheRef,
    recordValidation: validation.recordValidation,
    selectedGroupRecord: undefined,
    selectedRecordAuthor,
    selectedRecordGraph,
    selectedRecordTemplateUri,
    selectedRecordTermType: recordTermType,
    selectedResult: undefined,
    selectedUri,
    setActiveBlankNodeTab: own.setActiveBlankNodeTab,
    setDescribedRecord: own.setDescribedRecord,
    setExplicitBlankNodeAnchor: own.setExplicitBlankNodeAnchor,
    setFormattedRecordButtonsHtml: own.setFormattedRecordButtonsHtml,
    setFormattedRecordHtml: own.setFormattedRecordHtml,
    setRecordControlsOpen: own.setRecordControlsOpen,
    setRecordDescriptionPage: own.setRecordDescriptionPage,
    setRecordDescriptionSnapshot: own.setRecordDescriptionSnapshot,
    setRecordFormatEnabled: setFormatEnabled,
    setRecordFormatError: own.setRecordFormatError,
    setRecordFormatMenuOpen: own.setRecordFormatMenuOpen,
    setRecordPolicy: own.setRecordPolicy,
    setRecordServiceTab: own.setRecordServiceTab,
    setRecordValidation: validation.setRecordValidation,
    setSelectedRecordAuthor: own.setSelectedRecordAuthor,
    setSelectedRecordGraph: own.setSelectedRecordGraph,
    setSelectedRecordTemplateUri: own.setSelectedRecordTemplateUri,
    setSelectedUri: () => { /* Pivot navigation is exclusively an RDFa controller action. */ },
    validateSelectedRecord,
  };
  return workspace;
}

/** Template markup is graph-authored. Allow RDFa, but never active scripts or
 * unsanitized navigation, and namespace HTML IDs across simultaneous panes. */
function sanitizePivotTemplate(root: HTMLElement, sessionId: string): void {
  root.querySelectorAll("script, iframe, object, embed, form, base, link, style, meta[http-equiv], mui\\:template-call")
    .forEach(element => element.remove());
  const ids = new Map<string,string>();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" ||
          (["href","src","action","formaction","xlink:href"].includes(name) && /^\s*javascript:/i.test(attr.value))) {
        element.removeAttribute(attr.name);
      }
    }
    if (element.id) {
      const target = `${sessionId}-${element.id}`;
      ids.set(element.id, target);
      element.id = target;
    }
  }
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const name of ["for", "aria-controls", "aria-labelledby", "aria-describedby"]) {
      const value = element.getAttribute(name);
      if (value) element.setAttribute(name, value.split(/\s+/).map(id => ids.get(id) ?? id).join(" "));
    }
    const href = element.getAttribute("href");
    if (href?.startsWith("#") && ids.has(href.slice(1))) element.setAttribute("href", `#${ids.get(href.slice(1))}`);
  }
}
