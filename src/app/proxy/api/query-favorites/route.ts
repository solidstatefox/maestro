import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { MAESTRO_IDS_NS, getHistoryGraph, VFCT_NS, askPersonalSparql, queryPersonalSparql, updatePersonalSparql, getConfiguredFctEndpoints, personalSparqlUrl } from "@/lib/personal-sparql";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";

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
export async function POST(request: Request) {
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
    };
    const action = typeof body.action === "string" ? body.action : "";
    const historyId = typeof body.historyId === "string" ? body.historyId.trim() : "";
    const baseGraph = getHistoryGraph(request).split("#", 1)[0];
    const graph = iri(`${baseGraph}#history`);
    const bookmarkGraph = iri(`${baseGraph}#bookmarks`);
    const historyNs = `${MAESTRO_IDS_NS}history#`;
    const historyQuery = `${VFCT_NS}historyQueryXML`;
    const historyState = `${VFCT_NS}historyStateUrl`;
    const historyCreated = `${VFCT_NS}historyCreated`;
    const historyAction = `${VFCT_NS}historyAction`;
    const historyType = `${VFCT_NS}QueryHistoryVisit`;

    const queryPersonal = (q: string) => queryPersonalSparql(q, 20000, request);
    const updatePersonal = (u: string) => updatePersonalSparql(u, 30000, request);
    const askPersonal = (q: string) => askPersonalSparql(q, 20000, request);

    // History requests have their own validation; only actions that actually
    // carry a query require serialized FCT XML.
    if (action === "getHistoryItem") {
      if (!historyId) return NextResponse.json({ error: "A History item ID is required." }, { status: 400 });
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?queryXML ?stateUrl ?action WHERE { GRAPH ${graph} { ${iri(historyId)} rdf:type vfct:QueryHistoryVisit ; vfct:historyQueryXML ?queryXML . OPTIONAL { ${iri(historyId)} vfct:historyStateUrl ?stateUrl } OPTIONAL { ${iri(historyId)} vfct:historyAction ?action } } } LIMIT 1`;
      const result = await queryPersonal(query);
      const row = result.results?.bindings?.[0];
      if (!row) return NextResponse.json({ error: "The History item was not found." }, { status: 404 });
      let parsedAction: unknown = null;
      try { parsedAction = row.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
      return NextResponse.json({ found: true, historyId, queryXml: row.queryXML?.value ?? "", stateUrl: row.stateUrl?.value ?? "", action: parsedAction });
    }

    if (action === "recentActions") {
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?visit ?created ?action WHERE { GRAPH ${graph} { ?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created . OPTIONAL { ?visit vfct:historyAction ?action } } } ORDER BY DESC(?created) LIMIT 10`;
      const result = await queryPersonal(query);
      const items = (result.results?.bindings ?? []).map((row: any) => {
        let parsedAction: unknown = null;
        try { parsedAction = row.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
        return { historyId: row.visit?.value ?? "", created: row.created?.value ?? "", action: parsedAction };
      });
      return NextResponse.json({ items });
    }

    if (action === "availability" || action === "navigate") {
      if (!historyId) return NextResponse.json({ error: "A History item ID is required." }, { status: 400 });
      if (action === "availability") {
        const direction = body.direction === "forward" ? "forward" : "backward";
        const comparison = direction === "backward" ? "<" : ">";
        const order = direction === "backward" ? "DESC" : "ASC";
        const query = `PREFIX vfct: <${VFCT_NS}> SELECT ?created WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit vfct:historyCreated ?created . FILTER(?created ${comparison} ?cursorCreated) } } ORDER BY ${order}(?created) LIMIT 1`;
        const result = await queryPersonal(query);
        return NextResponse.json(direction === "backward" ? { older: Boolean(result.results?.bindings?.length) } : { newer: Boolean(result.results?.bindings?.length) });
      }
      const direction = body.direction === "forward" ? "forward" : "backward";
      const comparison = direction === "backward" ? "<" : ">";
      const order = direction === "backward" ? "DESC" : "ASC";
      const query = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> PREFIX schema: <${SCHEMA_NS}> SELECT ?visit ?created ?stateUrl ?queryXML ?action WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created ; vfct:historyQueryXML ?queryXML . OPTIONAL { ?visit vfct:historyStateUrl ?stateUrl } OPTIONAL { ?visit vfct:historyAction ?action } FILTER(?created ${comparison} ?cursorCreated) } } ORDER BY ${order}(?created) LIMIT 1`;
      const result = await queryPersonal(query);
      const row = result.results?.bindings?.[0];
      let parsedAction: unknown = null;
      try { parsedAction = row?.action?.value ? JSON.parse(row.action.value) : null; } catch { parsedAction = null; }
      return NextResponse.json(row ? { found: true, historyId: row.visit?.value, queryXml: row.queryXML?.value, stateUrl: row.stateUrl?.value ?? "", action: parsedAction } : { found: false });
    }

    if (action === "updateState") {
      if (!historyId || typeof body.stateUrl !== "string") return NextResponse.json({ error: "A History item ID and state URL are required." }, { status: 400 });
      const stateUrl = body.stateUrl.trim();
      if (stateUrl && !/^https?:\/\//i.test(stateUrl)) return NextResponse.json({ error: "The History state URL must use HTTP or HTTPS." }, { status: 400 });
      await updatePersonal(`DELETE { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ?old } } INSERT { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ${sparqlString(stateUrl)} } } WHERE { OPTIONAL { GRAPH ${graph} { ${iri(historyId)} <${historyState}> ?old } } }`);
      return NextResponse.json({ updated: true, historyId });
    }

    if (action === "deleteRecord") {
      if (!historyId) return NextResponse.json({ error: "A record URI is required." }, { status: 400 });
      // Unbookmark this record without deleting its history or descriptive data:
      // remove only the Bookmark class assertion and the bookmark hash identifier.
      await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ?linkedSubject ?predicate ?object } } WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} (<${BOOKMARK_NS}recalls>|<${DCTERMS_NS}references>|<${VFCT_NS}savedQuery>|<${VFCT_NS}child>|<${VFCT_NS}attribute>)* ?linkedSubject . ?linkedSubject ?predicate ?object } }`);
      return NextResponse.json({ deleted: true, unbookmarked: true, historyId });
    }

    if (action === "read") {
      if (!historyId) return NextResponse.json({ error: "A bookmark ID is required." }, { status: 400 });
      const result = await queryPersonal(`PREFIX rdf: <${RDF_NS}> PREFIX dcterms: <${DCTERMS_NS}> PREFIX rdfs: <${RDFS_NS}> PREFIX schema: <${SCHEMA_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?type ?title ?description ?stateUrl ?shareUrl WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} rdf:type ?type . OPTIONAL { ${iri(historyId)} dcterms:title ?title } OPTIONAL { ${iri(historyId)} dcterms:description ?description } OPTIONAL { ${iri(historyId)} vfct:historyStateUrl ?stateUrl } OPTIONAL { ${iri(historyId)} schema:url ?shareUrl } } } LIMIT 1`);
      const row = result.results?.bindings?.[0];
      return NextResponse.json({ found: Boolean(row), historyId, title: row?.title?.value ?? "", description: row?.description?.value ?? "", stateUrl: row?.stateUrl?.value ?? row?.shareUrl?.value ?? "" });
    }

    if (action === "deleteBookmarks") {
      // Bookmark data and all linked instance data live in their dedicated named graph.
      // CLEAR removes the entire graph, including query resources and serialized FCT-tree nodes.
      await updatePersonal(`CLEAR GRAPH ${bookmarkGraph}`);
      return NextResponse.json({ deleted: true });
    }

    if (action === "deleteHistory") {
      // History visits and their linked instance data live in their own named graph.
      await updatePersonal(`CLEAR GRAPH ${graph}`);
      return NextResponse.json({ deleted: true });
    }

    if (action === "deleteCurrentHistory") {
      if (!historyId) return NextResponse.json({ error: "A current History item ID is required." }, { status: 400 });
      const isHistoryVisit = await askPersonal(`PREFIX rdf: <${RDF_NS}> ASK WHERE { GRAPH ${graph} { ${iri(historyId)} rdf:type <${historyType}> } }`);
      if (!isHistoryVisit) return NextResponse.json({ error: "The current item is not a query History visit; it was not deleted." }, { status: 409 });
      const nextQuery = `PREFIX rdf: <${RDF_NS}> PREFIX vfct: <${VFCT_NS}> SELECT ?visit ?created ?queryXML ?stateUrl WHERE { GRAPH ${graph} { ${iri(historyId)} vfct:historyCreated ?cursorCreated . ?visit rdf:type vfct:QueryHistoryVisit ; vfct:historyCreated ?created ; vfct:historyQueryXML ?queryXML . OPTIONAL { ?visit vfct:historyStateUrl ?stateUrl } FILTER(?created < ?cursorCreated) } } ORDER BY DESC(?created) LIMIT 1`;
      const nextResult = await queryPersonalSparql(nextQuery);
      const next = nextResult.results?.bindings?.[0];
      await updatePersonal(`DELETE { GRAPH ${graph} { ${iri(historyId)} ?predicate ?object } } WHERE { GRAPH ${graph} { ${iri(historyId)} ?predicate ?object } }`);
      return NextResponse.json({ deleted: true, nextHistoryId: next?.visit?.value, queryXml: next?.queryXML?.value, stateUrl: next?.stateUrl?.value ?? "" });
    }

    if (action === "update") {
      if (!historyId) return NextResponse.json({ error: "A bookmark ID is required." }, { status: 400 });
      const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
      if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
        return NextResponse.json({ error: "A serialized FCT <query> document is required to save the bookmark." }, { status: 400 });
      }
      const queryHash = `sha256:${createHash("sha256").update(queryXml, "utf8").digest("hex")}`;
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
          return NextResponse.json({ error: "The bookmark state URL must use HTTP or HTTPS." }, { status: 400 });
        }
        const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
        let personalServerId = "personal-sparql";
        try {
          const endpoints = await getConfiguredFctEndpoints(request);
          const endpointUrl = personalSparqlUrl(request);
          const normalizeEndpointUrl = (value: string) => {
            const u = new URL(value);
            u.hash = "";
            u.pathname = u.pathname.replace(/\/+$/u, "") || "/";
            return u.toString().replace(/\/$/u, "");
          };
          const match = endpoints.find((ep: { id: string; url: string }) => {
            try { return normalizeEndpointUrl(ep.url) === normalizeEndpointUrl(endpointUrl.toString()); } catch { return false; }
          }) ?? endpoints[0];
          if (match?.id) personalServerId = match.id;
        } catch {
          personalServerId = "personal-sparql";
        }
        const bookmarkGraphIri = `${baseGraph}#bookmarks`;
        const shareQueryXml = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" inference="" same-as="" timeout="20000" graph="${escapeXml(bookmarkGraphIri)}" addr="${escapeXml(`${bookmarkGraphIri}@${personalServerId}`)}"><value datatype="uri">${escapeXml(historyId)}</value><view type="text" limit="30" offset="0"/></query>`;
        sourceUrl.searchParams.set("q", shareQueryXml);
        sourceUrl.searchParams.delete("history");
        sourceUrl.searchParams.delete("state");
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

      await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${DCTERMS_NS}title> ?oldTitle ; <${RDFS_NS}label> ?oldLabel ; <${DCTERMS_NS}description> ?oldDescription ; <${SCHEMA_NS}url> ?oldUrl ; <${SCHEMA_NS}identifier> ?oldHash ; <${historyQuery}> ?oldQuery ; <${MAESTRO_UI_NS}querySparql> ?oldQuerySparql ; <${DCTERMS_NS}created> ?oldCreated ; <${DCTERMS_NS}subject> ?oldSubject ; <${SCOT_NS}has_tag> ?oldScotTag } } INSERT { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${RDF_NS}type> <${BOOKMARK_NS}Bookmark> ; <${DCTERMS_NS}title> ${sparqlString(title || historyId)} ; <${RDFS_NS}label> ${sparqlString(title || historyId)} ; <${DCTERMS_NS}created> ${sparqlString(bookmarkCreated)}^^<${XSD_NS}dateTime>${description ? ` ; <${DCTERMS_NS}description> ${sparqlString(description)}` : ""} ; <${SCHEMA_NS}identifier> ${sparqlString(queryHash)} ; <${historyQuery}> ${sparqlString(queryXml)} ; <${MAESTRO_UI_NS}querySparql> ${sparqlString(querySparql)}${shareUrl ? ` ; <${SCHEMA_NS}url> ${iri(shareUrl)}` : ""} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${DCTERMS_NS}title> ?oldTitle } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${RDFS_NS}label> ?oldLabel } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${DCTERMS_NS}description> ?oldDescription } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${SCHEMA_NS}url> ?oldUrl } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${SCHEMA_NS}identifier> ?oldHash } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${historyQuery}> ?oldQuery } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${MAESTRO_UI_NS}querySparql> ?oldQuerySparql } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${DCTERMS_NS}created> ?oldCreated } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${DCTERMS_NS}subject> ?oldSubject } } OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${SCOT_NS}has_tag> ?oldScotTag } } }`);
      // Replace the bookmark's query-resource link with a DELETE/INSERT update,
      // rather than accumulating duplicate recalls links on repeated edits.
      await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${BOOKMARK_NS}recalls> ?oldQueryResource . ?oldQueryResource ?oldLinkedPredicate ?oldLinkedObject } } INSERT { GRAPH ${bookmarkGraph} { ${triples.map((triple) => `${triple} .`).join("\n")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(historyId)} <${BOOKMARK_NS}recalls> ?oldQueryResource . OPTIONAL { ?oldQueryResource ?oldLinkedPredicate ?oldLinkedObject } } } }`);
      return NextResponse.json({ saved: true, historyId, shareUrl });
    }

    const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
      return NextResponse.json({ error: "A serialized FCT <query> document is required." }, { status: 400 });
    }
    const queryHash = `sha256:${createHash("sha256").update(queryXml, "utf8").digest("hex")}`;
    if (action === "visit") {
      const stateUrl = typeof body.stateUrl === "string" ? body.stateUrl.trim() : "";
      if (stateUrl && !/^https?:\/\//i.test(stateUrl)) return NextResponse.json({ error: "The History state URL must use HTTP or HTTPS." }, { status: 400 });
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
      await updatePersonal(`DELETE { GRAPH ${graph} { ${iri(id)} ?oldPredicate ?oldObject } } INSERT { GRAPH ${graph} { ${triples.map((triple) => `${triple} .`).join("\n")} } } WHERE { OPTIONAL { GRAPH ${graph} { ${iri(id)} ?oldPredicate ?oldObject } } }`);
      return NextResponse.json({ historyId: id });
    }
    if (action === "check") {
      // Prefer the active History item when available. Its restored query can
      // serialize differently from the XML originally hashed at bookmark time.
      let bookmarkId: string | null = null;
      if (historyId) {
        const currentAsk = `PREFIX rdf: <${RDF_NS}> PREFIX schema: <${SCHEMA_NS}> PREFIX bookmark: <${BOOKMARK_NS}> ASK WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} rdf:type bookmark:Bookmark ; schema:identifier ?hash . } }`;
        if (await askPersonal(currentAsk)) bookmarkId = historyId;
      }
      if (!bookmarkId) {
        const lookup = await queryPersonal(`PREFIX schema: <${SCHEMA_NS}> SELECT ?bookmark WHERE { GRAPH ${bookmarkGraph} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } } LIMIT 1`);
        bookmarkId = lookup.results?.bindings?.[0]?.bookmark?.value ?? null;
      }
      return NextResponse.json({ bookmarked: Boolean(bookmarkId), hash: queryHash, historyId: bookmarkId });
    }
    if (action === "unbookmark") {
      if (historyId) {
        const currentAsk = `PREFIX rdf: <${RDF_NS}> PREFIX schema: <${SCHEMA_NS}> PREFIX bookmark: <${BOOKMARK_NS}> ASK WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} rdf:type bookmark:Bookmark ; schema:identifier ?hash . } }`;
        if (await askPersonal(currentAsk)) {
          await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ?linkedSubject ?predicate ?object } } WHERE { GRAPH ${bookmarkGraph} { ${iri(historyId)} (<${BOOKMARK_NS}recalls>|<${DCTERMS_NS}references>|<${VFCT_NS}savedQuery>|<${VFCT_NS}child>|<${VFCT_NS}attribute>)* ?linkedSubject . ?linkedSubject ?predicate ?object } }`);
          return NextResponse.json({ removed: true, hash: queryHash, historyId });
        }
      }
      const ask = `PREFIX schema: <${SCHEMA_NS}> ASK WHERE { GRAPH ${bookmarkGraph} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } }`;
      const bookmarked = await askPersonal(ask);
      if (!bookmarked) return NextResponse.json({ removed: false, error: "No bookmark hash matches this query." }, { status: 404 });
      await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ?linkedSubject ?predicate ?object } } WHERE { GRAPH ${bookmarkGraph} { ?bookmark <${SCHEMA_NS}identifier> ${sparqlString(queryHash)} . ?bookmark (<${BOOKMARK_NS}recalls>|<${DCTERMS_NS}references>|<${VFCT_NS}savedQuery>|<${VFCT_NS}child>|<${VFCT_NS}attribute>)* ?linkedSubject . ?linkedSubject ?predicate ?object } }`);
      return NextResponse.json({ removed: true, hash: queryHash });
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
      `${iri(bookmark)} <${ANNOTATION_NS}created> ${sparqlString(created)}`,
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
    await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> ?oldTopicType } } INSERT { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> <${BOOKMARK_NS}Topic> ; <${DCTERMS_NS}title> ${sparqlString("Saved queries")} ; <${RDFS_NS}label> ${sparqlString("Saved queries")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(savedQueriesTopic)} <${RDF_NS}type> ?oldTopicType } } FILTER(!BOUND(?oldTopicType)) }`);
    const update = `DELETE { GRAPH ${bookmarkGraph} { ${iri(bookmark)} <${SCHEMA_NS}identifier> ?oldHash } } INSERT { GRAPH ${bookmarkGraph} { ${triples.map((triple) => `${triple} .`).join("\n")} } } WHERE { OPTIONAL { GRAPH ${bookmarkGraph} { ${iri(bookmark)} <${SCHEMA_NS}identifier> ?oldHash } } }`;
    await updatePersonal(update);
    return NextResponse.json({ saved: true, bookmark, title, hash: queryHash });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save query favorite." }, { status: 502 });
  }
}

/** Read Annotea bookmarks and older favorites written by previous Maestro versions. */
export async function GET(request: Request) {
  try {
    const baseGraph = getHistoryGraph(request).split("#", 1)[0];
    const query = `PREFIX rdf: <${RDF_NS}> PREFIX rdfs: <${RDFS_NS}> PREFIX dcterms: <${DCTERMS_NS}> PREFIX a: <${ANNOTATION_NS}> PREFIX b: <${BOOKMARK_NS}> PREFIX vfct: <${VFCT_NS}> PREFIX sioc: <${SIOC_NS}> PREFIX schema: <${SCHEMA_NS}> SELECT DISTINCT ?bookmark ?title ?description ?created ?queryXML ?shareUrl WHERE { GRAPH <${baseGraph}#bookmarks> { { ?bookmark rdf:type b:Bookmark } UNION { ?bookmark rdf:type sioc:Item } UNION { ?bookmark rdf:type vfct:QueryBookmark } OPTIONAL { ?bookmark dcterms:title ?dcTitle } OPTIONAL { ?bookmark rdfs:label ?standardTitle } OPTIONAL { ?bookmark vfct:label ?legacyTitle } BIND(COALESCE(?dcTitle, ?standardTitle, ?legacyTitle, STR(?bookmark)) AS ?title) OPTIONAL { ?bookmark dcterms:description ?description } OPTIONAL { ?bookmark a:created ?annoteaCreated } OPTIONAL { ?bookmark dcterms:created ?dctermsCreated } OPTIONAL { ?bookmark dcterms:date ?dctermsDate } OPTIONAL { ?bookmark vfct:created ?legacyCreated } BIND(COALESCE(?annoteaCreated, ?dctermsCreated, ?dctermsDate, ?legacyCreated) AS ?created) OPTIONAL { ?bookmark schema:url ?bookmarkUrl } { ?bookmark b:recalls ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark dcterms:references ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark vfct:savedQuery ?legacyQuery . ?legacyQuery vfct:queryXML ?queryXML . } BIND(COALESCE(?bookmarkUrl, ?queryUrl) AS ?shareUrl) } } ORDER BY DESC(?created) ?title`;
    const result = await queryPersonalSparql(query, 20000, request);
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
    return NextResponse.json({ favorites });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load query favorites." }, { status: 503 });
  }
}
