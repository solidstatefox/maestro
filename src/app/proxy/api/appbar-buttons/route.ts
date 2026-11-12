import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { askPersonalSparql, getHistoryGraph, getUserGraph, queryPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const SCHEMA_URL = "https://schema.org/url";
const BOOKMARK = "http://www.w3.org/2002/01/bookmark#Bookmark";
const IRI = /^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i;
const iri = (v: string) => { if (!IRI.test(v)) throw new Error("Invalid IRI"); return `<${v}>`; };
const graph = (request: Request) => iri(`${getUserGraph(request)}/appbar`);
const bookmarks = (request: Request) => iri(`${getHistoryGraph(request).split("#", 1)[0]}#bookmarks`);

/** User-controlled appbar providers live ONLY in the personal /appbar graph.
 * Enforce the three-slot limit server-side; clients cannot add arbitrary actions.
 */
async function list(request: Request) {
  const data = await queryPersonalSparql(`SELECT ?button ?action ?icon ?tooltip ?url WHERE { GRAPH ${graph(request)} {
    ?button a <${MUI}AppbarButtonProvider> ; <${MUI}action> ?action ; <${MUI}icon> ?icon ; <${MUI}tooltip> ?tooltip .
  } OPTIONAL { GRAPH ${bookmarks(request)} { ?action <${SCHEMA_URL}> ?url } } } ORDER BY STR(?button)`, 20000, request);
  const byId = new Map<string, {uri:string; action:string; icon:string; tooltip:string; url:string}>();
  for (const b of data.results?.bindings ?? []) {
    const uri=b.button?.value ?? "";
    if (IRI.test(uri) && !byId.has(uri)) byId.set(uri, {uri, action:b.action?.value??"",icon:b.icon?.value??"",tooltip:b.tooltip?.value??"",url:b.url?.value??""});
  }
  return [...byId.values()];
}
export async function POST(request: Request) {
  const unauthorized = requirePersonalLogin(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as {action?:string; bookmark?:string; provider?:string; tooltip?:string; icon?:string};
    if (body.action === "list") return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
    if (body.action === "remove") {
      if (!body.provider) return NextResponse.json({error:"Provider required"},{status:400});
      await updatePersonalSparql(`DELETE WHERE { GRAPH ${graph(request)} { ${iri(body.provider)} ?p ?o } }`,20000,request);
      return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
    }
    if (body.action !== "add" || !body.bookmark || typeof body.tooltip !== "string" || typeof body.icon !== "string") return NextResponse.json({error:"Bookmark, icon, and tooltip are required"},{status:400});
    const tooltip=body.tooltip.trim(), icon=body.icon.trim();
    if (!tooltip || tooltip.length>120 || !/^[a-z][a-z0-9-]{0,63}$/.test(icon)) return NextResponse.json({error:"Enter a tooltip (1–120 characters) and a Lucide kebab-case icon name"},{status:400});
    // Ensure the action points to an actual saved bookmark, rather than a caller-provided URL.
    const isBookmark=await askPersonalSparql(`ASK { GRAPH ${bookmarks(request)} { ${iri(body.bookmark)} a <${BOOKMARK}> ; <${SCHEMA_URL}> ?url } }`,20000,request);
    if (!isBookmark) return NextResponse.json({error:"The selected bookmark is not saved in the personal graph"},{status:422});
    const existing=await list(request);
    if (existing.some(e=>e.action===body.bookmark)) return NextResponse.json({buttons:existing}, {headers:{"Cache-Control":"no-store"}});
    if (existing.length>=3) return NextResponse.json({error:"Only three bookmark buttons may be added to the appbar"},{status:409});
    const node=iri(`gttp://ggg.maestro.ecosys/appbar/button#${randomUUID()}`);
    await updatePersonalSparql(`INSERT DATA { GRAPH ${graph(request)} { ${node} a <${MUI}AppbarButtonProvider> ; <${MUI}action> ${iri(body.bookmark)} ; <${MUI}tooltip> ${JSON.stringify(tooltip)} ; <${MUI}icon> ${JSON.stringify(icon)} . } }`,20000,request);
    return NextResponse.json({buttons:await list(request)}, {headers:{"Cache-Control":"no-store"}});
  } catch(err) {return NextResponse.json({error:err instanceof Error?err.message:"Appbar provider request failed"},{status:502});}
}
