import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getHistoryGraph, updatePersonalSparql } from "@/lib/personal-sparql";

const safeIri = (value: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(value);

export async function POST(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    const body = await request.json() as { kind?: unknown; ids?: unknown };
    if (body.kind !== "bookmarks" && body.kind !== "history") return NextResponse.json({ error: "Unknown collection" }, { status: 400 });
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && safeIri(id)))].slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ deleted: 0 });
    const base = getHistoryGraph(request).split("#",1)[0];
    if (!safeIri(base)) throw new Error("Invalid personal graph");
    const graph = `<${base}#${body.kind}>`;
    const type = body.kind === "bookmarks" ? "<http://www.w3.org/2002/01/bookmark#Bookmark>" : "<https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#QueryHistoryVisit>";
    // Delete only records with the expected type in this user's own collection graph.
    await updatePersonalSparql(`DELETE { GRAPH ${graph} { ?entry ?predicate ?object } }
      WHERE { VALUES ?entry { ${ids.map(id => `<${id}>`).join(" ")} }
        GRAPH ${graph} { ?entry a ${type} ; ?predicate ?object . } }`, 30000, request);
    return NextResponse.json({ deleted: ids.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Deletion failed" }, { status: 500 });
  }
}
