import { NextResponse } from "next/server";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { safeIri } from "@/lib/otc-runtime";
import { parseRdfDocument, buildInsertData } from "@/lib/rdf-to-sparql";
import { askPersonalSparql, updatePersonalSparql } from "@/lib/personal-sparql";

const MAX_CONTENT_LENGTH = 600_000;
const ALLOWED_EXTENSIONS = new Set([".rdf", ".xml", ".nt"]);

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Imports OTC source triples and rule definitions to a caller-selected Personal named graph. */
export async function POST(request: Request) {
  const blocked = requirePersonalLogin(request);
  if (blocked) return blocked;

  let input: Record<string, unknown>;
  try {
    // Bound the request size before parsing. Individual Turtle batches are sent as N-Triples.
    const declaredSize = Number(request.headers.get("content-length") ?? "0");
    if (declaredSize > MAX_CONTENT_LENGTH * 2) {
      return jsonError("OTC import batch is too large.", 413);
    }
    const raw = await request.text();
    if (raw.length > MAX_CONTENT_LENGTH * 2) {
      return jsonError("OTC import batch is too large.", 413);
    }
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return jsonError("Invalid OTC import request.", 400);
    }
    input = decoded as Record<string, unknown>;
  } catch {
    return jsonError("Invalid OTC import JSON.", 400);
  }

  let graph: string;
  try {
    graph = safeIri(input.graph, "Import graph");
  } catch {
    return jsonError("Invalid OTC import graph IRI.", 400);
  }

  if (input.action === "verify") {
    try {
      const exists = await askPersonalSparql(
        `ASK WHERE { GRAPH <${graph}> { ?s ?p ?o } }`, 20000, request,
      );
      return NextResponse.json({ exists }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("OTC import verification failed", error);
      return jsonError("Could not verify the imported OTC graph. Check the Maestro server logs.", 502);
    }
  }

  if (input.action !== "append") {
    return jsonError("Expected OTC import action append or verify.", 400);
  }

  const extension = input.extension;
  const content = input.content;
  if (typeof extension !== "string" || !ALLOWED_EXTENSIONS.has(extension.toLowerCase())) {
    return jsonError("OTC import accepts RDF/XML (.rdf or .xml) and N-Triples (.nt).", 400);
  }
  if (typeof content !== "string" || !content.trim() || content.length > MAX_CONTENT_LENGTH) {
    return jsonError("OTC import content is empty or too large.", 413);
  }

  let triples: Awaited<ReturnType<typeof parseRdfDocument>>;
  try {
    triples = await parseRdfDocument(content, extension, graph);
    if (!triples.length) return jsonError("The OTC import contains no RDF triples.", 400);
  } catch (error) {
    console.error("OTC RDF parsing failed", error);
    return jsonError("Could not parse the OTC RDF document. Check the file syntax and server logs.", 400);
  }

  let update: string;
  try {
    update = buildInsertData(graph, triples);
  } catch (error) {
    console.error("OTC SPARQL update construction failed", error);
    return jsonError("Could not prepare the OTC RDF batch for import.", 413);
  }

  try {
    await updatePersonalSparql(update, 30000, request);
    return NextResponse.json({ ok: true, graph, tripleCount: triples.length }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("OTC Personal graph import failed", error);
    return jsonError("The Personal graph server could not import the OTC RDF batch. Check the Maestro server logs.", 502);
  }
}
