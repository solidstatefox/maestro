"use client";

import { canonicalQueryIdentityXml } from "@/lib/query-identity";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { providerFctQuery } from "@/lib/provider-fct-query";
import { serializeFctQuery } from "@/lib/fct-query-serialize";
import type { FctQueryTree } from "@/lib/fct-query-api";
import { personalContext, selectPersonal, updatePersonal, personalExists, type PersonalContext } from "@/lib/client-personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA_URL = "https://schema.org/url";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#Bookmark";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const DC = "http://purl.org/dc/terms/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const VFCT = "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#";
const IRI = /^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i;
const iri = (v: string) => { if (!IRI.test(v)) throw new Error("Invalid IRI"); return `<${v}>`; };
const graph = (ctx: PersonalContext) => iri(`${ctx.base}/appbar`);
const bookmarks = (ctx: PersonalContext) => iri(`${ctx.base}#bookmarks`);
export type AppbarButton = { uri: string; action: string; icon: string; tooltip: string; url: string };

async function listButtons(ctx: PersonalContext): Promise<AppbarButton[]> {
  const rows = await selectPersonal(`SELECT ?button ?action ?icon ?tooltip ?url ?directUrl WHERE { GRAPH ${graph(ctx)} {
    ?button a <${MUI}AppbarButtonProvider> ; <${MUI}action> ?action ; <${MUI}icon> ?icon ; <${MUI}tooltip> ?tooltip .
  } OPTIONAL { GRAPH ${bookmarks(ctx)} { ?action <${SCHEMA_URL}> ?url } } OPTIONAL { GRAPH ${graph(ctx)} { ?button <${SCHEMA_URL}> ?directUrl } } } ORDER BY STR(?button)`, ctx);
  const byId = new Map<string, AppbarButton>();
  for (const b of rows) {
    const uri = b.button?.value ?? "";
    if (IRI.test(uri) && !byId.has(uri)) byId.set(uri, {
      uri, action: b.action?.value ?? "", icon: b.icon?.value ?? "",
      tooltip: b.tooltip?.value ?? "", url: b.directUrl?.value ?? b.url?.value ?? "",
    });
  }
  return [...byId.values()].sort((a,b) => {
    const providerPath = "/providers/appbar#";
    const af = a.uri.includes(providerPath), bf = b.uri.includes(providerPath);
    return af === bf ? 0 : af ? -1 : 1;
  });
}
/** Ensure five stable FCT registry bookmarks and appbar shortcuts on login.
 * Idempotent: repeated logins don't duplicate bookmarks or reorder shortcuts.
 * Each is a genuine bookmark with a query hash, rdf:value and schema:url.
 * Existing legacy per-resource Providers pins are retired to free slots;
 * unrelated user bookmark pins are never deleted.
 */
async function ensureProviderBookmarks(ctx: PersonalContext) {
  const catalog = [
    { kind: "policies", title: "Policies", icon: "shield-check" },
    { kind: "formats", title: "Formats", icon: "file-code-2" },
    { kind: "facet-widgets", title: "Facets", icon: "filter" },
    { kind: "transcoders", title: "Transcoders", icon: "arrow-left-right" },
    { kind: "curators", title: "Curators", icon: "landmark" },
    { kind: "kinds", title: "Kinds", icon: "regex" },
  ] as const;
  const endpoint = ctx.session.graphStore.replace(/\/sparql-auth\/?$/i, "/sparql");
  const base = ctx.base;
  const bookmarkGraph = iri(`${base}#bookmarks`);
  const appbarGraph = graph(ctx);
  const loginTimestamp = new Date().toISOString();
  const historyGraph = iri(`${base}#history`);
  const entries = await Promise.all(catalog.map(async (entry) => {
    // Use precisely the same builder and source graph as live Providers navigation.
    const source = entry.kind === "transcoders" ? `${ctx.base}/otc/transcoders`
      : entry.kind === "formats" ? "$ALL$" : `${ctx.base}/shacl/policies`;
    const seed = { name: "query", attributes: {}, children: [] } as FctQueryTree;
    const queryXml = serializeFctQuery(providerFctQuery(seed, entry.kind, source, endpoint, 30));
    const url = new URL(window.location.origin);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    url.searchParams.set("q", queryXml);
    url.searchParams.set("tab", "1");
    url.searchParams.set("ribbonTab", "2");
    url.searchParams.set("state", JSON.stringify({ workspaceTab: "view", viewPanel: "providers", viewProvider: entry.kind, centralTab: "results" }));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalQueryIdentityXml(queryXml)));
    const hash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const sparql = compileFctXmlToSparql(queryXml).query;
    // The bookmark is the History visit, exactly as in query-favorites/update.
    const historyId = iri(`${base}/providers/bookmark#${entry.kind}`);
    return { ...entry, historyId, button: iri(`${base}/providers/appbar#${entry.kind}`),
      queryResource: iri(`${base}/providers/query#${entry.kind}`), queryXml, url: url.href, hash, sparql };
  }));
  // Never delete unrelated user-defined appbar pins during automatic initialization.
  for (const entry of entries) {
    if (entry.kind === "facet-widgets") {
      // Refresh the icon of an existing generated shortcut as well.
      await updatePersonal(`DELETE { GRAPH ${appbarGraph} { ${entry.button} <${MUI}icon> ?oldIcon } }
        INSERT { GRAPH ${appbarGraph} { ${entry.button} <${MUI}icon> "filter" } }
        WHERE { GRAPH ${appbarGraph} { ${entry.button} a <${MUI}AppbarButtonProvider> ; <${MUI}icon> ?oldIcon } }`);
    }
    // 1. Create a real vfct:QueryHistoryVisit at login. The stable ID prevents
    // duplicate visits on refresh, while the first-login creation time persists.
    await updatePersonal(`INSERT { GRAPH ${historyGraph} {
      ${entry.historyId} a <${VFCT}QueryHistoryVisit> ;
        <${DC}title> ${JSON.stringify(entry.title)} ;
        <${RDFS}label> ${JSON.stringify(entry.title)} ;
        <${VFCT}historyCreated> ${JSON.stringify(loginTimestamp)}^^<${XSD}dateTime> ;
        <${VFCT}historyQueryXML> ${JSON.stringify(entry.queryXml)} ;
        <${VFCT}historyStateUrl> ${JSON.stringify(entry.url)} .
    } } WHERE { FILTER NOT EXISTS { GRAPH ${historyGraph} {
      ${entry.historyId} a <${VFCT}QueryHistoryVisit> .
    } } }`);
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
    await updatePersonal(`DELETE { GRAPH ${bookmarkGraph} {
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
      }`);
    // Preserve the timestamp of an existing bookmark on subsequent page loads.
    await updatePersonal(`INSERT { GRAPH ${bookmarkGraph} {
      ${entry.historyId} <${DC}created> ${JSON.stringify(loginTimestamp)}^^<${XSD}dateTime> .
    } } WHERE { FILTER NOT EXISTS { GRAPH ${bookmarkGraph} {
      ${entry.historyId} <${DC}created> ?existing .
    } } }`);
    // 3. Pin the saved History bookmark rather than an unrelated provider URI.
    await updatePersonal(`DELETE { GRAPH ${appbarGraph} { ${entry.button} <${MUI}action> ?oldAction } }
      INSERT { GRAPH ${appbarGraph} {
        ${entry.button} a <${MUI}AppbarButtonProvider> ;
          <${MUI}action> ${entry.historyId} ;
          <${MUI}tooltip> ${JSON.stringify(entry.title)} ;
          <${MUI}icon> ${JSON.stringify(entry.icon)} .
      } } WHERE { OPTIONAL { GRAPH ${appbarGraph} { ${entry.button} <${MUI}action> ?oldAction } } }`);
  }
  return listButtons(ctx);
}

/** Public browser API: these commands mutate only the authenticated user's
 * own graphs through /proxy/api/sparql. The UI's five-button restriction is
 * convenience, not a substitute for graph-server authorization. */
export async function manageAppbarButtons(body: {
  action: "list" | "add" | "remove" | "ensure-providers";
  bookmark?: string; provider?: string; tooltip?: string; icon?: string;
}): Promise<{ buttons: AppbarButton[] }> {
  const ctx = await personalContext();
  if (body.action === "list") return {buttons: await listButtons(ctx)};
  if (body.action === "ensure-providers") return {buttons: await ensureProviderBookmarks(ctx)};
  if (body.action === "remove") {
    if (!body.provider) throw new Error("Provider required");
    await updatePersonal(`DELETE WHERE { GRAPH ${graph(ctx)} { ${iri(body.provider)} ?p ?o } }`);
    return {buttons: await listButtons(ctx)};
  }
  if (body.action !== "add" || !body.bookmark || typeof body.tooltip !== "string" || typeof body.icon !== "string") {
    throw new Error("Bookmark, icon, and tooltip are required");
  }
  const tooltip = body.tooltip.trim(), icon = body.icon.trim();
  if (!tooltip || tooltip.length > 120 || !/^[a-z][a-z0-9-]{0,63}$/.test(icon)) {
    throw new Error("Enter a tooltip (1–120 characters) and a Lucide kebab-case icon name");
  }
  const isBookmark = await personalExists(`GRAPH ${bookmarks(ctx)} { ${iri(body.bookmark)} a <${BOOKMARK}> ; <${SCHEMA_URL}> ?url }`, ctx);
  if (!isBookmark) throw new Error("The selected bookmark is not saved in the personal graph");
  const existing = await listButtons(ctx);
  if (existing.some(item => item.action === body.bookmark)) return {buttons: existing};
  if (existing.length >= 5) throw new Error("Only five bookmark buttons may be added to the appbar");
  const node = iri(`gttp://ggg.maestro.ecosys/appbar/button#${crypto.randomUUID()}`);
  await updatePersonal(`INSERT DATA { GRAPH ${graph(ctx)} { ${node} a <${MUI}AppbarButtonProvider> ; <${MUI}action> ${iri(body.bookmark)} ; <${MUI}tooltip> ${JSON.stringify(tooltip)} ; <${MUI}icon> ${JSON.stringify(icon)} . } }`);
  return {buttons: await listButtons(ctx)};
}
