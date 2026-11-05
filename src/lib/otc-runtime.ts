import { qwenThinkingOptions, type QwenThinkingBudget } from "@/lib/qwen-thinking";
/** OpenLink Transcoder: Liquid templates and bounded, synchronous SHACL-gated successor discovery. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRdfDocument, buildInsertData } from "@/lib/rdf-to-sparql";
import { askPersonalSparql, queryPersonalSparql, updatePersonalSparql, getConfiguredFctEndpoints, personalSparqlUrl, personalSparqlHeaders, assertPersonalSession } from "@/lib/personal-sparql";
import { clearQueryCache } from "@/lib/query-cache";
import { renderOtcLiquid } from "@/lib/otc-liquid";

export const OTC = "gttp://ggg.openlink.sw/nlp/transcoder#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
export type Term = { type: string; value: string; datatype?: string; "xml:lang"?: string };
type Row = Record<string, Term>;
export type OtcRule = { id: string; select: string; target: string; ask: string; query: string; template: string; assumptions: string[]; validator: string };

export function safeIri(value: unknown, field = "IRI"): string {
  if (typeof value !== "string" || value.length > 2048 || !/^[a-z][a-z0-9+.-]*:[^\u0000-\u0020<>"{}|^`\\]*$/i.test(value)) throw new Error(`${field} must be an absolute IRI without forbidden characters.`);
  return value;
}
const ref = (iri: string) => `<${safeIri(iri)}>`;

/** Syntax-only guard, not a general SPARQL security boundary: endpoint permissions are authoritative. */
export function validateReadQuery(source: string, kind: "ASK" | "SELECT"): string {
  const query = source.trim();
  if (!query || query.length > 20000) throw new Error(`Missing or oversized ${kind} query.`);
  // Hide string literals, IRIs and comments before checking operation words.
  const tokens = query.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>]*>|#[^\r\n]*/g, " ");
  let rest = tokens.trim();
  while (/^(?:PREFIX\s+(?:[A-Za-z][\w-]*)?:\s+|BASE\s+)/i.test(rest)) {
    rest = rest.replace(/^(?:PREFIX\s+(?:[A-Za-z][\w-]*)?:\s+|BASE\s+)\s*/i, "").trimStart();
    // The prefix IRI was removed by the scanner; this consumes its declaration only.
  }
  if (!new RegExp(`^${kind}\\b`, "i").test(rest)) throw new Error(`OTC query must be a SPARQL ${kind} query.`);
  if (/\b(?:SERVICE|LOAD|INSERT|DELETE|CLEAR|CREATE|DROP|MOVE|COPY|ADD|WITH|USING|FROM|DESCRIBE|CONSTRUCT|VALUES\s*\{|GRAPH\s*\?)/i.test(rest)) {
    throw new Error("OTC queries may not use updates, SERVICE, dynamic GRAPH variables or dataset redirection.");
  }
  return query;
}

export async function listTranscoders(request: Request, rulesGraph: string) {
  assertPersonalSession(request);
  const query = `PREFIX otc: <${OTC}> PREFIX dcterms: <http://purl.org/dc/terms/> SELECT DISTINCT ?transcoder ?title WHERE { GRAPH ${ref(rulesGraph)} { ?transcoder a otc:Transcoder ; otc:hasRule ?rule . OPTIONAL { ?transcoder dcterms:title ?title } } } LIMIT 100`;
  const result = await queryPersonalSparql(query, 20000, request);
  return (result.results?.bindings ?? []).map((r) => ({ uri: r.transcoder?.value ?? "", title: r.title?.value || r.transcoder?.value || "" }));
}

/** Only specialist surveys are selectable. Listing never calls an LLM. */
export async function listChatSurveys(request: Request, rulesGraph: string) {
  assertPersonalSession(request);
  const query = `PREFIX otc: <${OTC}> PREFIX dcterms: <http://purl.org/dc/terms/>
    SELECT DISTINCT ?transcoder ?title ?description WHERE { GRAPH ${ref(rulesGraph)} {
      ?transcoder a otc:Transcoder ; otc:hasRule ?rule ; otc:validator ?shape .
      OPTIONAL { ?transcoder dcterms:title ?title }
      OPTIONAL { ?transcoder dcterms:description ?description }
    } } ORDER BY ?title LIMIT 50`;
  const result = await queryPersonalSparql(query, 20000, request);
  return (result.results?.bindings ?? []).flatMap((row) => {
    const uri = row.transcoder?.value;
    if (!uri) return [];
    return [{
      uri,
      title: row.title?.value || uri.split('#').pop() || uri,
      description: row.description?.value || '',
    }];
  });
}

export async function loadTranscoder(request: Request, rulesGraph: string, transcoderIri: string): Promise<OtcRule[]> {
  assertPersonalSession(request);
  const query = `PREFIX otc: <${OTC}> SELECT ?rule ?ask ?select ?target ?survey ?template ?assumption ?validator WHERE { GRAPH ${ref(rulesGraph)} { ${ref(transcoderIri)} a otc:Transcoder ; otc:hasRule ?rule . OPTIONAL { ${ref(transcoderIri)} otc:validator ?validator } ?rule otc:select ?select ; otc:query ?survey ; otc:template ?template . OPTIONAL { ?rule otc:target ?target } OPTIONAL { ?rule otc:ask ?ask } OPTIONAL { ?rule otc:assume ?assumption } } } LIMIT 100`;
  const result = await queryPersonalSparql(query, 20000, request);
  const rules = new Map<string, OtcRule>();
  for (const row of result.results?.bindings ?? []) {
    const id = row.rule?.value;
    if (!id || !row.select?.value || !row.survey?.value || !row.template?.value) continue;
    let rule = rules.get(id);
    if (!rule) {
      rule = { id, ask: row.ask?.value || "", select: row.select.value, target: row.target?.value ?? "", query: row.survey.value, template: row.template.value, assumptions: [], validator: row.validator?.value ?? "" };
      rules.set(id, rule);
    }
    if (row.assumption?.value && !rule.assumptions.includes(row.assumption.value)) rule.assumptions.push(row.assumption.value);
  }
  if (rules.size === 0) throw new Error("No runnable OTC rules found for the selected transcoder.");
  if (rules.size > 8) throw new Error("A single run may contain at most eight rules.");
  return [...rules.values()];
}

/** SHACL Core subset used by OTC's per-message validators. Unsupported constraints fail closed. */
type ShapeProperty = {
  path: string;
  minCount: number;
  datatype?: string;
  nodeKind?: string;
  minLength?: number;
  hasValue?: Term;
};
type MessageShape = { iri: string; classes: string[]; properties: ShapeProperty[] };

async function loadMessageShape(request: Request, rulesGraph: string, shapeIri: string): Promise<MessageShape> {
  assertPersonalSession(request);
  const query = `PREFIX sh: <${SH}> SELECT ?class ?property ?path ?minCount ?datatype ?nodeKind ?minLength ?hasValue WHERE { GRAPH ${ref(rulesGraph)} { ${ref(shapeIri)} a sh:NodeShape . OPTIONAL { ${ref(shapeIri)} sh:class ?class } OPTIONAL { ${ref(shapeIri)} sh:property ?property . ?property sh:path ?path . OPTIONAL { ?property sh:minCount ?minCount } OPTIONAL { ?property sh:datatype ?datatype } OPTIONAL { ?property sh:nodeKind ?nodeKind } OPTIONAL { ?property sh:minLength ?minLength } OPTIONAL { ?property sh:hasValue ?hasValue } } } } LIMIT 100`;
  const result = await queryPersonalSparql(query, 20000, request);
  const rows = (result.results?.bindings ?? []) as Row[];
  if (!rows.length) throw new Error(`OTC SHACL validator is missing: ${shapeIri}`);
  const classes = new Set<string>();
  const properties = new Map<string, ShapeProperty>();
  for (const row of rows) {
    if (row.class) classes.add(safeIri(row.class.value, "SHACL class"));
    if (!row.property) continue;
    const id = row.property.value;
    if (!row.path || row.path.type !== "uri") throw new Error("SHACL property shape needs an IRI sh:path.");
    const minCount = row.minCount ? Number(row.minCount.value) : 0;
    const minLength = row.minLength ? Number(row.minLength.value) : undefined;
    if (!Number.isSafeInteger(minCount) || minCount < 0 || (minLength !== undefined && (!Number.isSafeInteger(minLength) || minLength < 0))) throw new Error("Invalid SHACL cardinality/length.");
    if (properties.has(id)) continue;
    properties.set(id, {
      path: safeIri(row.path.value, "SHACL path"), minCount,
      ...(row.datatype ? { datatype: safeIri(row.datatype.value, "SHACL datatype") } : {}),
      ...(row.nodeKind ? { nodeKind: safeIri(row.nodeKind.value, "SHACL node kind") } : {}),
      ...(minLength === undefined ? {} : { minLength }),
      ...(row.hasValue ? { hasValue: row.hasValue } : {}),
    });
  }
  if (!classes.size || !properties.size) throw new Error("OTC SHACL validator has no class or property constraints.");
  for (const constraint of properties.values()) {
    if (constraint.nodeKind && constraint.nodeKind !== `${SH}Literal`) throw new Error("Unsupported SHACL node kind in OTC v1.");
  }
  return { iri: shapeIri, classes: [...classes], properties: [...properties.values()] };
}

function sameTerm(a: Term, b: Term): boolean {
  if (a.type !== b.type || a.value !== b.value) return false;
  if (a.type === "literal" || a.type === "typed-literal") {
    return (a.datatype ?? XSD + "string") === (b.datatype ?? XSD + "string") && (a["xml:lang"] ?? "") === (b["xml:lang"] ?? "");
  }
  return true;
}

async function validateMessageAgainstShape(
  request: Request, shape: MessageShape, focus: Term | undefined,
  source: string, sourceGraph: string | undefined,
): Promise<{ conforms: boolean; violations: string[] }> {
  if (!focus || focus.type !== "uri") return { conforms: false, violations: ["?message must be an IRI focus node"] };
  const predicates = [...new Set([RDF + "type", ...shape.properties.map((p) => p.path)])];
  const query = `SELECT ?p ?v WHERE { ${ref(focus.value)} ?p ?v . FILTER (?p IN (${predicates.map(ref).join(", ")})) }`;
  const { rows } = await sourceSparql(request, query, source, sourceGraph, false);
  const byPredicate = new Map<string, Term[]>();
  for (const row of rows) {
    if (!row.p || !row.v) continue;
    const values = byPredicate.get(row.p.value) ?? [];
    values.push(row.v);
    byPredicate.set(row.p.value, values);
  }
  const violations: string[] = [];
  const types = byPredicate.get(RDF + "type") ?? [];
  for (const requiredClass of shape.classes) {
    if (!types.some((t) => t.type === "uri" && t.value === requiredClass)) violations.push(`Missing rdf:type <${requiredClass}>`);
  }
  for (const constraint of shape.properties) {
    const values = byPredicate.get(constraint.path) ?? [];
    if (values.length < constraint.minCount) violations.push(`${constraint.path}: sh:minCount ${constraint.minCount}`);
    if (constraint.hasValue && !values.some((v) => sameTerm(v, constraint.hasValue!))) violations.push(`${constraint.path}: sh:hasValue not present`);
    for (const value of values) {
      const isLiteral = value.type === "literal" || value.type === "typed-literal";
      if (constraint.nodeKind === SH + "Literal" && !isLiteral) violations.push(`${constraint.path}: expected literal`);
      if (constraint.datatype && (!isLiteral || (value.datatype ?? XSD + "string") !== constraint.datatype || Boolean(value["xml:lang"]))) violations.push(`${constraint.path}: wrong datatype`);
      if (constraint.minLength !== undefined && (!isLiteral || [...value.value].length < constraint.minLength)) violations.push(`${constraint.path}: sh:minLength ${constraint.minLength}`);
    }
  }
  return { conforms: violations.length === 0, violations };
}

async function sourceSparql(request: Request, query: string, source: string, sourceGraph: string | undefined, isAsk: boolean): Promise<{ rows: Row[]; boolean?: boolean }> {
  // OTC always uses the Personal store for rules and output, even if its input is external.
  assertPersonalSession(request);
  // Use a source graph as the protocol's default-graph-uri, not a syntactic rewrite of the rule's query.
  // A rule can still explicitly use GRAPH <iri> when the author wants a named-graph pattern.
  if (!sourceGraph && source === "personal") {
    if (isAsk) return { rows: [], boolean: await askPersonalSparql(query, 20000, request) };
    const result = await queryPersonalSparql(query, 20000, request);
    return { rows: (result.results?.bindings ?? []) as Row[] };
  }
  let endpoint: string;
  let headers: Record<string, string>;
  if (source === "personal") {
    endpoint = personalSparqlUrl(request).toString();
    headers = personalSparqlHeaders(request, "application/x-www-form-urlencoded; charset=UTF-8");
  } else {
    const servers = await getConfiguredFctEndpoints(request);
    const selected = servers.find((server) => server.id === source);
    if (!selected) throw new Error("Source graph server is not in Maestro's configured endpoint registry.");
    endpoint = selected.url;
    // External endpoints get no personal credentials.
    headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" };
  }
  const params = new URLSearchParams({ query });
  if (sourceGraph) params.set("default-graph-uri", safeIri(sourceGraph, "Source graph"));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST", headers, body: params.toString(), cache: "no-store", signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut
      ? `OTC source SPARQL ${isAsk ? "ASK" : "SELECT"} timed out.`
      : `OTC source SPARQL ${isAsk ? "ASK" : "SELECT"} could not connect to the selected graph server.`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`OTC source SPARQL ${isAsk ? "ASK" : "SELECT"} returned HTTP ${response.status}.`);
  if (text.length > 2000000) throw new Error("OTC source SPARQL response exceeded the size limit.");
  const json = JSON.parse(text) as { boolean?: boolean; results?: { bindings?: Row[] } };
  if (isAsk) {
    if (typeof json.boolean !== "boolean") throw new Error("Source endpoint did not return an ASK boolean.");
    return { rows: [], boolean: json.boolean };
  }
  if (!Array.isArray(json.results?.bindings)) throw new Error("Source endpoint did not return SPARQL SELECT bindings.");
  return { rows: json.results.bindings };
}

async function survey(request: Request, rule: OtcRule, row: Row, activity: OtcLlmActivity[], transcoder: string, userRequest?: string, report?: OtcProgressReporter, thinkingBudget: QwenThinkingBudget = 0, cancellationSignal?: AbortSignal): Promise<Row> {
  const key = process.env.ITERACOMPUTE_API_KEY?.trim();
  if (!key) throw new Error("ITERACOMPUTE_API_KEY is required for OTC surveys.");
  // The resource description is supplied as Turtle data, never as executable instructions.
  // Do not send Liquid templates to the model; bindings alone are the model's task.
  const rdfLiteral = (value: string) => JSON.stringify(value);
  const metadataTtl = [
    `@prefix otc: <${OTC}> .`,
    '@prefix dcterms: <http://purl.org/dc/terms/> .',
    '@prefix schema: <http://schema.org/> .',
    '@prefix sh: <http://www.w3.org/ns/shacl#> .',
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    `${ref(transcoder)} a otc:Transcoder ; otc:hasRule _:survey .`,
    `_:survey a otc:Rule ; otc:query ${rdfLiteral(rule.query)} .`,
    ...(rule.ask ? [`_:survey otc:ask ${rdfLiteral(rule.ask)} .`] : []),
    ...(rule.select ? [`_:survey otc:select ${rdfLiteral(rule.select)} .`] : []),
    ...(rule.target ? [`_:survey otc:target ${rdfLiteral(rule.target)} .`] : []),
    ...(rule.validator ? [`${ref(transcoder)} otc:validator ${ref(rule.validator)} .`] : []),
    ...rule.assumptions.map((a) => `_:survey otc:assume ${rdfLiteral(a)} .`),
  ].join("\n");
  const prompt = [
    `Directive: ${OTC}Transcoder`,
    'Transcoder RDF metadata (template intentionally excluded):', metadataTtl,
    `SPARQL input bindings (authoritative): ${JSON.stringify(row)}`,
    `Survey: ${rule.query}`,
    ...(userRequest ? [`User transcode request (context, not a replacement for the survey): ${userRequest.slice(0, 2000)}`] : []),
  ].join("\n\n");
  const skill = await readFile(join(process.cwd(), 'src', 'skills', 'otc-survey-skill.md'), 'utf8');
  const log: OtcLlmActivity = {
    id: randomUUID(), createdAt: new Date().toISOString(),
    source: `OTC / ${transcoder.split("#").pop() || "Transcoder"} / ${rule.id.split("#").pop() || "Survey"}`,
    prompt, response: "", status: "error",
  };
  // Record the prompt before calling the model so connection failures are visible too.
  activity.push(log);
  let response: Response;
  try {
    response = await fetch("https://api.iteracompute.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen/qwen3.8-27b", ...qwenThinkingOptions(thinkingBudget, 1400), stream: true, stream_options: { include_usage: true }, temperature: 0, messages: [{ role: "system", content: skill }, { role: "user", content: prompt }] }),
      cache: "no-store", signal: AbortSignal.any([request.signal, ...(cancellationSignal ? [cancellationSignal] : []), AbortSignal.timeout(120000)]),
    });
  } catch (error) {
    log.response = error instanceof Error && error.name === "TimeoutError"
      ? "IteraCompute request timed out." : "Could not connect to IteraCompute.";
    throw new Error(`OTC survey: ${log.response}`);
  }
  // IteraCompute streams OpenAI-compatible SSE. Output text is buffered until
  // completion; partial JSON is NEVER treated as survey bindings.
  type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
  type Chunk = { choices?: Array<{ delta?: Delta; finish_reason?: string | null; message?: { content?: string } }>; usage?: Usage | null; error?: { message?: string } };
  let raw = "";
  let reasoningText = "";
  let providerUsage: Usage | undefined;
  let ended = false;
  const estimatedInput = Math.ceil((skill.length + prompt.length) / 4);
  const priorUsage = activity.slice(0, -1).reduce((total, entry) => ({
    input: total.input + (entry.usage?.input ?? 0),
    output: total.output + (entry.usage?.output ?? 0),
  }), { input: 0, output: 0 });
  let lastUpdate = 0;
  let lastChars = 0;
  const publish = (force = false) => {
    const now = Date.now();
    const chars = raw.length + reasoningText.length;
    if (!force && now - lastUpdate < 250 && chars - lastChars < 160) return;
    lastUpdate = now;
    lastChars = chars;
    const input = priorUsage.input + (providerUsage?.prompt_tokens ?? estimatedInput);
    const output = priorUsage.output + (providerUsage?.completion_tokens ?? Math.ceil(chars / 4));
    report?.({ step: "qwen", status: "running", rule: rule.id, message: row.message?.value,
      detail: "Receiving streamed model output", live: {
        reasoning: reasoningText.slice(-3000), content: raw.slice(-3000),
        reasoningTokens: Math.ceil(reasoningText.length / 4), thinkingBudget,
        input, output, total: priorUsage.input + priorUsage.output + (providerUsage?.total_tokens ?? ((providerUsage?.prompt_tokens ?? estimatedInput) + (providerUsage?.completion_tokens ?? Math.ceil(chars / 4)))),
        estimated: !providerUsage || providerUsage.total_tokens === undefined,
        phase: raw ? "response" : reasoningText ? "reasoning" : "waiting",
      },
    });
  };
  if (!response.ok) {
    const body = await response.text();
    let explanation = "upstream request failed";
    try { explanation = (JSON.parse(body) as Chunk).error?.message || explanation; } catch { /* no JSON details */ }
    log.response = `IteraCompute HTTP ${response.status}: ${explanation}`;
    throw new Error(`OTC survey: IteraCompute returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("OTC survey returned no streaming response body.");
  publish(true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseEvent = (eventText: string) => {
    const data = eventText.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") { ended = true; return; }
    let chunk: Chunk;
    try { chunk = JSON.parse(data) as Chunk; } catch { throw new Error("OTC survey returned malformed streaming data."); }
    if (chunk.error) throw new Error(`OTC survey: ${chunk.error.message || "stream failed"}`);
    if (chunk.usage) providerUsage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      raw += choice.delta?.content ?? choice.message?.content ?? "";
      reasoningText += choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? "";
    }
    publish();
    // Thinking budgets are advisory when the provider does not enforce them.
    // Continue streaming the survey; the Trace reports live token estimates.
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line, including CRLF line endings.
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        parseEvent(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseEvent(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!ended && !raw.trim()) throw new Error("OTC survey stream ended without a response.");
  if (providerUsage) log.usage = {
    input: providerUsage.prompt_tokens, output: providerUsage.completion_tokens,
    total: providerUsage.total_tokens,
  };
  publish(true);
  raw = raw.trim();
  log.response = raw || "The model returned an empty response.";
  if (!raw) throw new Error("OTC survey returned an empty response.");
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: { bindings?: Record<string, Term> };
  try { parsed = JSON.parse(clean) as { bindings?: Record<string, Term> }; }
  catch { throw new Error("Survey did not return valid binding JSON."); }
  if (!parsed.bindings || !parsed.bindings.resp) throw new Error("Survey did not bind reserved ?resp.");
  const result: Row = { ...row };
  for (const [name, term] of Object.entries(parsed.bindings)) {
    if (!/^[A-Za-z_][\w]*$/.test(name) || name in row) throw new Error(`Survey attempted an invalid or authoritative binding: ?${name}.`);
    if (!term || !["uri", "literal"].includes(term.type) || typeof term.value !== "string" || term.value.length > 12000) throw new Error(`Invalid survey binding ?${name}.`);
    if (term.type === "uri") safeIri(term.value, `?${name}`);
    result[name] = { type: term.type, value: term.value };
  }
  log.status = "success";
  return result;
}

export type OtcProgressEvent = {
  step: "shape" | "ask" | "select" | "shacl" | "qwen" | "liquid" | "cleanup";
  status: "running" | "success" | "warning" | "error";
  detail: string;
  rule?: string;
  shape?: string;
  message?: string;
  violations?: string[];
  counts?: { checked?: number; passed?: number; failed?: number; triples?: number };
  /** Replaces the previous live snapshot in chat; it is not an audit-log row. */
  live?: { reasoning: string; content: string; input: number; output: number; total: number; estimated: boolean; phase: "waiting" | "reasoning" | "response"; reasoningTokens?: number; thinkingBudget?: number };
};
export type OtcProgressReporter = (event: OtcProgressEvent) => void;

export type OtcLlmActivity = {
  id: string;
  createdAt: string;
  source: string;
  prompt: string;
  response: string;
  status: "success" | "error";
  usage?: { input?: number; output?: number; total?: number };
};

export type RunOptions = { rulesGraph: string; transcoder: string; namespace: string; source: string; sourceGraph?: string; dryRun: boolean; instruction?: string; followSuccessors?: boolean; thinkingBudget?: QwenThinkingBudget; cancellationSignal?: AbortSignal };

type SkippedInput = { message: string; violations: string[] };
type RuleTrace = { rule: string; rows: number; turtle: string[]; bindings: Row[]; ask?: boolean; skippedInvalid?: SkippedInput[] };
type SuccessorTrace = { transcoder: string; shape: string; conforms: boolean; ask?: boolean; reason?: string };
type OutputTriple = Awaited<ReturnType<typeof parseRdfDocument>>[number];

/** Execute a selected rule against a preselected RDF dataset. Never interpret the post-output target as an input SELECT. */
async function executeStage(
  request: Request, rulesGraph: string, transcoder: string, rules: OtcRule[],
  source: string, sourceGraph: string | undefined, runGraph: string,
  previousTripleCount: number, activity: OtcLlmActivity[], instruction?: string, report?: OtcProgressReporter, thinkingBudget: QwenThinkingBudget = 0, cancellationSignal?: AbortSignal,
): Promise<{ triples: OutputTriple[]; trace: RuleTrace[] }> {
  const stageTriples: OutputTriple[] = [];
  const trace: RuleTrace[] = [];
  for (const rule of rules) {
    if (!rule.validator) throw new Error(`OTC rule ${rule.id} is missing an input SHACL validator.`);
    report?.({ step: "shape", status: "running", rule: rule.id, shape: rule.validator, detail: "Loading input SHACL shape" });
    let shape: MessageShape;
    try { shape = await loadMessageShape(request, rulesGraph, safeIri(rule.validator, "SHACL validator")); }
    catch (error) { throw new Error(`OTC SHACL shape lookup failed: ${error instanceof Error ? error.message : "unknown error"}`); }
    report?.({ step: "shape", status: "success", rule: rule.id, shape: shape.iri,
      detail: `Loaded SHACL shape: ${shape.classes.length} required class(es), ${shape.properties.length} property constraint(s)` });
    let eligible: boolean | undefined;
    if (rule.ask) {
      try { eligible = (await sourceSparql(request, validateReadQuery(rule.ask, "ASK"), source, sourceGraph, true)).boolean; }
      catch (error) { throw new Error(`OTC input ASK failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      report?.({ step: "ask", status: eligible ? "success" : "warning", rule: rule.id,
        detail: `Input SPARQL ASK: ${eligible ? "true" : "false"}` });
      if (!eligible) { trace.push({ rule: rule.id, rows: 0, turtle: [], bindings: [], ask: false }); continue; }
    }
    let selected: { rows: Row[]; boolean?: boolean };
    try { selected = await sourceSparql(request, validateReadQuery(rule.select, "SELECT"), source, sourceGraph, false); }
    catch (error) { throw new Error(`OTC input SELECT failed: ${error instanceof Error ? error.message : "unknown error"}`); }
    const rows = selected.rows.slice(0, 5);
    report?.({ step: "select", status: "success", rule: rule.id,
      detail: `SPARQL SELECT: ${selected.rows.length} candidate row(s); ${rows.length} within survey limit` });
    report?.({ step: "shacl", status: "running", rule: rule.id, shape: shape.iri,
      detail: `Validating ${rows.length} candidate message(s)`, counts: { checked: 0, passed: 0, failed: 0 } });
    let passed = 0;
    let checked = 0;
    const turtleResults: string[] = [];
    const generatedBindings: Row[] = [];
    const skippedInvalid: SkippedInput[] = [];
    for (const row of rows) {
      let validation: { conforms: boolean; violations: string[] };
      try { validation = await validateMessageAgainstShape(request, shape, row.message, source, sourceGraph); }
      catch (error) { throw new Error(`OTC SHACL input validation failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      checked++;
      if (!validation.conforms) {
        report?.({ step: "shacl", status: "warning", rule: rule.id, shape: shape.iri,
          message: row.message?.value ?? "(unbound)", detail: "Input SHACL violation; message skipped",
          violations: validation.violations, counts: { checked, passed, failed: checked - passed } });
        skippedInvalid.push({ message: row.message?.value ?? "(unbound)", violations: validation.violations });
        continue;
      }
      passed++;
      report?.({ step: "shacl", status: "success", rule: rule.id, shape: shape.iri,
        message: row.message?.value, detail: "Input message conforms to SHACL shape",
        counts: { checked, passed, failed: checked - passed } });
      report?.({ step: "qwen", status: "running", rule: rule.id,
        message: row.message?.value, detail: "Sending validated message to Qwen" });
      const bindings = await survey(request, rule, row, activity, transcoder, instruction, report, thinkingBudget, cancellationSignal);
      report?.({ step: "qwen", status: "success", rule: rule.id,
        message: row.message?.value, detail: "Qwen supplied survey bindings" });
      const turtle = await renderOtcLiquid(rule.template, bindings);
      const parsed = await parseRdfDocument(turtle, ".ttl", runGraph);
      if (!parsed.length) throw new Error("OTC Liquid template produced no RDF triples.");
      if (previousTripleCount + stageTriples.length + parsed.length > 300) {
        throw new Error("OTC run exceeds the 300-triple output budget.");
      }
      // Rename blank nodes as a set so their identity is preserved inside each rendered row.
      const prefix = randomUUID().replaceAll("-", "");

const renameBlankNode = (term: typeof parsed[number]["subject"]) =>
  term.termType === "BlankNode"
    ? {
        termType: "BlankNode",
        value: `${prefix}_${term.value}`,
      }
    : term;

stageTriples.push(
  ...parsed.map((triple) => ({
    subject: renameBlankNode(triple.subject),
    predicate: triple.predicate,
    object: renameBlankNode(triple.object),
  }))
);
      report?.({ step: "liquid", status: "success", rule: rule.id,
        message: row.message?.value, detail: `Liquid rendered ${parsed.length} RDF triple(s)`,
        counts: { triples: parsed.length } });
      turtleResults.push(turtle);
      generatedBindings.push(bindings);
    }
    report?.({ step: "shacl", status: skippedInvalid.length ? "warning" : "success",
      rule: rule.id, shape: shape.iri, detail: `SHACL summary: ${passed}/${checked} passed; ${skippedInvalid.length} skipped`,
      counts: { checked, passed, failed: skippedInvalid.length } });
    trace.push({ rule: rule.id, rows: rows.length, turtle: turtleResults, bindings: generatedBindings, skippedInvalid,
      ...(eligible === undefined ? {} : { ask: eligible }) });
  }
  return { triples: stageTriples, trace };
}

/** Run otc:target only after RDF has been produced; verify the candidate SHACL shape against that RDF. */
async function findSuccessor(
  request: Request, rulesGraph: string, current: string, rules: OtcRule[],
  stageGraph: string, triples: OutputTriple[],
): Promise<{ chosen?: { transcoder: string; rules: OtcRule[] }; checks: SuccessorTrace[] }> {
  const found = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.target.trim()) continue;
    const query = validateReadQuery(rule.target, "SELECT");
    const result = await sourceSparql(request, query, "personal", rulesGraph, false);
    for (const row of result.rows) {
      if (row.nextTranscoder?.type !== "uri" || row.shape?.type !== "uri") {
        throw new Error("otc:target must project ?nextTranscoder and ?shape as IRIs.");
      }
      if (row.nextTranscoder.value !== current) found.set(row.nextTranscoder.value, row.shape.value);
      if (found.size > 50) throw new Error("OTC successor discovery exceeded the 50-candidate limit.");
    }
  }
  const checks: SuccessorTrace[] = [];
  const subjectIris = [...new Set(triples.filter((t) => t.subject.termType === "NamedNode").map((t) => t.subject.value))];
  for (const [transcoder, shapeIri] of [...found.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const successorRules = await loadTranscoder(request, rulesGraph, transcoder);
    // otc:validator is the accepted input shape for this candidate; no unlinked shape may dispatch it.
    if (successorRules.some((r) => r.validator !== shapeIri)) {
      checks.push({ transcoder, shape: shapeIri, conforms: false, reason: "Shape is not linked to successor transcoder." });
      continue;
    }
    const shape = await loadMessageShape(request, rulesGraph, shapeIri);
    let conforms = false;
    for (const subject of subjectIris) {
      const result = await validateMessageAgainstShape(request, shape, { type: "uri", value: subject }, "personal", stageGraph);
      if (result.conforms) { conforms = true; break; }
    }
    if (!conforms) {
      checks.push({ transcoder, shape: shapeIri, conforms: false, reason: "Generated RDF does not conform to successor input shape." });
      continue;
    }
    // The successor's ASK runs over the newly generated graph, not the original source graph.
    let eligible = false;
    for (const rule of successorRules) {
      if (!rule.ask.trim() || (await sourceSparql(request, validateReadQuery(rule.ask, "ASK"), "personal", stageGraph, true)).boolean) {
        eligible = true;
        break;
      }
    }
    checks.push({ transcoder, shape: shapeIri, conforms: true, ask: eligible,
      ...(eligible ? {} : { reason: "Successor ASK returned false; transcoding halted." }) });
    if (eligible) return { chosen: { transcoder, rules: successorRules }, checks };
  }
  return { checks };
}

/** Entry-point dispatcher. Every logged-in root is evaluated; specialist shapes gate actual survey rows. */
export async function runRootTranscoders(
  request: Request, rulesGraph: string, sourceGraph: string,
  namespace: string, activity: OtcLlmActivity[], instruction?: string,
) {
  assertPersonalSession(request);
  const rootQuery = `PREFIX otc: <${OTC}> SELECT ?root ?rule ?ask ?select ?question ?assumption ?shape WHERE {
    GRAPH ${ref(rulesGraph)} { ?root a otc:rootTranscoder ; otc:hasRule ?rule ; otc:dispatchShape ?shape .
    ?rule otc:ask ?ask ; otc:select ?select ; otc:query ?question .
    OPTIONAL { ?rule otc:assume ?assumption }
  } } LIMIT 100`;
  const roots = await queryPersonalSparql(rootQuery, 20000, request);
  const groups = new Map<string, { rule: OtcRule; shapes: Set<string> }>();
  for (const row of (roots.results?.bindings ?? []) as Row[]) {
    if (!row.root?.value || !row.shape?.value || !row.ask?.value || !row.select?.value || !row.question?.value) continue;
    const key = row.root.value + '\u0000' + row.rule?.value;
    let group = groups.get(key);
    if (!group) {
      group = { rule: { id: row.rule?.value ?? row.root.value, ask: row.ask.value,
        select: row.select.value, query: row.question.value, target: '', template: '',
        assumptions: [], validator: '' }, shapes: new Set() };
      groups.set(key, group);
    }
    group.shapes.add(row.shape.value);
    if (row.assumption?.value && !group.rule.assumptions.includes(row.assumption.value)) group.rule.assumptions.push(row.assumption.value);
  }
  if (!groups.size) throw new Error('No otc:rootTranscoder definitions found in the Personal rules graph. Reload graph/otc-transcoders.rdf after login.');
  if (groups.size > 12) throw new Error('Too many OTC root transcoders (maximum 12).');
  const processed = new Set<string>();
  const results: Array<{ root: string; transcoder: string; result: Awaited<ReturnType<typeof runTranscoder>> }> = [];
  const report: string[] = [];
  for (const [key, group] of groups) {
    const rootIri = key.split('\u0000')[0];
    const eligible = (await sourceSparql(request, validateReadQuery(group.rule.ask, 'ASK'), 'personal', sourceGraph, true)).boolean;
    if (!eligible) { report.push(`${rootIri}: ASK false`); continue; }
    const projection = await sourceSparql(request, validateReadQuery(group.rule.select, 'SELECT'), 'personal', sourceGraph, false);
    if (!projection.rows.length) { report.push(`${rootIri}: SELECT empty`); continue; }
    const rootAnswer = await survey(request, group.rule, projection.rows[0], activity, rootIri, instruction);
    if (!['true', 'yes', '1'].includes(rootAnswer.resp.value.trim().toLowerCase())) {
      report.push(`${rootIri}: root survey returned false`); continue;
    }
    const candidateQuery = `PREFIX otc: <${OTC}> SELECT DISTINCT ?transcoder ?shape WHERE {
      GRAPH ${ref(rulesGraph)} { ?transcoder a otc:Transcoder ; otc:validator ?shape ; otc:hasRule ?rule . }
    } LIMIT 100`;
    const candidates = await queryPersonalSparql(candidateQuery, 20000, request);
    for (const row of (candidates.results?.bindings ?? []) as Row[]) {
      const candidate = row.transcoder?.value;
      if (!candidate || !row.shape?.value || !group.shapes.has(row.shape.value) || processed.has(candidate)) continue;
      processed.add(candidate);
      const result = await runTranscoder(request, { rulesGraph, transcoder: candidate,
        namespace, source: 'personal', sourceGraph, dryRun: true, instruction }, activity);
      results.push({ root: rootIri, transcoder: candidate, result });
    }
  }
  const turtle = results.flatMap(({ result }) => result.trace.flatMap((entry) => entry.turtle)).join('\n\n');
  return { ok: true, rootsChecked: groups.size, results, report, turtle,
    tripleCount: results.reduce((n, entry) => n + ("tripleCount" in entry.result ? (entry.result.tripleCount ?? 0) : 0), 0) };
}

export async function runTranscoder(request: Request, options: RunOptions, activity: OtcLlmActivity[] = [], report?: OtcProgressReporter) {
  assertPersonalSession(request);
  safeIri(options.rulesGraph, "Rules graph");
  safeIri(options.transcoder, "Transcoder");
  safeIri(options.namespace, "Output namespace");
  if (options.namespace.includes("#")) throw new Error("Output namespace must not already contain a fragment (#).");
  if (options.sourceGraph) safeIri(options.sourceGraph, "Source graph");
  const runGraph = `${options.namespace}#${randomUUID()}`;
  const trace: RuleTrace[] = [];
  const successors: SuccessorTrace[] = [];
  const triples: OutputTriple[] = [];
  const stagingGraphs: string[] = [];
  let current = options.transcoder;
  let rules = await loadTranscoder(request, options.rulesGraph, current);
  let source = options.source;
  let sourceGraph = options.sourceGraph;
  try {
    // One successor hop (two stages maximum); no polling, events, or automatic subscribers.
    for (let depth = 0; depth < 2; depth++) {
      const output = await executeStage(request, options.rulesGraph, current, rules, source, sourceGraph, runGraph, triples.length, activity, options.instruction, report, options.thinkingBudget, options.cancellationSignal);
      trace.push(...output.trace);
      triples.push(...output.triples);
      if (!output.triples.length || depth === 1 || options.followSuccessors === false || !rules.some((r) => r.target.trim())) break;
      // Dry runs temporarily stage RDF for Virtuoso-based SPARQL/SHACL successor checks.
      // The finally block deletes these graphs, including after failures or ASK=false.
      const stageGraph = `${options.namespace}#otc-stage-${randomUUID()}`;
      stagingGraphs.push(stageGraph);
      await updatePersonalSparql(buildInsertData(stageGraph, output.triples), 30000, request);
      const next = await findSuccessor(request, options.rulesGraph, current, rules, stageGraph, output.triples);
      successors.push(...next.checks);
      if (!next.chosen) break;
      current = next.chosen.transcoder;
      rules = next.chosen.rules;
      source = "personal";
      sourceGraph = stageGraph;
    }
  } finally {
    for (const graph of stagingGraphs.reverse()) {
      // Avoid leaving private intermediate output in the Personal store, even for previews.
      await updatePersonalSparql(`CLEAR GRAPH ${ref(graph)}`, 30000, request);
    }
  }
  if (!triples.length) return { ok: true, published: false, reason: "No eligible or SHACL-valid input rows.", trace, successors };
  if (options.dryRun) return { ok: true, published: false, dryRun: true, runGraph, tripleCount: triples.length, trace, successors };
  if (await askPersonalSparql(`ASK WHERE { GRAPH ${ref(runGraph)} { ?s ?p ?o } }`, 20000, request)) {
    throw new Error("The destination OTC output graph is not empty; refusing to overwrite it.");
  }
  await updatePersonalSparql(buildInsertData(runGraph, triples), 30000, request);
  const verified = await askPersonalSparql(`ASK WHERE { GRAPH ${ref(runGraph)} { ?s ?p ?o } }`, 20000, request);
  if (!verified) throw new Error("OTC output was submitted but could not be verified in the destination graph.");
  clearQueryCache();
  return { ok: true, published: true, runGraph, tripleCount: triples.length, trace, successors };
}
