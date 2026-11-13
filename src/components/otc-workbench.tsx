"use client";

import { useEffect, useState } from "react";
import { Parser, Writer, type Quad } from "n3";
import { appendAssistantActivity, type AssistantActivity } from "@/lib/assistant-activity";

export type OtcWorkbenchProps = {
  graphServerLabel: string;
  graphServerUrl: string;
  personalGraphServer: string;
};

type Option = { uri: string; title: string };
type Trace = {
  rule: string;
  rows: number;
  ask?: boolean;
  skippedInvalid?: Array<{ message: string; violations: string[] }>;
};
type OtcResult = {
  ok: boolean;
  dryRun?: boolean;
  published?: boolean;
  runGraph?: string;
  turtle?: string;
  tripleCount?: number;
  reason?: string;
  trace?: Trace[];
};

async function send(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  // Next.js may return an HTML error page (404/500, body-size limits, etc.).
  // Never parse HTML as JSON or expose its contents (which may contain file paths).
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let result: Record<string, unknown>;
  if (contentType.toLowerCase().includes("application/json")) {
    try {
      const decoded: unknown = JSON.parse(text);
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid response format");
      result = decoded as Record<string, unknown>;
    } catch {
      throw new Error(`OTC service returned malformed JSON (HTTP ${response.status}).`);
    }
  } else {
    throw new Error(`OTC service returned HTTP ${response.status} instead of JSON. Check the Maestro server logs for the request to ${path}.`);
  }
  // Persist all survey calls even when a later phase fails and the API returns 400.
  if (Array.isArray(result.activity)) {
    const activity = result.activity.filter((item): item is AssistantActivity => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<AssistantActivity>;
      return typeof candidate.id === "string" && typeof candidate.source === "string"
        && typeof candidate.prompt === "string" && typeof candidate.response === "string"
        && typeof candidate.createdAt === "string"
        && (candidate.status === "success" || candidate.status === "error");
    });
    if (activity.length) {
      // Saving is independent of the UI being mounted: the activity remains in IndexedDB.
      try { await appendAssistantActivity(activity); }
      catch { /* OTC execution must not fail because browser log storage is unavailable. */ }
    }
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your login session is unavailable. Please log in to Maestro again.");
    // Do not pass server exception text (which may include absolute local paths) to the UI.
    const reason = typeof result.error === "string" ? result.error : "OTC request failed";
    const safeReason = reason.replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local path]")
      .slice(0, 450);
    throw new Error(`${safeReason} (HTTP ${response.status})`);
  }
  return result;
}

function writeNTriples(quads: Quad[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads(quads);
    writer.end((error, data) => error ? reject(error) : resolve(data ?? ""));
  });
}

const rootClass = "rounded-lg border bg-card p-4";
const fieldClass = "mt-1 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

export function OtcWorkbench({ graphServerLabel, graphServerUrl, personalGraphServer }: OtcWorkbenchProps) {
  const [loginStatus, setLoginStatus] = useState<"checking" | "authenticated" | "signed-out">("checking");

  useEffect(() => {
    let cancelled = false;
    const checkLogin = async () => {
      // A session-cookie lookup only; this endpoint never contacts the Personal graph server.
      try {
        const response = await fetch("/proxy/api/service?service=maestro&operationId=otc", { method: "GET", cache: "no-store" });
        const body = await response.json() as { authenticated?: boolean };
        if (!cancelled) setLoginStatus(response.ok && body.authenticated ? "authenticated" : "signed-out");
      } catch {
        if (!cancelled) setLoginStatus("signed-out");
      }
    };
    void checkLogin();
    const onFocus = () => { void checkLogin(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, []);

  const [namespace, setNamespace] = useState("");
  const [sourceGraph, setSourceGraph] = useState("");
  const [rulesGraph, setRulesGraph] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [rulesFile, setRulesFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<OtcResult | null>(null);

  const graphBase = () => {
    const value = namespace.trim();
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(value) || value.includes("#") || /[<>"{}|^`\\]/.test(value)) {
      throw new Error("Provide an absolute output namespace IRI without #, spaces, or forbidden characters.");
    }
    return value;
  };
  const process = async (fn: () => Promise<void>) => {
    if (loginStatus !== "authenticated") {
      setError("Log in to use the Personal graph store before running OTC.");
      return;
    }
    setBusy(true); setError("");
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed."); }
    finally { setBusy(false); }
  };

  async function importFiles() {
    const base = graphBase();
    if (!sourceFile || !rulesFile) throw new Error("Choose both the OpenAI RDF Turtle file and the OTC RDF/XML transcoder file.");
    if (!/\.ttl$/i.test(sourceFile.name) || !/\.(rdf|xml)$/i.test(rulesFile.name)) {
      throw new Error("The source must be .ttl and the transcoder must be RDF/XML (.rdf or .xml).");
    }
    if (sourceFile.size > 25_000_000 || rulesFile.size > 600_000) throw new Error("Source must be below 25 MB and rules below 600 KB.");
    const nextRules = `${base}#otc-rules-${crypto.randomUUID()}`;
    const nextSource = `${base}#otc-input-${crypto.randomUUID()}`;
    setResult(null); setOptions([]); setSelected("");
    setStatus("Importing OTC definitions and SHACL validators…");
    const rulesText = await rulesFile.text();
    await send("/proxy/api/service?service=maestro&operationId=otc-import", { action: "append", graph: nextRules, extension: ".rdf", content: rulesText });
    setRulesGraph(nextRules);
    setStatus("Parsing OpenAI chatlog Turtle…");
    const raw = await sourceFile.text();
    const quads = new Parser({ format: "Turtle" }).parse(raw);
    if (quads.length === 0) throw new Error("The uploaded chatlog is empty.");
    if (quads.some((quad) => quad.subject.termType === "BlankNode" || quad.object.termType === "BlankNode" || quad.graph.termType !== "DefaultGraph")) {
      throw new Error("This first importer supports default-graph Turtle without blank nodes. No chatlog data has been imported.");
    }
    for (let i = 0; i < quads.length;) {
      let end = Math.min(i + 200, quads.length);
      let content = await writeNTriples(quads.slice(i, end));
      while (content.length > 400_000 && end > i + 1) {
        end = i + Math.max(1, Math.floor((end - i) / 2));
        content = await writeNTriples(quads.slice(i, end));
      }
      if (content.length > 400_000) throw new Error(`A single RDF triple near index ${i} exceeds the upload budget.`);
      await send("/proxy/api/service?service=maestro&operationId=otc-import", { action: "append", graph: nextSource, extension: ".nt", content });
      i = end;
      setStatus(`Loading chatlog into the Personal graph server: ${i.toLocaleString()} / ${quads.length.toLocaleString()} triples`);
    }
    const verification = await send("/proxy/api/service?service=maestro&operationId=otc-import", { action: "verify", graph: nextSource });
    if (!verification.exists) throw new Error("Chatlog upload finished but its graph could not be verified.");
    setSourceGraph(nextSource);
    const listed = await send("/proxy/api/service?service=maestro&operationId=otc", { action: "list", rulesGraph: nextRules });
    const found = listed.transcoders as Option[];
    if (!Array.isArray(found) || !found.length) throw new Error("No OTC transcoders were found in the imported rules graph.");
    setOptions(found);
    setSelected(found[0].uri);
    setStatus(`Loaded ${quads.length.toLocaleString()} source triples and ${found.length} transcoder(s). Choose one and run a preview.`);
  }

  async function execute(publish: boolean) {
    const base = graphBase();
    if (!sourceGraph || !rulesGraph || !selected) throw new Error("Import both files and select a transcoder first.");
    setStatus(publish ? "Validating and publishing transcoded RDF…" : "Evaluating OTC surveys with Maestro and checking successors…");
    const response = await send("/proxy/api/service?service=maestro&operationId=otc", {
      action: "run", rulesGraph, transcoder: selected, source: "personal", sourceGraph,
      namespace: base, dryRun: !publish,
    });
    const completed = response as OtcResult;
    setResult(completed);
    setStatus(completed.published ? `Published ${completed.tripleCount ?? 0} triples to ${completed.runGraph}` :
      completed.tripleCount ? `Generated ${completed.tripleCount} triples in a dry run. Download the Turtle or publish after review.` :
      completed.reason || "No matching records were transcoded.");
  }

  function download() {
    if (!result?.turtle) return;
    const url = URL.createObjectURL(new Blob([result.turtle], { type: "text/turtle;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "maestro-transcoded-output.ttl";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex w-full flex-col gap-5 text-foreground">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Maestro Transcoder</h1>
          <p className="mt-1 text-sm text-muted-foreground">First pass: OpenAI RDF chatlog → SPARQL target → SHACL validation → Maestro survey → Turtle.</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted-foreground sm:items-end">
          <span className="max-w-full truncate" title={graphServerLabel}>Current graph server: <strong className="text-foreground">{graphServerLabel || "None selected"}</strong></span>
          {graphServerUrl && <span className="max-w-full truncate" title={graphServerUrl}>{graphServerUrl}</span>}
          {loginStatus === "authenticated" && <span className="max-w-full truncate" title={personalGraphServer}>Personal graph server (OTC storage): {personalGraphServer || "Not configured"}</span>}
        </div>
      </header>
      {loginStatus !== "authenticated" ? (
        <section className={rootClass} role="status">
          <p className="text-sm text-muted-foreground">{loginStatus === "checking"
            ? "Checking Maestro login status…"
            : "Log in to Maestro from the user icon on the main page to use the OTC Personal graph store."}</p>
        </section>
      ) : (<>
      <section className={rootClass}>
        <h2 className="font-semibold">1. Choose input files and graph namespace</h2>
        <p className="mt-1 text-sm text-muted-foreground">Requires an active Personal graph server login. The source and rules are imported to new, isolated named graphs. No existing graph is cleared.</p>
        <label className="mt-3 block text-sm">Output graph namespace (without #)
          <input className={fieldClass} placeholder="https://your-domain.example/maestro/transcoding" value={namespace} disabled={busy} onChange={(e) => setNamespace(e.target.value)}/>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">OpenAI RDF chatlog (.ttl)
            <input className={fieldClass} type="file" accept=".ttl,text/turtle" disabled={busy} onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}/>
          </label>
          <label className="block text-sm">OTC transcoder with SHACL (.rdf / .xml)
            <input className={fieldClass} type="file" accept=".rdf,.xml,application/rdf+xml" disabled={busy} onChange={(e) => setRulesFile(e.target.files?.[0] ?? null)}/>
          </label>
        </div>
        <button className={`${buttonClass} mt-4`} type="button" disabled={busy || !sourceFile || !rulesFile} onClick={() => void process(importFiles)}>Import both files</button>
      </section>
      <section className={rootClass}>
        <h2 className="font-semibold">2. Run a transcoder</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each run evaluates up to five selected messages and validates each against the transcoder’s attached SHACL shape. No automatic chaining or watchers.</p>
        <label className="mt-3 block text-sm">Transcoder
          <select className={fieldClass} value={selected} disabled={busy || !options.length} onChange={(e) => setSelected(e.target.value)}>
            {options.length === 0 && <option value="">Import files first</option>}
            {options.map((option) => <option key={option.uri} value={option.uri}>{option.title}</option>)}
          </select>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={buttonClass} type="button" disabled={busy || !selected} onClick={() => void process(() => execute(false))}>Run preview</button>
          <button className={buttonClass} type="button" disabled={busy || !selected} onClick={() => void process(() => execute(true))}>Run and publish to Personal graph</button>
          <button className={buttonClass} type="button" disabled={!result?.turtle || busy} onClick={download}>Download .ttl</button>
        </div>
      </section>
      {(status || error) && <div role="status" className={`${rootClass} text-sm ${error ? "border-destructive text-destructive" : ""}`}>{error || status}</div>}
      {result && <section className={`${rootClass} space-y-3`}>
        <h2 className="font-semibold">3. Output and validation trace</h2>
        {result.runGraph && <p className="break-all text-xs text-muted-foreground">Run graph: {result.runGraph}</p>}
        {result.trace?.map((entry, i) => <div key={`${entry.rule}-${i}`} className="rounded-md border p-3 text-sm">
          <p className="break-all font-medium">{entry.rule}</p>
          <p>{entry.rows} target rows, {entry.skippedInvalid?.length ?? 0} SHACL rejection(s){entry.ask !== undefined ? `, ASK=${entry.ask}` : ""}</p>
          {entry.skippedInvalid?.map((v, k) => <p key={k} className="mt-1 break-all text-xs text-destructive">{v.message}: {v.violations.join("; ")}</p>)}
        </div>)}
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{result.turtle || result.reason || "No output."}</pre>
      </section>}
      </>)}
    </div>
  );
}
