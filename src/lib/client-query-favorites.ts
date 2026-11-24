"use client";

/** Browser-owned History/Bookmarks persistence, migrated from the domain-specific
 * /service handler. The authenticated /sparql proxy remains the sole gateway and
 * enforces graph access. No independent authorization decision is made here. */
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { historyQueryRdf, VFCT } from "@/lib/history-query-rdf";
import { XMLParser } from "fast-xml-parser";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { personalContext, selectPersonal, updatePersonal, type PersonalContext, type PersonalRows } from "@/lib/client-personal-sparql";

const VFCT_NS = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const MAESTRO_IDS_NS = "gttp://ggg.maestro.ecosys/ids/";
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init);
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}
function askAsSelect(sparql: string): string {
  // The common SPARQL gateway implements SELECT JSON, not ASK boolean JSON.
  const marker = /\bASK\s+WHERE\s*\{/i;
  if (!marker.test(sparql)) throw new Error("Expected an ASK WHERE query.");
  return sparql.replace(marker, "SELECT ?exists WHERE { ").replace(/\}\s*$/, " BIND(true AS ?exists) } LIMIT 1");
}
const selectResult = (rows: PersonalRows) => ({results:{bindings:rows}});










const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const ANNOTATION_NS = "http://www.w3.org/2000/10/annotation-ns#";
const BOOKMARK_NS = "http://www.w3.org/2002/01/bookmark#";
const SIOC_NS = "http://rdfs.org/sioc/ns#";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const SCOT_NS = "http://rdfs.org/scot/ns#";
const SCHEMA_NS = "https://schema.org/";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
const MAESTRO_UI_NS = "gttp://ggg.maestro.ecosys/ns/ui#";

function sparqlString(value: string): string {
  return JSON.stringify(value);
}
function iri(value: string): string {
  if (!value || /[<>"{}|^`\\\s]/u.test(value)) throw new Error(`Unsafe IRI in saved query: ${value}`);
  return `<${value}>`;
}
function mintedId(prefix: string): string {
  return `${MAESTRO_IDS_NS}${prefix}-${crypto.randomUUID()}#thisistheid`;
}
/** Save Annotea bookmarks using DCMI Terms and established tagging vocabularies. */
async function postFavorites(request: Request, ctx: PersonalContext) {
  try {
    const body = await request.json() as {
      action?: unknown;
      queryXml?: unknown;
      title?: unknown;
      description?: unknown;
      tags?: unknown;
      tagVocabulary?: unknown;
      shareLink?: unknown;
      stateUrl?: unknown;
      historyId?: unknown;
      direction?: unknown;
      historyAction?: unknown;
      lastResultCount?: unknown;
      lastNewCount?: unknown;
    };
    const action = typeof body.action === "string" ? body.action : "";
    const metricValue = (value: unknown): number | null =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

    const historyId = typeof body.historyId === "string" ? body.historyId.trim() : "";
    const baseGraph = ctx.base;
    const graph = iri(`${baseGraph}#history`);
    const bookmarkGraph = iri(`${baseGraph}#bookmarks`);
    const historyNs = `${MAESTRO_IDS_NS}history#`;
    const historyQuery = `${VFCT_NS}historyQueryXML`;
    const historyState = `${VFCT_NS}historyStateUrl`;
    const historyCreated = `${VFCT_NS}historyCreated`;
    const historyAction = `${VFCT_NS}historyAction`;
    const historyType = `${VFCT_NS}QueryHistoryVisit`;

    const queryPersonal = async (q: string) => selectResult(await selectPersonal(q, ctx, request.signal,request.headers.get("x-maestro-debug-source") || `HistoryBookmarks:${action || "query"}`));
    const writePersonal = (u: string) => updatePersonal(u, request.signal,undefined,request.headers.get("x-maestro-debug-source") || `HistoryBookmarks:${action || "query"}`);
    const askPersonal = async (q: string) => (await selectPersonal(askAsSelect(q), ctx, request.signal,request.headers.get("x-maestro-debug-source") || `HistoryBookmarks:${action || "query"}`)).length > 0;

    // History requests have their own validation; only actions that actually
    // carry a query require serialized FCT XML.
    if (action === "getHistoryItem") {
      if (!historyId) return json({ error: "A History item ID is required." }, { status: 400 });
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?queryXML ?stateUrl ?action WHERE { GRAPH ${graph} { ${iri(historyId)} rdf:type vfct:QueryHistoryVisit ; vfct:historyQueryXML ?queryXML . OPTIONAL { ${iri(historyId)} vfct:historyStateUrl ?stateUrl } OPTIONAL { ${iri(historyId)} vfct:historyAction ?action } } } LIMIT 1`;
      const result = await queryPersonal(query);
      const row = result.results?.bindings?.[0];
      if (!row) return json({ error: "The History item was not found." }, { status: 404 });
      let parsedAction: unknown = null;
      try { parsedAction = row.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
      return json({ found: true, historyId, queryXml: row.queryXML?.value ?? "", stateUrl: row.stateUrl?.value ?? "", action: parsedAction });
    }

    if (action === "recentActions") {
      // Radiate outward from the currently loaded History item: "backward" lists items EARLIER than it
      // (latest first), "forward" lists items LATER than it (earliest first). With no loaded item the
      // cursor is "now": everything is earlier, nothing is later.
      const direction = body.direction === "forward" ? "forward" : "backward";
      if (direction === "forward" && !historyId) return json({ items: [] });
      const comparison = direction === "backward" ? "<" : ">";
      const order = direction === "backward" ? "DESC" : "ASC";
      const cursor = historyId
        ? `${iri(historyId)} vfct:historyCreated ?cursorCreated . `
        : "";
      const cursorFilter = historyId ? `FILTER(?created ${comparison} ?cursorCreated)` : "";
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?visit ?created ?action WHERE { GRAPH ${graph} { ${cursor}?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created . OPTIONAL { ?visit vfct:historyAction ?action } ${cursorFilter} } } ORDER BY ${order}(?created) LIMIT 10`;
      const result = await queryPersonal(query);
      const items = (result.results?.bindings ?? []).map((row: any) => {
        let parsedAction: unknown = null;
        try { parsedAction = row.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
        return { historyId: row.visit?.value ?? "", created: row.created?.value ?? "", action: parsedAction };
      });
      return json({ items });
    }

    if (action === "availability" || action === "navigate") {
      if (!historyId) return json({ error: "A History item ID is required." }, { status: 400 });
      if (action === "availability") {
        const direction = body.direction === "forward" ? "forward" : "backward";
        const comparison = direction === "backward" ? "<" : ">";
        const order = direction === "backward" ? "DESC" : "ASC";
        const query = `PREFIX vfct: <${VFCT_NS}> SELECT ?created WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit vfct:historyCreated ?created . FILTER(?created ${comparison} ?cursorCreated) } } ORDER BY ${order}(?created) LIMIT 1`;
        const result = await queryPersonal(query);
        return json(direction === "backward" ? { older: Boolean(result.results?.bindings?.length) } : { newer: Boolean(result.results?.bindings?.length) });
      }
      const direction = body.direction === "forward" ? "forward" : "backward";
      const comparison = direction === "backward" ? "<" : ">";
      const order = direction === "backward" ? "DESC" : "ASC";
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> PREFIX schema: <${SCHEMA_NS}> SELECT ?visit ?created ?stateUrl ?queryXML ?action WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created ; vfct:historyQueryXML ?queryXML . OPTIONAL { ?visit vfct:historyStateUrl ?stateUrl } OPTIONAL { ?visit vfct:historyAction ?action } FILTER(?created ${comparison} ?cursorCreated) } } ORDER BY ${order}(?created) LIMIT 1`;
      const result = await queryPersonal(query);
      const row = result.results?.bindings?.[0];
      let parsedAction: unknown = null;
      try { parsedAction = row?.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
      return json(row ? { found: true, historyId: row.visit?.value, queryXml: row.queryXML?.value, stateUrl: row.stateUrl?.value ?? "", action: parsedAction } : { found: false });
    }

    if (action === "updateMetrics") {
      if (!historyId) return json({ error: "A History item ID is required." }, { status: 400 });
      const lastResultCount = metricValue(body.lastResultCount);
      const lastNewCount = metricValue(body.lastNewCount);
      if (lastResultCount === null && lastNewCount === null)
        return json({ updated: false });
      const isVisit = await askPersonal(`ASK WHERE { GRAPH ${graph} { ${iri(historyId)} a <${historyType}> } }`);
      if (!isVisit) return json({ error: "History visit not found." }, { status: 404 });
      const metrics = [
        ...(lastResultCount === null ? [] : [{ predicate: `${MAESTRO_UI_NS}lastResultCount`, value: lastResultCount }]),
        ...(lastNewCount === null ? [] : [{ predicate: `${MAESTRO_UI_NS}lastNewCount`, value: lastNewCount }]),
      ];
      await writePersonal(`DELETE { GRAPH ${graph} { ${metrics.map((m, index) => `${iri(historyId)} ${iri(m.predicate)} ?old${index} .`).join(" ")} } }
        INSERT { GRAPH ${graph} { ${metrics.map(m => `${iri(historyId)} ${iri(m.predicate)} ${m.value} .`).join(" ")} } }
        WHERE { ${metrics.map((m, index) => `OPTIONAL { GRAPH ${graph} { ${iri(historyId)} ${iri(m.predicate)} ?old${index} } }`).join(" ")} }`);
      return json({ updated: true });
    }

    if (action === "updateState") {
      if (!historyId || typeof body.stateUrl !== "string") return json({ error: "A History item ID and state URL are required." }, { status: 400 });
      const stateUrl = body.stateUrl.trim();
      if (stateUrl && !/^https?:\/\//i.test(stateUrl)) return json({ error: "The History state URL must use HTTP or HTTPS." }, { status: 400 });
      await writePersonal(`DELETE { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ?old } } INSERT { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ${sparqlString(stateUrl)} } } WHERE { OPTIONAL { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ?old } } FILTER(!BOUND(?old) || STR(?old) != ${sparqlString(stateUrl)}) }`);
      return json({ updated: true, historyId });
    }

    if (action === "deleteRecord") {
      if (!historyId) return json({ error: "A record URI is required." }, { status: 400 });
      // Unbookmark this record without deleting its history or descriptive data:
      // remove only the Bookmark class assertion and the bookmark hash identifier.
      await writePersonal(`DELETE { GRAPH ${bookmarkGraph} { ?linkedSubject ?predicate ?object } } WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} (<${BOOKMARK_NS}recalls>|<${DCTERMS_NS}references>|<${VFCT_NS}savedQuery>|<${VFCT_NS}child>|<${VFCT_NS}attribute>)* ?linkedSubject . ?linkedSubject ?predicate ?object } }`);
      return json({ deleted: true, unbookmarked: true, historyId });
    }

    if (action === "read") {
      if (!historyId) return json({ error: "A bookmark or History ID is required." }, { status: 400 });
      // The dialog edits a History visit. Read its original metadata first, then
      // overlay values already saved in the Bookmarks graph, if present.
      const metadataPredicates = [
        `${RDF_NS}type`, `${DCTERMS_NS}title`, `${RDFS_NS}label`,
        `${DCTERMS_NS}description`, `${SKOS_NS}prefLabel`,
        `${DCTERMS_NS}subject`, `${SCOT_NS}has_tag`,
        `${historyState}`, `${SCHEMA_NS}url`,
      ];
      const query = `SELECT ?source ?predicate ?value WHERE {
        VALUES ?source { ${graph} ${bookmarkGraph} }
        GRAPH ?source { ${iri(historyId)} ?predicate ?value }
        FILTER(?predicate IN (${metadataPredicates.map(iri).join(", ")}))
      }`;
      const result = await queryPersonal(query);
      const bindings = result.results?.bindings ?? [];
      const valuesFor = (source: string, predicate: string) => bindings
        .filter((row) => row.source?.value === source && row.predicate?.value === predicate)
        .map((row) => row.value?.value ?? "").filter(Boolean);
      const historyGraphIri = `${baseGraph}#history`;
      const bookmarkGraphIri = `${baseGraph}#bookmarks`;
      // Once bookmarked, the bookmark graph is authoritative: an absent
      // description or tag means the user cleared it, not "inherit History".
      const savedBookmark = valuesFor(bookmarkGraphIri, `${RDF_NS}type`).includes(`${BOOKMARK_NS}Bookmark`);
      const first = (predicate: string) => savedBookmark
        ? (valuesFor(bookmarkGraphIri, predicate)[0] ?? "")
        : (valuesFor(historyGraphIri, predicate)[0] ?? "");
      const tagPredicates: { predicate: string; vocabulary: "skos" | "dcterms" | "scot" }[] = [
        { predicate: `${SKOS_NS}prefLabel`, vocabulary: "skos" },
        { predicate: `${DCTERMS_NS}subject`, vocabulary: "dcterms" },
        { predicate: `${SCOT_NS}has_tag`, vocabulary: "scot" },
      ];
      const authoritativeGraph = savedBookmark ? bookmarkGraphIri : historyGraphIri;
      const selectedTags = tagPredicates.find(({ predicate }) => valuesFor(authoritativeGraph, predicate).length > 0);
      const tags = selectedTags ? [...new Set(valuesFor(authoritativeGraph, selectedTags.predicate))] : [];
      return json({
        found: bindings.length > 0,
        historyId,
        title: first(`${DCTERMS_NS}title`) || first(`${RDFS_NS}label`),
        description: first(`${DCTERMS_NS}description`),
        tags,
        tagVocabulary: selectedTags?.vocabulary ?? "skos",
        stateUrl: first(`${historyState}`) || first(`${SCHEMA_NS}url`),
      });
    }

    // Portable RDF-term archive. Import always targets this user's personal
    // Bookmarks graph; the archive cannot select or override the destination.
    if (action === "exportBookmarks") {
      const query = `SELECT ?s ?p ?o WHERE { GRAPH ${bookmarkGraph} { ?s ?p ?o } } LIMIT 20001`;
      const result = await queryPersonal(query);
      const triples = result.results?.bindings ?? [];
      // Limit output so an upstream truncation cannot silently create an archive
      // mistaken for a complete backup. Fail explicitly when this bound is hit.
      if (triples.length > 20000) return json({ error: "Bookmarks graph exceeds the 20,000-triple export safety limit." }, { status: 413 });
      for (const row of triples) {
        if (!row.s || !row.p || !row.o) return json({ error: "The graph server returned an incomplete bookmark triple." }, { status: 502 });
      }
      return json({ format: "maestro-bookmarks-rdf-json", version: 1, triples: triples.map(({s,p,o}) => ({ s,p,o })) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "importBookmarks") {
      const archive = (body as {archive?: unknown}).archive;
      if (!archive || typeof archive !== "object" || Array.isArray(archive)) return json({ error: "Select a valid Maestro Bookmarks JSON export." }, { status: 400 });
      const content = archive as { format?: unknown; version?: unknown; triples?: unknown };
      if (content.format !== "maestro-bookmarks-rdf-json" || content.version !== 1 || !Array.isArray(content.triples))
        return json({ error: "Unsupported Bookmarks archive format or version." }, { status: 400 });
      if (content.triples.length > 20000) return json({ error: "The import exceeds the 20,000-triple safety limit." }, { status: 413 });
      type Term = { type: "uri" | "literal" | "typed-literal" | "bnode"; value: string; datatype?: string; "xml:lang"?: string };
      const isTerm = (value: unknown): value is Term => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const term = value as Partial<Term>;
        return (term.type === "uri" || term.type === "literal" || term.type === "typed-literal" || term.type === "bnode") &&
          typeof term.value === "string" && term.value.length <= 100000 &&
          (term.datatype === undefined || typeof term.datatype === "string") &&
          (term["xml:lang"] === undefined || typeof term["xml:lang"] === "string");
      };
      const bnodeNames = new Map<string,string>();
      const termText = (term: Term, position: "s" | "p" | "o") => {
        if (term.type === "uri") return iri(term.value);
        if (term.type === "bnode") {
          if (position === "p") throw new Error("RDF predicates cannot be blank nodes.");
          if (!bnodeNames.has(term.value)) bnodeNames.set(term.value, `maestroImport${bnodeNames.size}`);
          return `_:${bnodeNames.get(term.value)}`;
        }
        if (position !== "o") throw new Error("Only RDF objects may be literals.");
        const literal = sparqlString(term.value);
        if (term["xml:lang"]) {
          if (!/^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(term["xml:lang"])) throw new Error("Invalid language tag in Bookmarks archive.");
          return `${literal}@${term["xml:lang"]}`;
        }
        return term.datatype ? `${literal}^^${iri(term.datatype)}` : literal;
      };
      let statements: string[];
      try {
        statements = content.triples.map((unknownTriple) => {
          if (!unknownTriple || typeof unknownTriple !== "object" || Array.isArray(unknownTriple)) throw new Error("Invalid RDF triple in Bookmarks archive.");
          const triple = unknownTriple as {s?: unknown;p?: unknown;o?: unknown};
          if (!isTerm(triple.s) || !isTerm(triple.p) || !isTerm(triple.o)) throw new Error("Invalid RDF term in Bookmarks archive.");
          if (triple.s.type !== "uri" && triple.s.type !== "bnode") throw new Error("RDF subject must be an IRI or blank node.");
          if (triple.p.type !== "uri") throw new Error("RDF predicate must be an IRI.");
          return `${termText(triple.s, "s")} ${termText(triple.p, "p")} ${termText(triple.o, "o")} .`;
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid RDF archive." }, { status: 400 });
      }
      // One INSERT DATA operation preserves blank-node identity between triples.
      // The operation merges bookmarks; it never clears other personal graph data.
      if (statements.length) await writePersonal(`INSERT DATA { GRAPH ${bookmarkGraph} { ${statements.join("\n")} } }`);
      return json({ imported: statements.length });
    }

    if (action === "deleteBookmarks") {
      // Bookmark data and all linked instance data live in their dedicated named graph.
      // CLEAR removes the entire graph, including query resources and serialized FCT-tree nodes.
      await writePersonal(`CLEAR GRAPH ${bookmarkGraph}`);
      return json({ deleted: true });
    }

    if (action === "deleteHistory") {
      // History visits and their linked instance data live in their own named graph.
      await writePersonal(`CLEAR GRAPH ${graph}`);
      return json({ deleted: true });
    }

    if (action === "deleteCurrentHistory") {
      if (!historyId) return json({ error: "A current History item ID is required." }, { status: 400 });
      const isHistoryVisit = await askPersonal(`PREFIX rdf: <${RDF_NS}> ASK WHERE { GRAPH ${graph} { ${iri(historyId)} rdf:type <${historyType}> } }`);
      if (!isHistoryVisit) return json({ error: "The current item is not a query History visit; it was not deleted." }, { status: 409 });
      const nextQuery = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?visit ?created ?queryXML ?stateUrl WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created ; vfct:historyQueryXML ?queryXML . OPTIONAL { ?visit vfct:historyStateUrl ?stateUrl } FILTER(?created < ?cursorCreated) } } ORDER BY DESC(?created) LIMIT 1`;
      const nextResult = await queryPersonal(nextQuery);
      const next = nextResult.results?.bindings?.[0];
      // Delete the visit and only its linked query projection, not other visits.
      await writePersonal(`DELETE { GRAPH ${graph} { ?node ?predicate ?object } } WHERE {
        GRAPH ${graph} { ${iri(historyId)} (<${BOOKMARK_NS}recalls>|<${BOOKMARK_NS}recalls>/(<${VFCT}child>|<${VFCT}attribute>)*)? ?node .
          ?node ?predicate ?object . } }`);
      return json({ deleted: true, nextHistoryId: next?.visit?.value, queryXml: next?.queryXML?.value, stateUrl: next?.stateUrl?.value ?? "" });
    }

    if (action === "update") {
      if (!historyId) return json({ error: "A bookmark ID is required." }, { status: 400 });
      const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
      if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
        return json({ error: "A serialized FCT <query> document is required to save the bookmark." }, { status: 400 });
      }
      const queryHash = await sha256(canonicalQueryIdentityXml(queryXml));
      const querySparql = compileFctXmlToSparql(queryXml).query;
      // This timestamp marks when the History item was saved as a Bookmark.
      const bookmarkCreated = new Date().toISOString();
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 500) : "";
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
      const tags = Array.isArray(body.tags)
        ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.slice(0, 200)))].slice(0, 50)
        : [];
      const tagVocabulary = body.tagVocabulary === "dcterms" || body.tagVocabulary === "scot" ? body.tagVocabulary : "skos";
      const stateUrl = typeof body.stateUrl === "string" ? body.stateUrl.trim() : "";
      let shareUrl = "";
      if (stateUrl) {
        const sourceUrl = new URL(stateUrl);
        if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
          return json({ error: "The bookmark state URL must use HTTP or HTTPS." }, { status: 400 });
        }
        // A bookmark's schema:url is the share link for the original FCT query,
        // never a query for the bookmark resource in the personal store.
        sourceUrl.searchParams.set("q", queryXml);
        sourceUrl.searchParams.delete("history");
        // Preserve the shareable UI state (appbar tab, ribbon, and View panel).
        // Only the History cursor is specific to the saving session.
        shareUrl = sourceUrl.toString();
      }

      const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, processEntities: true });
      // The XML declaration belongs to the serialized document, not to the FCT query tree.
      const queryXmlForTree = queryXml.replace(/^\s*<\?xml\b[\s\S]*?\?>\s*/i, "");
      const parsed = parser.parse(queryXmlForTree) as Record<string, unknown>[];
      const queryResource = mintedId("query");
      const triples: string[] = [
        `${iri(historyId)} <${BOOKMARK_NS}recalls> ${iri(queryResource)}`,
        `${iri(queryResource)} <${RDF_NS}value> ${sparqlString(queryXml)}`,
        ...(shareUrl ? [`${iri(queryResource)} <${SCHEMA_NS}url> ${iri(shareUrl)}`] : []),
      ];
      // schema:url on the bookmark is already replaced by the metadata DELETE/INSERT above.
      for (const tag of tags) {
        if (tagVocabulary === "dcterms") {
          triples.push(`${iri(historyId)} <${DCTERMS_NS}subject> ${sparqlString(tag)}`);
        } else if (tagVocabulary === "scot") {
          // Keep user-entered tags as literals directly on the bookmark; no minted tag resource.
          triples.push(`${iri(historyId)} <${SCOT_NS}has_tag> ${sparqlString(tag)}`);
        } else {
          // SKOS vocabulary choice stores the tag label directly as a literal.
          triples.push(`${iri(historyId)} <${SKOS_NS}prefLabel> ${sparqlString(tag)}`);
        }
      }
      let nodeCounter = 0;
      const walk = (entries: Record<string, unknown>[], parent?: string) => {
        for (const entry of entries) {
          const name = Object.keys(entry).find((key) => key !== ":@" && key !== "#text");
          if (!name) continue;
          const node = parent ? mintedId(`query-element-${++nodeCounter}`) : queryResource;
          const content = entry[name];
          const children = Array.isArray(content) ? content as Record<string, unknown>[] : [];
          const attrs = entry[":@"] && typeof entry[":@"] === "object" ? entry[":@"] as Record<string, unknown> : {};
          triples.push(`${iri(node)} <${RDF_NS}type> ${iri(`${VFCT_NS}${name}`)}`);
          triples.push(`${iri(node)} <${RDFS_NS}label> ${sparqlString(name)}`);
          if (parent) triples.push(`${iri(parent)} <${VFCT_NS}child> ${iri(node)}`);
          for (const [rawName, rawValue] of Object.entries(attrs)) {
            const attributeName = rawName.replace(/^@_/, "");
            // Namespace declarations are XML serialization metadata, not FCT query attributes.
            if (attributeName === "xmlns" || attributeName.startsWith("xmlns:")) continue;
            const value = String(rawValue ?? "");
            const attributeNode = mintedId("query-attribute");
            triples.push(`${iri(node)} <${VFCT_NS}attribute> ${iri(attributeNode)}`);
            triples.push(`${iri(attributeNode)} <${RDF_NS}type> <${VFCT_NS}XMLAttribute>`);
            triples.push(`${iri(attributeNode)} <${RDFS_NS}label> ${sparqlString(`${attributeName}: ${value}`)}`);
            triples.push(`${iri(attributeNode)} <${RDF_NS}value> ${sparqlString(value)}`);
          }
          const textValues = children.filter((child) => Object.prototype.hasOwnProperty.call(child, "#text")).map((child) => String(child["#text"] ?? ""));
          if (textValues.length && node !== queryResource) {
            const text = textValues.join("");
            if (text.trim()) {
              triples.push(`${iri(node)} <${RDF_NS}value> ${sparqlString(text)}`);
              triples.push(`${iri(node)} <${RDFS_NS}label> ${sparqlString(text.trim())}`);
            }
          }
          walk(children.filter((child) => !Object.prototype.hasOwnProperty.call(child, "#text")), node);
        }
      };
      walk(parsed);

      const lastResultCount = metricValue(body.lastResultCount);
      const lastNewCount = metricValue(body.lastNewCount);
      // Replace every editable dialog field, including tags in all three vocabularies.
      // DELETE and INSERT are one SPARQL Update operation; OPTIONAL guarantees
      // insertion still runs when there is no prior bookmark metadata.
      const replacedPredicates = [
        `${DCTERMS_NS}title`, `${RDFS_NS}label`, `${DCTERMS_NS}description`,
        `${SCHEMA_NS}url`, `${SCHEMA_NS}identifier`, historyQuery,
        `${MAESTRO_UI_NS}querySparql`, `${DCTERMS_NS}created`,
        ...(lastResultCount !== null ? [`${MAESTRO_UI_NS}lastResultCount`] : []),
        ...(lastNewCount !== null ? [`${MAESTRO_UI_NS}lastNewCount`] : []),
        `${DCTERMS_NS}subject`, `${SCOT_NS}has_tag`, `${SKOS_NS}prefLabel`,
      ];
      const metadataTriples = [
        `${iri(historyId)} <${RDF_NS}type> <${BOOKMARK_NS}Bookmark>`,
        `${iri(historyId)} <${DCTERMS_NS}title> ${sparqlString(title || historyId)}`,
        `${iri(historyId)} <${RDFS_NS}label> ${sparqlString(title || historyId)}`,
        `${iri(historyId)} <${DCTERMS_NS}created> ${sparqlString(bookmarkCreated)}^^<${XSD_NS}dateTime>`,
        `${iri(historyId)} <${SCHEMA_NS}identifier> ${sparqlString(queryHash)}`,
        `${iri(historyId)} <${historyQuery}> ${sparqlString(queryXml)}`,
        `${iri(historyId)} <${MAESTRO_UI_NS}querySparql> ${sparqlString(querySparql)}`,
        ...(lastResultCount !== null ? [`${iri(historyId)} <${MAESTRO_UI_NS}lastResultCount> ${lastResultCount}`] : []),
        ...(lastNewCount !== null ? [`${iri(historyId)} <${MAESTRO_UI_NS}lastNewCount> ${lastNewCount}`] : []),
        ...(description ? [`${iri(historyId)} <${DCTERMS_NS}description> ${sparqlString(description)}`] : []),
        ...(shareUrl ? [`${iri(historyId)} <${SCHEMA_NS}url> ${iri(shareUrl)}`] : []),
        ...triples.filter((triple) =>
          triple.startsWith(`${iri(historyId)} <${DCTERMS_NS}subject>`) ||
          triple.startsWith(`${iri(historyId)} <${SCOT_NS}has_tag>`) ||
          triple.startsWith(`${iri(historyId)} <${SKOS_NS}prefLabel>`)),
      ];
      await writePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(historyId)} ?oldPredicate ?oldValue } }
        INSERT { GRAPH ${bookmarkGraph} { ${metadataTriples.join(" .\n")} . } }
        WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} ?oldPredicate ?oldValue .
          FILTER(?oldPredicate IN (${replacedPredicates.map(iri).join(", ")})) } } }`);

      // Replace the bookmark's query-resource link with a DELETE/INSERT update,
      // rather than accumulating duplicate recalls links on repeated edits.
      await writePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${BOOKMARK_NS}recalls> ?oldQueryResource . ?oldQueryResource ?oldLinkedPredicate ?oldLinkedObject } } INSERT { GRAPH ${bookmarkGraph} { ${triples.map((triple) => `${triple} .`).join("\n")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${BOOKMARK_NS}recalls> ?oldQueryResource . OPTIONAL { GRAPH ${bookmarkGraph} { ?oldQueryResource ?oldLinkedPredicate ?oldLinkedObject } } } } }`);
      return json({ saved: true, historyId, shareUrl });
    }

    const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
      return json({ error: "A serialized FCT <query> document is required." }, { status: 400 });
    }
    const queryHash = await sha256(canonicalQueryIdentityXml(queryXml));
    if (action === "visit") {
      const stateUrl = typeof body.stateUrl === "string" ? body.stateUrl.trim() : "";
      if (stateUrl && !/^https?:\/\//i.test(stateUrl)) return json({ error: "The History state URL must use HTTP or HTTPS." }, { status: 400 });
      const id = `${historyNs}${crypto.randomUUID()}`;
      const created = new Date().toISOString();
      const actionValue = body.historyAction && typeof body.historyAction === "object" ? JSON.stringify(body.historyAction) : "";
      const triples = [
        // Every navigation creates a History item. It becomes a Bookmark only
        // when the user explicitly bookmarks it.
        `${iri(id)} <${RDF_NS}type> ${iri(historyType)}`,
        `${iri(id)} <${DCTERMS_NS}title> ${sparqlString(`Query ${created}`)}`,
        `${iri(id)} <${RDFS_NS}label> ${sparqlString(`Query ${created}`)}`,
        `${iri(id)} <${historyCreated}> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
        `${iri(id)} <${historyQuery}> ${sparqlString(queryXml)}`,
      ];
      if (stateUrl) triples.push(`${iri(id)} <${historyState}> ${sparqlString(stateUrl)}`);
      if (actionValue) triples.push(`${iri(id)} <${historyAction}> ${sparqlString(actionValue)}`);
      // Project the actual query RDF before publishing the History visit.
      // SHACL selectors are scoped to the visit IRI, never all saved queries.
      const projection = historyQueryRdf(id, queryXml);
      await writePersonal(`INSERT DATA { GRAPH ${graph} { ${triples.map(triple=>`${triple} .`).join("\n")}\n${projection.statements.join("\n")} } }`);
      return json({ historyId: id, queryRoot: projection.root });
    }
    if (action === "check") {
      // App-bar bookmark state is determined solely by the current live query hash.
      // Do not infer it from History, Record state, or XML similarity.
      const ask = `PREFIX schema: <${SCHEMA_NS}> ASK WHERE { GRAPH ${bookmarkGraph} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } }`;
      const bookmarked = await askPersonal(ask);
      if (!bookmarked) return json({ bookmarked: false, hash: queryHash, historyId: null });
      // Recover the matching resource for the existing Remove Bookmark action.
      const lookup = await queryPersonal(`PREFIX schema: <${SCHEMA_NS}> SELECT ?bookmark WHERE { GRAPH ${bookmarkGraph} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } } LIMIT 1`);
      const bookmarkId = lookup.results?.bindings?.[0]?.bookmark?.value ?? null;
      return json({ bookmarked: true, hash: queryHash, historyId: bookmarkId });
    }
    if (action === "unbookmark") {
      const ask = `PREFIX schema: <${SCHEMA_NS}> ASK WHERE { GRAPH ${bookmarkGraph} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } }`;
      const bookmarked = await askPersonal(ask);
      if (!bookmarked) return json({ removed: false, error: "No bookmark hash matches this query." }, { status: 404 });
      await writePersonal(`DELETE { GRAPH ${bookmarkGraph} { ?linkedSubject ?predicate ?object } } WHERE { GRAPH ${bookmarkGraph} { ?bookmark <${SCHEMA_NS}identifier> ${sparqlString(queryHash)} . ?bookmark (<${BOOKMARK_NS}recalls>|<${DCTERMS_NS}references>|<${VFCT_NS}savedQuery>|<${VFCT_NS}child>|<${VFCT_NS}attribute>)* ?linkedSubject . ?linkedSubject ?predicate ?object } }`);
      return json({ removed: true, hash: queryHash });
    }

    const querySparql = compileFctXmlToSparql(queryXml).query;
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `Saved query ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
    const tags = Array.isArray(body.tags)
      ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.slice(0, 200)))].slice(0, 50)
      : [];
    const tagVocabulary = body.tagVocabulary === "dcterms" || body.tagVocabulary === "scot" ? body.tagVocabulary : "skos";
    const shareLink = typeof body.shareLink === "string" ? body.shareLink.trim() : "";
    let shareLinkIri = "";
    if (shareLink) {
      const parsedShareLink = new URL(shareLink);
      if (parsedShareLink.protocol !== "http:" && parsedShareLink.protocol !== "https:") {
        throw new Error("The query share link must use HTTP or HTTPS.");
      }
      shareLinkIri = parsedShareLink.toString();
    }

    // UUIDs remain the bookmark local names in the dedicated namespace.
    const bookmark = `${MAESTRO_IDS_NS}query-bookmark#${crypto.randomUUID()}`;
    const queryResource = mintedId("query");
    const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, processEntities: true });
    const parsed = parser.parse(queryXml) as Record<string, unknown>[];
    const created = new Date().toISOString();
    const savedQueriesTopic = `${MAESTRO_IDS_NS}query-bookmark-topic#saved-queries`;
    const triples: string[] = [
      `${iri(bookmark)} <${RDF_NS}type> <${BOOKMARK_NS}Bookmark>`,
      `${iri(bookmark)} <${RDF_NS}type> <${SIOC_NS}Item>`,
      `${iri(bookmark)} <${DCTERMS_NS}title> ${sparqlString(title)}`,
      `${iri(bookmark)} <${RDFS_NS}label> ${sparqlString(title)}`,
      `${iri(bookmark)} <${SCHEMA_NS}identifier> ${sparqlString(queryHash)}`,
      `${iri(bookmark)} <${MAESTRO_UI_NS}querySparql> ${sparqlString(querySparql)}`,
      `${iri(bookmark)} <${ANNOTATION_NS}created> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
      `${iri(bookmark)} <${DCTERMS_NS}created> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
      `${iri(bookmark)} <${DCTERMS_NS}date> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
      `${iri(bookmark)} <${BOOKMARK_NS}recalls> ${iri(queryResource)}`,
      `${iri(bookmark)} <${BOOKMARK_NS}hasTopic> ${iri(savedQueriesTopic)}`,
      `${iri(queryResource)} <${RDF_NS}value> ${sparqlString(queryXml)}^^<${RDF_NS}XMLLiteral>`,
    ];
    if (description) triples.push(`${iri(bookmark)} <${DCTERMS_NS}description> ${sparqlString(description)}`);
    if (shareLinkIri) {
      // Keep the link on the bookmark (what the list reads) and on the saved query resource.
      triples.push(`${iri(bookmark)} <${SCHEMA_NS}url> ${iri(shareLinkIri)}`);
      triples.push(`${iri(queryResource)} <${SCHEMA_NS}url> ${iri(shareLinkIri)}`);
    }

    for (const tag of tags) {
      if (tagVocabulary === "dcterms") {
        // Literal subjects are useful for informal user-defined tags.
        triples.push(`${iri(bookmark)} <${DCTERMS_NS}subject> ${sparqlString(tag)}`);
      } else if (tagVocabulary === "scot") {
        // Store the user-entered tag as a literal directly on the bookmark.
        triples.push(`${iri(bookmark)} <${SCOT_NS}has_tag> ${sparqlString(tag)}`);
      } else {
        // Store the SKOS tag label directly as a literal; do not mint a concept URI.
        triples.push(`${iri(bookmark)} <${SKOS_NS}prefLabel> ${sparqlString(tag)}`);
      }
    }

    let nodeCounter = 0;
    const walk = (entries: Record<string, unknown>[], parent?: string) => {
      for (const entry of entries) {
        const name = Object.keys(entry).find((key) => key !== ":@" && key !== "#text");
        if (!name) continue;
        const node = parent ? mintedId(`query-element-${++nodeCounter}`) : queryResource;
        const content = entry[name];
        const children = Array.isArray(content) ? content as Record<string, unknown>[] : [];
        const attrs = entry[":@"] && typeof entry[":@"] === "object" ? entry[":@"] as Record<string, unknown> : {};
        triples.push(`${iri(node)} <${RDF_NS}type> ${iri(`${VFCT_NS}${name}`)}`);
        triples.push(`${iri(node)} <${RDFS_NS}label> ${sparqlString(name)}`);
        if (parent) triples.push(`${iri(parent)} <${VFCT_NS}child> ${iri(node)}`);
        for (const [rawName, rawValue] of Object.entries(attrs)) {
          const attributeName = rawName.replace(/^@_/, "");
          const value = String(rawValue ?? "");
          const attributeNode = mintedId("query-attribute");
          triples.push(`${iri(node)} <${VFCT_NS}attribute> ${iri(attributeNode)}`);
          triples.push(`${iri(attributeNode)} <${RDF_NS}type> <${VFCT_NS}XMLAttribute>`);
          triples.push(`${iri(attributeNode)} <${RDFS_NS}label> ${sparqlString(`${attributeName}: ${value}`)}`);
          triples.push(`${iri(attributeNode)} <${RDF_NS}value> ${sparqlString(value)}`);
        }
        const textValues = children.filter((child) => Object.prototype.hasOwnProperty.call(child, "#text")).map((child) => String(child["#text"] ?? ""));
        if (textValues.length && node !== queryResource) {
          const text = textValues.join("");
          if (text.trim()) {
            triples.push(`${iri(node)} <${RDF_NS}value> ${sparqlString(text)}`);
            triples.push(`${iri(node)} <${RDFS_NS}label> ${sparqlString(text.trim())}`);
          }
        }
        walk(children.filter((child) => !Object.prototype.hasOwnProperty.call(child, "#text")), node);
      }
    };
    walk(parsed);
    await writePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> ?oldTopicType } } INSERT { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> <${BOOKMARK_NS}Topic> ; <${DCTERMS_NS}title> ${sparqlString("Saved queries")} ; <${RDFS_NS}label> ${sparqlString("Saved queries")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> ?oldTopicType } } FILTER(!BOUND(?oldTopicType)) }`);
    const update = `DELETE { GRAPH ${bookmarkGraph} { ${iri(bookmark)} <${SCHEMA_NS}identifier> ?oldHash } } INSERT { GRAPH ${bookmarkGraph} { ${triples.map((triple) => `${triple} .`).join("\n")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(bookmark)} <${SCHEMA_NS}identifier> ?oldHash } } }`;
    await writePersonal(update);
    return json({ saved: true, bookmark, title, hash: queryHash });
  } catch (error) {
    return json({ error: (error instanceof Error ? error.message : "Could not save query favorite.") }, { status: 502 });
  }
}

/** Read Annotea bookmarks and older favorites written by previous Maestro versions. */
async function getFavorites(request: Request, ctx: PersonalContext) {
  try {
    const baseGraph = ctx.base;
    const query = `PREFIX rdf: <${RDF_NS}> PREFIX rdfs: <${RDFS_NS}> PREFIX dcterms: <${DCTERMS_NS}> PREFIX a: <${ANNOTATION_NS}> PREFIX b: <${BOOKMARK_NS}> PREFIX vfct: <${VFCT_NS}> PREFIX sioc: <${SIOC_NS}> PREFIX schema: <${SCHEMA_NS}> SELECT DISTINCT ?bookmark ?title ?description ?created ?queryXML ?shareUrl WHERE { GRAPH <${baseGraph}#bookmarks> { { ?bookmark rdf:type b:Bookmark } UNION { ?bookmark rdf:type sioc:Item } UNION { ?bookmark rdf:type vfct:QueryBookmark } OPTIONAL { ?bookmark dcterms:title ?dcTitle } OPTIONAL { ?bookmark rdfs:label ?standardTitle } OPTIONAL { ?bookmark vfct:label ?legacyTitle } BIND(COALESCE(?dcTitle, ?standardTitle, ?legacyTitle, STR(?bookmark)) AS ?title) OPTIONAL { ?bookmark dcterms:description ?description } OPTIONAL { ?bookmark a:created ?annoteaCreated } OPTIONAL { ?bookmark dcterms:created ?dctermsCreated } OPTIONAL { ?bookmark dcterms:date ?dctermsDate } OPTIONAL { ?bookmark vfct:created ?legacyCreated } BIND(COALESCE(?annoteaCreated, ?dctermsCreated, ?dctermsDate, ?legacyCreated) AS ?created) OPTIONAL { ?bookmark schema:url ?bookmarkUrl } { ?bookmark b:recalls ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark dcterms:references ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark vfct:savedQuery ?legacyQuery . ?legacyQuery vfct:queryXML ?queryXML . } BIND(COALESCE(?bookmarkUrl, ?queryUrl) AS ?shareUrl) } } ORDER BY DESC(?created) ?title`;
    const result = selectResult(await selectPersonal(query, ctx, request.signal,request.headers.get("x-maestro-debug-source") || "HistoryBookmarks:List"));
    const favorites = (result.results?.bindings ?? []).map((row: Record<string, { value?: string }>) => ({
      uri: row.bookmark?.value ?? "",
      title: row.title?.value ?? row.bookmark?.value ?? "Saved query",
      description: row.description?.value ?? "",
      created: row.created?.value ?? "",
      queryXml: row.queryXML?.value ?? "",
      // Only http(s) links are returned, so the page can never render a script URL.
      shareUrl: /^https?:\/\//i.test(row.shareUrl?.value ?? "") ? row.shareUrl!.value : "",
    })).filter((item: { uri: string; queryXml: string }) => item.uri && item.queryXml)
      // A bookmark that was saved more than once with different links would repeat; keep the first.
      .filter((item: { uri: string; queryXml: string }, index: number, all: Array<{ uri: string; queryXml: string }>) => all.findIndex((other: { uri: string; queryXml: string }) => other.uri === item.uri && other.queryXml === item.queryXml) === index);
    return json({ favorites });
  } catch (error) {
    return json({ error: (error instanceof Error ? error.message : "Could not load query favorites.") }, { status: 503 });
  }
}

/** Drop-in Response-compatible client action so existing callers retain their
 * status checks, error handling and cancellation semantics. */
export async function clientQueryFavorites(init: RequestInit = {}): Promise<Response> {
  try {
    const ctx = await personalContext();
    const request = new Request("https://maestro.invalid/client-query-favorites", {
      method: init.method ?? "POST",
      headers: init.headers,
      body: init.method?.toUpperCase() === "GET" ? undefined : init.body,
      signal: init.signal,
    });
    return request.method === "GET" ? await getFavorites(request, ctx) : await postFavorites(request, ctx);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return json({error:error instanceof Error ? error.message : "Personal History/Bookmarks operation failed."}, {status:502});
  }
}
