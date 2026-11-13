import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
import { getHistoryGraph, personalSparqlUrl, queryPersonalSparql } from "@/lib/personal-sparql";

type Binding = Record<string, { value?: string }>;
const BOOKMARK_TYPE = "http://www.w3.org/2002/01/bookmark#Bookmark";
const CREATED = "http://purl.org/dc/terms/created";
const TAGS = [
  "http://www.w3.org/2004/02/skos/core#prefLabel",
  "http://purl.org/dc/terms/subject",
  "http://rdfs.org/scot/ns#has_tag",
];
const iri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);

/**
 * Retain the *unpaginated* WHERE produced by Maestro's FCT compiler. This is
 * deliberately limited to our compiler's outer SELECT, not arbitrary SPARQL.
 * The resource is ?s1, the root resource in the live faceted query.
 */
function unpagedRootScope(query: string): { preamble: string; scope: string } {
  const match = /\bSELECT\b[\s\S]*?\bWHERE\s*\{/i.exec(query);
  if (!match || match.index === undefined) throw new Error("FCT did not produce a SELECT WHERE scope.");
  const preamble = query.slice(0, match.index);
  const open = match.index + match[0].length - 1;
  let depth = 0;
  let close = -1;
  let quoted = false;
  let iriRef = false;
  let escaped = false;
  for (let i = open; i < query.length; i++) {
    const c = query[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (iriRef) { if (c === ">") iriRef = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === "<" && /[a-z]/i.test(query[i + 1] ?? "")) { iriRef = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) { close = i; break; }
  }
  if (close < 0) throw new Error("Could not identify the end of the FCT WHERE clause.");
  const body = query.slice(open + 1, close);
  // Never inherit FCT result page LIMIT/OFFSET into an aggregate.
  return { preamble, scope: `{ SELECT DISTINCT ?s1 WHERE { ${body} } }` };
}

/** Bookmark aggregations use the same root FCT scope as Browse/Analyze.
 * They run at the authenticated personal endpoint, where the bookmark graph
 * lives. The RDF date is typed xsd:dateTime when bookmarks are created.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requirePersonalLogin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { queryXml?: unknown; kind?: unknown };
    if (body.kind !== "activity" && body.kind !== "tags") return NextResponse.json({ error: "Unknown Bookmark analysis." }, { status: 400 });
    if (typeof body.queryXml !== "string" || body.queryXml.length > 100000) return NextResponse.json({ error: "Invalid FCT query." }, { status: 400 });
    const compiled = compileFctXmlToSparql(body.queryXml);
    const root = /<query\b([^>]*)>/i.exec(body.queryXml)?.[1] ?? "";
    const address = /\baddr\s*=\s*(["'])(.*?)\1/i.exec(root)?.[2]?.replace(/&amp;/g, "&") ?? "";
    const graphServer = address.slice(address.indexOf("@") + 1);
    if (!address.includes("@") || !graphServer) throw new Error("FCT query has no graph-server address.");
    // This provider analyzes personal bookmarks. Do not silently execute the
    // user's FCT filter against a *different* server than the personal store.
    const expected = personalSparqlUrl(request);
    const selected = new URL(graphServer);
    const normalize = (url: URL) => `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    if (normalize(selected) !== normalize(expected)) {
      return NextResponse.json({ error: "Bookmark analysis requires the live query to use the personal graph server." }, { status: 400 });
    }
    const graph = `${getHistoryGraph(request)}#bookmarks`;
    if (!iri(graph)) throw new Error("Invalid Bookmark graph IRI.");
    const { preamble, scope } = unpagedRootScope(compiled.query);
    // Keep BOTH the FCT-matched population and the bookmark graph patterns
    // inside the outer WHERE. The previous query closed WHERE before GRAPH,
    // making GROUP BY an unexpected token in Virtuoso.
    const common = `${scope} GRAPH <${graph}> { ?s1 a <${BOOKMARK_TYPE}> .`;
    const sparql = body.kind === "activity"
      ? `${preamble} SELECT ?weekday ?hour (COUNT(DISTINCT ?s1) AS ?n)
         WHERE { ${common} ?s1 <${CREATED}> ?stamp .
           FILTER(DATATYPE(?stamp) = <http://www.w3.org/2001/XMLSchema#dateTime> || DATATYPE(?stamp) = <http://www.w3.org/2001/XMLSchema#date>)
           BIND(bif:dayname(?stamp) AS ?weekday)
           BIND(bif:hour(?stamp) AS ?hour)
         } }
         GROUP BY ?weekday ?hour`
      : `${preamble} SELECT ?label (COUNT(DISTINCT ?s1) AS ?n)
         WHERE { ${common} ?s1 ?tagPredicate ?tag . VALUES ?tagPredicate { ${TAGS.map(v => `<${v}>`).join(" ")} }
           BIND(STR(?tag) AS ?label)
         } }
         GROUP BY ?label ORDER BY DESC(?n) LIMIT 500`;
    const response = await queryPersonalSparql(sparql, compiled.timeoutMs, request);
    const rows = (response.results?.bindings ?? [] as Binding[]).map((row: Binding) => ({
      label: row.label?.value ?? "", weekday: row.weekday?.value ?? "",
      hour: row.hour?.value ?? "", count: Number(row.n?.value ?? 0),
    })).filter(row => Number.isFinite(row.count) && row.count > 0);
    return NextResponse.json({ kind: body.kind, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bookmark analysis failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
