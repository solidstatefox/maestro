import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { graphForFile, getUserGraphSite, updatePersonalSparql } from "@/lib/personal-sparql";
import { parseRdfDocument, buildInsertData } from "@/lib/rdf-to-sparql";
import { listChatSurveys, runTranscoder, type OtcLlmActivity, type OtcProgressReporter } from "@/lib/otc-runtime";

export const maxDuration = 300;
const MAX_UPLOAD_BYTES = 700_000;

/** Menu requests only read the personal rules graph; no Qwen calls or file uploads. */
export async function GET(request: Request) {
  const blocked = requirePersonalLogin(request);
  if (blocked) return blocked;
  try {
    const rulesGraph = graphForFile("otc-transcoders.rdf", request);
    return NextResponse.json({ surveys: await listChatSurveys(request, rulesGraph), rulesGraph },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load surveys." }, { status: 400 });
  }
}

/** Chat-only, authenticated OTC entry point. No Personal-store access before the login gate. */
async function processPost(request: Request, report?: OtcProgressReporter) {
  const blocked = requirePersonalLogin(request);
  if (blocked) return blocked;
  const activity: OtcLlmActivity[] = [];
  let temporaryGraph: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const prompt = form.get("prompt");
    const selected = form.get("transcoder");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".ttl")) {
      return NextResponse.json({ error: "Attach a Turtle (.ttl) document to transcode." }, { status: 400 });
    }
    if (typeof prompt !== "string" || !/^transcode\b/i.test(prompt.trim())) {
      return NextResponse.json({ error: "Start the prompt with transcode." }, { status: 400 });
    }
    if (typeof selected !== "string" || !selected) {
      return NextResponse.json({ error: "Select a survey before running Qwen." }, { status: 400 });
    }
    const rulesGraph = graphForFile("otc-transcoders.rdf", request);
    const available = await listChatSurveys(request, rulesGraph);
    if (!available.some(option => option.uri === selected)) {
      return NextResponse.json({ error: "The selected survey is not available in your Personal rules graph." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "The Turtle input must be between 1 byte and 700 KB." }, { status: 413 });
    }
    const namespace = getUserGraphSite(request).replace(/#.*$/, "");
    temporaryGraph = `${namespace}#otc-input-${randomUUID()}`;
    report?.({ step: "select", status: "running", detail: `Parsing uploaded RDF file: ${file.name}` });
    const triples = await parseRdfDocument(await file.text(), ".ttl", temporaryGraph);
    if (!triples.length) throw new Error("The uploaded Turtle contains no RDF triples.");
    await updatePersonalSparql(buildInsertData(temporaryGraph, triples), 30000, request);
    report?.({ step: "select", status: "success", detail: `Loaded ${triples.length} source RDF triples into temporary input graph` });
    // Explicit chat selection: one specialist, no root LLM dispatch and no successor surveys.
    const result = await runTranscoder(request, {
      rulesGraph, transcoder: selected, namespace, source: "personal",
      sourceGraph: temporaryGraph, dryRun: true, instruction: prompt, followSuccessors: false,
    }, activity, report);
    const turtle = result.trace.flatMap(entry => entry.turtle).join("\n\n");
    return NextResponse.json({ ...result, turtle, activity, fileName: file.name,
      rulesGraph, inputGraph: temporaryGraph, transcoder: selected,
      results: [{ transcoder: selected }],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("OTC chat transcoding failed", error);
    const description = error instanceof Error ? error.message : "OTC transcoding failed.";
    report?.({ step: "shacl", status: "error", detail: description });
    const safe = description.replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local path]").slice(0, 360);
    return NextResponse.json({ error: safe, activity, inputGraph: temporaryGraph,
      rulesGraph: graphForFile("otc-transcoders.rdf", request) }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  } finally {
    if (temporaryGraph) {
      report?.({ step: "cleanup", status: "running", detail: "Clearing temporary input graph" });
      try {
        await updatePersonalSparql(`CLEAR GRAPH <${temporaryGraph}>`, 30000, request);
        report?.({ step: "cleanup", status: "success", detail: "Temporary input graph cleared" });
      } catch (error) {
        console.error("OTC temporary input graph cleanup failed", error);
        report?.({ step: "cleanup", status: "error", detail: "Temporary graph cleanup failed; check the server logs" });
      }
    }
  }
}

/** Opt-in newline-delimited event stream so the Chat Terminal updates during transcoding.
 * Non-streaming callers retain the original JSON API. */
export async function POST(request: Request) {
  if (request.headers.get("Accept") !== "application/x-ndjson") return processPost(request);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (data: unknown) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      void (async () => {
        try {
          const response = await processPost(request, (event) => emit({ kind: "progress", event }));
          const result = await response.json();
          emit({ kind: "complete", status: response.status, result });
        } catch (error) {
          emit({ kind: "complete", status: 500, result: { error: error instanceof Error ? error.message : "Transcoding failed" } });
        } finally { controller.close(); }
      })();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
