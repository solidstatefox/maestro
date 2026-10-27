import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { MAESTRO_IDS_NS, QUERY_FAVORITES_GRAPH, VFCT_NS, askPersonalSparql, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

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

function sparqlString(value: string): string {
  return JSON.stringify(value);
}
function iri(value: string): string {
  if (/[<>"{}|^`\\\s]/u.test(value)) throw new Error(`Unsafe IRI in saved query: ${value}`);
  return `<${value}>`;
}
function mintedId(prefix: string): string {
  return `${MAESTRO_IDS_NS}${prefix}-${crypto.randomUUID()}#thisistheid`;
}
function tagSlug(value: string): string {
  const slug = value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return slug || "tag";
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
    };
    const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
      return NextResponse.json({ error: "A serialized FCT <query> document is required." }, { status: 400 });
    }
    const queryHash = `sha256:${createHash("sha256").update(queryXml, "utf8").digest("hex")}`;
    if (body.action === "check") {
      const ask = `PREFIX schema: <${SCHEMA_NS}> ASK WHERE { GRAPH ${iri(QUERY_FAVORITES_GRAPH)} { ?bookmark schema:identifier ${sparqlString(queryHash)} . } }`;
      const bookmarked = await askPersonalSparql(ask);
      return NextResponse.json({ bookmarked, hash: queryHash });
    }

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
      `${iri(bookmark)} <${ANNOTATION_NS}created> ${sparqlString(created)}`,
      `${iri(bookmark)} <${DCTERMS_NS}created> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
      `${iri(bookmark)} <${DCTERMS_NS}date> ${sparqlString(created)}^^<${XSD_NS}dateTime>`,
      `${iri(bookmark)} <${BOOKMARK_NS}recalls> ${iri(queryResource)}`,
      `${iri(bookmark)} <${BOOKMARK_NS}hasTopic> ${iri(savedQueriesTopic)}`,
      `${iri(savedQueriesTopic)} <${RDF_NS}type> <${BOOKMARK_NS}Topic>`,
      `${iri(savedQueriesTopic)} <${DCTERMS_NS}title> ${sparqlString("Saved queries")}`,
      `${iri(savedQueriesTopic)} <${RDFS_NS}label> ${sparqlString("Saved queries")}`,
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
        // SCOT declares scot:has_tag as a subproperty of sioc:topic for sioc:Items.
        const tagUri = `${MAESTRO_IDS_NS}scot-tag#${tagSlug(tag)}`;
        triples.push(`${iri(bookmark)} <${SCOT_NS}has_tag> ${iri(tagUri)}`);
        triples.push(`${iri(tagUri)} <${RDF_NS}type> <${SCOT_NS}Tag>`);
        triples.push(`${iri(tagUri)} <${RDFS_NS}label> ${sparqlString(tag)}`);
        triples.push(`${iri(tagUri)} <${SKOS_NS}prefLabel> ${sparqlString(tag)}`);
      } else {
        const tagUri = `${MAESTRO_IDS_NS}skos-tag#${tagSlug(tag)}`;
        triples.push(`${iri(bookmark)} <${DCTERMS_NS}subject> ${iri(tagUri)}`);
        triples.push(`${iri(tagUri)} <${RDF_NS}type> <${SKOS_NS}Concept>`);
        triples.push(`${iri(tagUri)} <${SKOS_NS}prefLabel> ${sparqlString(tag)}`);
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
    const update = `INSERT DATA { GRAPH ${iri(QUERY_FAVORITES_GRAPH)} { ${triples.map((triple) => `${triple} .`).join("\n")} } }`;
    await updatePersonalSparql(update);
    return NextResponse.json({ saved: true, bookmark, title, hash: queryHash });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save query favorite." }, { status: 502 });
  }
}

/** Read Annotea bookmarks and older favorites written by previous Maestro versions. */
export async function GET() {
  try {
    const query = `PREFIX rdf: <${RDF_NS}> PREFIX rdfs: <${RDFS_NS}> PREFIX dcterms: <${DCTERMS_NS}> PREFIX a: <${ANNOTATION_NS}> PREFIX b: <${BOOKMARK_NS}> PREFIX vfct: <${VFCT_NS}> PREFIX sioc: <${SIOC_NS}> PREFIX schema: <${SCHEMA_NS}> SELECT DISTINCT ?bookmark ?title ?description ?created ?queryXML ?shareUrl WHERE { GRAPH <${QUERY_FAVORITES_GRAPH}> { { ?bookmark rdf:type b:Bookmark } UNION { ?bookmark rdf:type sioc:Item } UNION { ?bookmark rdf:type vfct:QueryBookmark } OPTIONAL { ?bookmark dcterms:title ?dcTitle } OPTIONAL { ?bookmark rdfs:label ?standardTitle } OPTIONAL { ?bookmark vfct:label ?legacyTitle } BIND(COALESCE(?dcTitle, ?standardTitle, ?legacyTitle, STR(?bookmark)) AS ?title) OPTIONAL { ?bookmark dcterms:description ?description } OPTIONAL { ?bookmark a:created ?annoteaCreated } OPTIONAL { ?bookmark dcterms:created ?dctermsCreated } OPTIONAL { ?bookmark dcterms:date ?dctermsDate } OPTIONAL { ?bookmark vfct:created ?legacyCreated } BIND(COALESCE(?annoteaCreated, ?dctermsCreated, ?dctermsDate, ?legacyCreated) AS ?created) OPTIONAL { ?bookmark schema:url ?bookmarkUrl } { ?bookmark b:recalls ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark dcterms:references ?query . ?query rdf:value ?queryXML . OPTIONAL { ?query schema:url ?queryUrl } } UNION { ?bookmark vfct:savedQuery ?legacyQuery . ?legacyQuery vfct:queryXML ?queryXML . } BIND(COALESCE(?bookmarkUrl, ?queryUrl) AS ?shareUrl) } } ORDER BY DESC(?created) ?title`;
    const result = await queryPersonalSparql(query);
    const favorites = (result.results?.bindings ?? []).map((row) => ({
      uri: row.bookmark?.value ?? "",
      title: row.title?.value ?? row.bookmark?.value ?? "Saved query",
      description: row.description?.value ?? "",
      created: row.created?.value ?? "",
      queryXml: row.queryXML?.value ?? "",
      // Only http(s) links are returned, so the page can never render a script URL.
      shareUrl: /^https?:\/\//i.test(row.shareUrl?.value ?? "") ? row.shareUrl!.value : "",
    })).filter((item) => item.uri && item.queryXml)
      // A bookmark that was saved more than once with different links would repeat; keep the first.
      .filter((item, index, all) => all.findIndex((other) => other.uri === item.uri && other.queryXml === item.queryXml) === index);
    return NextResponse.json({ favorites });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load query favorites." }, { status: 503 });
  }
}
