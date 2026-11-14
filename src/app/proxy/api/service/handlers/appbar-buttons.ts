import { NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { featureFctQuery } from "@/lib/feature-fct-query";
import { serializeFctQuery } from "@/lib/fct-query-serialize";
import type { FctQueryTree } from "@/lib/fct-query-api";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { askPersonalSparql, getHistoryGraph, VFCT_NS, getUserGraph, getShapesGraph, graphForFile, personalSparqlUrl, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA_URL = "https://schema.org/url";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#Bookmark";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const DC = "http://purl.org/dc/terms/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const VFCT = VFCT_NS;
const IRI = /^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i;
const iri = (v: string) => { if (!IRI.test(v)) throw new Error("Invalid IRI"); return `<${v}>`; };
const graph = (request: Request) => iri(`${getUserGraph(request)}/appbar`);
const bookmarks = (request: Request) => iri(`${getHistoryGraph(request).split("#", 1)[0]}#bookmarks`);

/** User-controlled appbar providers live ONLY in the personal /appbar graph.
 * Enforce the five-slot limit server-side; clients cannot add arbitrary actions.
 */
async function list(request: Request) {
  const data = await queryPersonalSparql(`SELECT ?button ?action ?icon ?tooltip ?url ?directUrl WHERE { GRAPH ${graph(request)} {
    ?button a <${MUI}AppbarButtonProvider> ; <${MUI}action> ?action ; <${MUI}icon> ?icon ; <${MUI}tooltip> ?tooltip .
  } OPTIONAL { GRAPH ${bookmarks(request)} { ?action <${SCHEMA_URL}> ?url } } OPTIONAL { GRAPH ${graph(request)} { ?button <${SCHEMA_URL}> ?directUrl } } } ORDER BY STR(?button)`, 20000, request);
  const byId = new Map<string, {uri:string; action:string; icon:string; tooltip:string; url:string}>();
  for (const b of data.results?.bindings ?? []) {
    const uri=b.button?.value ?? "";
    if (IRI.test(uri) && !byId.has(uri)) byId.set(uri, {uri, action:b.action?.value??"",icon:b.icon?.value??"",tooltip:b.tooltip?.value??"",url:b.directUrl?.value??b.url?.value??""});
  }
  return [...byId.values()].sort((a, b) => {
    const featurePath = "/features/appbar#";
    const af = a.uri.includes(featurePath), bf = b.uri.includes(featurePath);
    return af === bf ? 0 : af ? -1 : 1;
  });
}
/** Ensure five stable FCT registry bookmarks and appbar shortcuts on login.
 * Idempotent: repeated logins don't duplicate bookmarks or reorder shortcuts.
 * Each is a genuine bookmark with a query hash, rdf:value and schema:url.
 * Existing legacy per-resource Features pins are retired to free slots;
 * unrelated user bookmark pins are never deleted.
 */
async function ensureFeatureBookmarks(request: Request) {
  const catalog = [
    { kind: "policies", title: "Policies", icon: "shield-check" },
    { kind: "formats", title: "Formats", icon: "file-code-2" },
    { kind: "facet-widgets", title: "Facets", icon: "filter" },
    { kind: "transcoders", title: "Transcoders", icon: "arrow-left-right" },
    { kind: "curators", title: "Curators", icon: "landmark" },
  ] as const;
  const endpoint = personalSparqlUrl(request).toString();
  const base = getHistoryGraph(request).split("#", 1)[0];
  const bookmarkGraph = iri(`${base}#bookmarks`);
  const appbarGraph = graph(request);
  const loginTimestamp = new Date().toISOString();
  const historyGraph = iri(`${base}#history`);
  const entries = catalog.map((entry) => {
    // Use precisely the same builder and source graph as live Features navigation.
    const source = entry.kind === "transcoders" ? graphForFile("otc-transcoders.rdf", request)
      : entry.kind === "formats" ? "$ALL$" : getShapesGraph(request);
    const seed = { name: "query", attributes: {}, children: [] } as FctQueryTree;
    const queryXml = serializeFctQuery(featureFctQuery(seed, entry.kind, source, endpoint, 30));
    const url = new URL(request.url);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    url.searchParams.set("q", queryXml);
    url.searchParams.set("tab", "1");
    url.searchParams.set("ribbonTab", "2");
    url.searchParams.set("state", JSON.stringify({ workspaceTab: "view", viewPanel: "features", viewFeature: entry.kind, centralTab: "results" }));
    const hash = `sha256:${createHash("sha256").update(canonicalQueryIdentityXml(queryXml), "utf8").digest("hex")}`;
    const sparql = compileFctXmlToSparql(queryXml).query;
    // The bookmark is the History visit, exactly as in query-favorites/update.
    const historyId = iri(`${base}/features/bookmark#${entry.kind}`);
    return { ...entry, historyId, button: iri(`${base}/features/appbar#${entry.kind}`),
      queryResource: iri(`${base}/features/query#${entry.kind}`), queryXml, url: url.href, hash, sparql };
  });
  // Never delete unrelated user-defined appbar pins during automatic initialization.
  for (const entry of entries) {
    if (entry.kind === "facet-widgets") {
      // Refresh the icon of an existing generated shortcut as well.
      await updatePersonalSparql(`DELETE { GRAPH ${appbarGraph} { ${entry.button} <${MUI}icon> ?oldIcon } }
        INSERT { GRAPH ${appbarGraph} { ${entry.button} <${MUI}icon> "filter" } }
        WHERE { GRAPH ${appbarGraph} { ${entry.button} a <${MUI}AppbarButtonProvider> ; <${MUI}icon> ?oldIcon } }`, 20000, request);
    }
    // 1. Create a real vfct:QueryHistoryVisit at login. The stable ID prevents
    // duplicate visits on refresh, while the first-login creation time persists.
    await updatePersonalSparql(`INSERT { GRAPH ${historyGraph} {
      ${entry.historyId} a <${VFCT}QueryHistoryVisit> ;
        <${DC}title> ${JSON.stringify(entry.title)} ;
        <${RDFS}label> ${JSON.stringify(entry.title)} ;
        <${VFCT}historyCreated> ${JSON.stringify(loginTimestamp)}^^<${XSD}dateTime> ;
        <${VFCT}historyQueryXML> ${JSON.stringify(entry.queryXml)} ;
        <${VFCT}historyStateUrl> ${JSON.stringify(entry.url)} .
    } } WHERE { FILTER NOT EXISTS { GRAPH ${historyGraph} {
      ${entry.historyId} a <${VFCT}QueryHistoryVisit> .
    } } }`, 20000, request);
    // 2. Bookmark that same History visit using the existing bookmark schema,
    // not a separate synthetic bookmark identity. The canonical hash is what
    // the appbar bookmark toggle and query-favorites/check actually look up.
    // Add missing metadata to legacy auto-bookmarks as well, without changing
    // their original creation timestamps or duplicating RDF triples.
    const bookmarkTriples = [
      [`<${RDF}type>`, `<${BOOKMARK}>`],
      [`<${DC}title>`, JSON.stringify(entry.title)],
      [`<${RDFS}label>`, JSON.stringify(entry.title)],
      [`<${SCHEMA_URL}>`, iri(entry.url)],
      [`<https://schema.org/identifier>`, JSON.stringify(entry.hash)],
      [`<${VFCT}historyQueryXML>`, JSON.stringify(entry.queryXml)],
      [`<${MUI}querySparql>`, JSON.stringify(entry.sparql)],
      [`<http://www.w3.org/2002/01/bookmark#recalls>`, entry.queryResource],
      [`<${DC}created>`, `${JSON.stringify(loginTimestamp)}^^<${XSD}dateTime>`],
    ] as const;
    const editable = bookmarkTriples.filter(([predicate]) => predicate !== `<${DC}created>`);
    await updatePersonalSparql(`DELETE { GRAPH ${bookmarkGraph} {
      ${entry.historyId} ?oldPredicate ?oldValue .
      ${entry.queryResource} <${RDF}value> ?oldXml .
    } }
      INSERT { GRAPH ${bookmarkGraph} {
        ${editable.map(([predicate, object]) => `${entry.historyId} ${predicate} ${object} .`).join("\n")}
        ${entry.queryResource} <${RDF}value> ${JSON.stringify(entry.queryXml)} .
      } }
      WHERE {
        OPTIONAL { GRAPH ${bookmarkGraph} { ${entry.historyId} ?oldPredicate ?oldValue .
          FILTER(?oldPredicate IN (${editable.map(([predicate]) => predicate).join(", ")})) } }
        OPTIONAL { GRAPH ${bookmarkGraph} { ${entry.queryResource} <${RDF}value> ?oldXml } }
      }`, 20000, request);
    // Preserve the timestamp of an existing bookmark on subsequent page loads.
    await updatePersonalSparql(`INSERT { GRAPH ${bookmarkGraph} {
      ${entry.historyId} <${DC}created> ${JSON.stringify(loginTimestamp)}^^<${XSD}dateTime> .
    } } WHERE { FILTER NOT EXISTS { GRAPH ${bookmarkGraph} {
      ${entry.historyId} <${DC}created> ?existing .
    } } }`, 20000, request);
    // 3. Pin the saved History bookmark rather than an unrelated provider URI.
    await updatePersonalSparql(`DELETE { GRAPH ${appbarGraph} { ${entry.button} <${MUI}action> ?oldAction } }
      INSERT { GRAPH ${appbarGraph} {
        ${entry.button} a <${MUI}AppbarButtonProvider> ;
          <${MUI}action> ${entry.historyId} ;
          <${MUI}tooltip> ${JSON.stringify(entry.title)} ;
          <${MUI}icon> ${JSON.stringify(entry.icon)} .
      } } WHERE { OPTIONAL { GRAPH ${appbarGraph} { ${entry.button} <${MUI}action> ?oldAction } } }`, 20000, request);
  }
  return list(request);
}
export async function POST(request: Request) {
  const unauthorized = requirePersonalLogin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {action?:string; bookmark?:string; provider?:string; resource?:string; feature?:string; url?:string; tooltip?:string; icon?:string};
    if (body.action === "ensure-features") return NextResponse.json({ buttons: await ensureFeatureBookmarks(request) }, { headers: { "Cache-Control": "no-store" } });
    if (body.action === "list") return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
    if (body.action === "remove") {
      if (!body.provider) return NextResponse.json({error:"Provider required"},{status:400});
      await updatePersonalSparql(`DELETE WHERE { GRAPH ${graph(request)} { ${iri(body.provider)} ?p ?o } }`,20000,request);
      return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
    }
    if (body.action === "add-resource") return NextResponse.json({ error: "Features shortcuts are created automatically on login" }, { status: 409 });
    if (body.action !== "add" || !body.bookmark || typeof body.tooltip !== "string" || typeof body.icon !== "string") return NextResponse.json({error:"Bookmark, icon, and tooltip are required"},{status:400});
    const tooltip=body.tooltip.trim(), icon=body.icon.trim();
    if (!tooltip || tooltip.length>120 || !/^[a-z][a-z0-9-]{0,63}$/.test(icon)) return NextResponse.json({error:"Enter a tooltip (1–120 characters) and a Lucide kebab-case icon name"},{status:400});
    // Ensure the action points to an actual saved bookmark, rather than a caller-provided URL.
    const isBookmark=await askPersonalSparql(`ASK { GRAPH ${bookmarks(request)} { ${iri(body.bookmark)} a <${BOOKMARK}> ; <${SCHEMA_URL}> ?url } }`,20000,request);
    if (!isBookmark) return NextResponse.json({error:"The selected bookmark is not saved in the personal graph"},{status:422});
    const existing=await list(request);
    if (existing.some(e=>e.action===body.bookmark)) return NextResponse.json({buttons:existing}, {headers:{"Cache-Control":"no-store"}});
    if (existing.length>=5) return NextResponse.json({error:"Only five bookmark buttons may be added to the appbar"},{status:409});
    const node=iri(`gttp://ggg.maestro.ecosys/appbar/button#${randomUUID()}`);
    await updatePersonalSparql(`INSERT DATA { GRAPH ${graph(request)} { ${node} a <${MUI}AppbarButtonProvider> ; <${MUI}action> ${iri(body.bookmark)} ; <${MUI}tooltip> ${JSON.stringify(tooltip)} ; <${MUI}icon> ${JSON.stringify(icon)} . } }`,20000,request);
    return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
  } catch(err) {return NextResponse.json({error:err instanceof Error?err.message:"Appbar provider request failed"},{status:502});}
}
