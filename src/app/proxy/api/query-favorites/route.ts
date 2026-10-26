import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { MAESTRO_IDS_NS, QUERY_FAVORITES_GRAPH, VFCT_NS, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const SIOC_NS = "http://rdfs.org/sioc/ns#";
const SCHEMA_NS = "https://schema.org/";

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

/** Save query favorites using common RDF metadata terms; retain FCT-specific predicates only for XML structure. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { queryXml?: unknown; title?: unknown; shareLink?: unknown };
    const queryXml = typeof body.queryXml === "string" ? body.queryXml.trim() : "";
    if (!queryXml || !/^\s*(?:<\?xml[^>]*>\s*)?<query\b/i.test(queryXml)) {
      return NextResponse.json({ error: "A serialized FCT <query> document is required." }, { status: 400 });
    }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : `Saved query ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
    const shareLink = typeof body.shareLink === "string" ? body.shareLink.trim() : "";
    let shareLinkIri = "";
    if (shareLink) {
      const parsedShareLink = new URL(shareLink);
      if (parsedShareLink.protocol !== "http:" && parsedShareLink.protocol !== "https:") {
        throw new Error("The query share link must use HTTP or HTTPS.");
      }
      shareLinkIri = parsedShareLink.toString();
    }
    const bookmark = mintedId("query-bookmark");
    const queryResource = mintedId("query");
    const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, processEntities: true });
    const parsed = parser.parse(queryXml) as Record<string, unknown>[];
    const triples: string[] = [
      `${iri(bookmark)} <${RDF_NS}type> <${VFCT_NS}QueryBookmark>`,
      `${iri(bookmark)} <${RDF_NS}type> <${SIOC_NS}Item>`,
      `${iri(bookmark)} <${RDFS_NS}label> ${sparqlString(title)}`,
      `${iri(bookmark)} <${DCTERMS_NS}created> ${sparqlString(new Date().toISOString())}^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
      `${iri(bookmark)} <${DCTERMS_NS}references> ${iri(queryResource)}`,
      `${iri(queryResource)} <${RDF_NS}value> ${sparqlString(queryXml)}^^<${RDF_NS}XMLLiteral>`,
    ];
    // Link the saved query instance to the exact shareable URL from the browser.
    if (shareLinkIri) triples.push(`${iri(queryResource)} <${SCHEMA_NS}url> ${iri(shareLinkIri)}`);
    let nodeCounter = 0;
    const walk = (entries: Record<string, unknown>[], parent?: string) => {
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
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
    return NextResponse.json({ saved: true, bookmark, title });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save query favorite." }, { status: 502 });
  }
}

/** Read both the standard-vocabulary representation and earlier favorites written by B19.9. */
export async function GET() {
  try {
    const query = `PREFIX rdf: <${RDF_NS}> PREFIX rdfs: <${RDFS_NS}> PREFIX dcterms: <${DCTERMS_NS}> PREFIX vfct: <${VFCT_NS}> SELECT DISTINCT ?bookmark ?title ?created ?queryXML WHERE { GRAPH <${QUERY_FAVORITES_GRAPH}> { ?bookmark rdf:type vfct:QueryBookmark . OPTIONAL { ?bookmark rdfs:label ?standardTitle } OPTIONAL { ?bookmark vfct:label ?legacyTitle } BIND(COALESCE(?standardTitle, ?legacyTitle, STR(?bookmark)) AS ?title) OPTIONAL { ?bookmark dcterms:created ?standardCreated } OPTIONAL { ?bookmark vfct:created ?legacyCreated } BIND(COALESCE(?standardCreated, ?legacyCreated) AS ?created) { ?bookmark dcterms:references ?query . ?query rdf:value ?queryXML . } UNION { ?bookmark vfct:savedQuery ?legacyQuery . ?legacyQuery vfct:queryXML ?queryXML . } } } ORDER BY DESC(?created) ?title`;
    const result = await queryPersonalSparql(query);
    const favorites = (result.results?.bindings ?? []).map((row) => ({
      uri: row.bookmark?.value ?? "",
      title: row.title?.value ?? row.bookmark?.value ?? "Saved query",
      created: row.created?.value ?? "",
      queryXml: row.queryXML?.value ?? "",
    })).filter((item) => item.uri && item.queryXml);
    return NextResponse.json({ favorites });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load query favorites." }, { status: 503 });
  }
}
