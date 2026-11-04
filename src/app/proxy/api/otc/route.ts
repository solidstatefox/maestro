import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { getPersonalSession } from "@/lib/personal-sparql";
import { listTranscoders, runTranscoder, safeIri, type OtcLlmActivity } from "@/lib/otc-runtime";
import { parseRdfDocument, buildInsertData } from "@/lib/rdf-to-sparql";
import { askPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Read only the existing login cookie. Never connect to Personal SPARQL on this request. */
export async function GET(request: Request) {
  return NextResponse.json({ authenticated: Boolean(getPersonalSession(request)) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** Explicit OTC execution: SHACL-gated Liquid templates and up to one synchronous successor hop. */
export async function POST(request: Request) {
  const blocked = requirePersonalLogin(request);
  if (blocked) return blocked;
  const activity: OtcLlmActivity[] = [];
  try {
    if (Number(request.headers.get("content-length") || 0) > 20000) throw new Error("OTC request is too large.");
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const rulesGraph = safeIri(body.rulesGraph, "Rules graph");
    if (action === "list") {
      return NextResponse.json({ transcoders: await listTranscoders(request, rulesGraph) });
    }
    if (action === "seed") {
      // Never seed implicitly: a logged-in user explicitly chooses the destination rules graph.
      const rdf = await readFile(resolve(process.cwd(), "graph", "otc-transcoders.rdf"), "utf8");
      const triples = await parseRdfDocument(rdf, ".rdf", rulesGraph);
      if (!triples.length) throw new Error("No OTC rules to seed.");
      if (await askPersonalSparql(`ASK WHERE { GRAPH <${rulesGraph}> { ?s ?p ?o } }`, 20000, request)) {
        throw new Error("Rules graph is not empty. Refusing to overwrite or duplicate existing rules.");
      }
      await updatePersonalSparql(buildInsertData(rulesGraph, triples), 30000, request);
      if (!await askPersonalSparql(`ASK WHERE { GRAPH <${rulesGraph}> { ?s ?p ?o } }`, 20000, request)) throw new Error("Seed was not visible after writing.");
      return NextResponse.json({ ok: true, seeded: true, graph: rulesGraph, tripleCount: triples.length });
    }
    if (action === "run") {
      const result = await runTranscoder(request, {
        rulesGraph,
        transcoder: safeIri(body.transcoder, "Transcoder"),
        namespace: safeIri(body.namespace, "Output namespace"),
        source: typeof body.source === "string" ? body.source : "personal",
        sourceGraph: typeof body.sourceGraph === "string" ? safeIri(body.sourceGraph, "Source graph") : undefined,
        dryRun: body.dryRun === true,
      }, activity);
      return NextResponse.json({ ...result, activity });
    }
    return NextResponse.json({ error: "Expected OTC action list, seed, or run." }, { status: 400 });
  } catch (error) {
    // Never include stack traces, credentials or local filesystem paths in API errors.
    const message = (error instanceof Error ? error.message : "OTC operation failed.")
      .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local path]")
      .slice(0, 450);
    return NextResponse.json({ error: message, activity }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
}
