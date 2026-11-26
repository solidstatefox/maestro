/** Maestro's application-owned SaxonJS XSLT execution layer.
 * No native browser XSLT engine, round-trip XML upload, or server-side
 * template execution endpoint is involved in client rendering.
 */
// Saxonica's browser distribution is a classic script, not an ES module.
// Wrapping it with an appended ESM export lets Turbopack change the runtime's
// global scope and has caused ReferenceError: Resources is not defined.
// The root layout loads the unmodified distribution before SPA hydration.
// Only this Maestro-owned module knows about its JavaScript API.
import { reportRecordPerformance } from "@/lib/record-performance";
import { readVerifiedBuildArtifact, sha256Hex } from "@/lib/verified-artifact-cache";
type MaestroSaxonRuntime = {
  transform?: (options: { stylesheetInternal: object; sourceText: string; destination: "serialized";
    stylesheetParams: Record<string, string> }, mode: "async") => Promise<{ principalResult?: unknown }>;
  XPath: { evaluate: (expression: string, contextItem: null, options: { params: Record<string, string> }) => unknown };
};
declare global {
  interface Window { SaxonJS?: MaestroSaxonRuntime }
}
// The application layout loads Saxonica's unmodified classic-script runtime
// before SPA hydration. All Maestro consumers share this single resolved handle.
let saxonRuntimePromise: Promise<MaestroSaxonRuntime> | null = null;
async function getSaxon(): Promise<MaestroSaxonRuntime> {
  if (typeof window === "undefined") throw new Error("Maestro SaxonJS requires the browser SPA.");
  if (!saxonRuntimePromise) {
    saxonRuntimePromise = Promise.resolve().then(() => {
      const runtime = window.SaxonJS;
      if (!runtime?.XPath?.evaluate) {
        throw new Error("Maestro browser SaxonJS is not loaded. Verify public/vendor/saxon-js/SaxonJS2.js is installed.");
      }
      return runtime;
    }).catch((error: unknown) => {
      // A missing asset should not poison future calls if it becomes available.
      saxonRuntimePromise = null;
      throw error;
    });
  }
  return saxonRuntimePromise;
}

import { XMLValidator } from "fast-xml-parser";

// Source validation and the static manifest are independently cached, not
// bound to a query or a session. Both caches have bounded size and no RDF data.
const validatedStylesheets = new Set<string>();
let sefManifestPromise: Promise<{sourceSha256:string;assetSha256:string;asset:string}|null>|null = null;
let sefUnavailable = false;
let compiledArtifact: {digest:string;promise:Promise<string>}|null=null;
async function verifiedFirstPartySef(stylesheetText: string): Promise<object | null> {
  if (sefUnavailable || typeof crypto?.subtle === "undefined") return null;
  // The current manifest is trusted build metadata, never a provider-supplied
  // executable URL. Both source and compiled bytes must match exactly.
  sefManifestPromise ??= fetch("/maestro-sef/manifest.json", { cache: "no-cache", signal:AbortSignal.timeout(5000) })
    .then(async response => response.ok ? await response.json() as {format?:number;sourceSha256?:string;assetSha256?:string;asset?:string} : null)
    .then(info => info?.format === 2 && /^\/maestro-sef\/[a-z0-9._-]+\.json$/.test(info.asset ?? "") &&
      /^[a-f0-9]{64}$/.test(info.sourceSha256 ?? "") && /^[a-f0-9]{64}$/.test(info.assetSha256 ?? "")
      ? {sourceSha256:info.sourceSha256!,assetSha256:info.assetSha256!,asset:info.asset!} : null)
    .catch(() => null);
  const manifest = await sefManifestPromise;
  if (!manifest || await sha256Hex(new TextEncoder().encode(stylesheetText)) !== manifest.sourceSha256) return null;
  if(compiledArtifact?.digest!==manifest.assetSha256){
    const promise=readVerifiedBuildArtifact(manifest.asset,manifest.assetSha256);
    compiledArtifact={digest:manifest.assetSha256,promise};
  }
  try{
    // Parse a fresh object for SaxonJS; a transformation must not mutate the
    // cached serialized SEF used by another invocation.
    const parsed:unknown=JSON.parse(await compiledArtifact.promise);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Invalid compiled XSLT artifact.");
    return parsed;
  }catch{compiledArtifact=null;return null;}
}

const FORBIDDEN_FUNCTIONS = /\b(?:doc|doc-available|document|collection|uri-collection|unparsed-text(?:-lines|-available)?|json-doc|environment-variable|available-environment-variables|function-lookup|load-xquery-module|transform|resolve-uri|static-base-uri)\s*\(/i;
const FORBIDDEN_INSTRUCTIONS = /<\s*xsl:(?:include|import|import-schema|use-package|result-document|evaluate|fork|source-document|stream|package)\b/i;
const FORBIDDEN_OUTPUT = /<\s*(?:script|iframe|object|embed)\b/i;
const FORBIDDEN_EXTENSIONS = /(?:http:\/\/saxon\.sf\.net\/|http:\/\/saxonica\.com|\b(?:java|javascript|ixsl):)/i;

export async function transformWithMaestroSaxon(
  stylesheetText: string,
  sourceXml: string,
  options: { recordUri?: string; outputLimit?: number; signal?: AbortSignal; providerExecutableMarkup?: boolean; sandboxPhase?: "queries" } = {},
): Promise<string> {
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  const validationStarted = performance.now();
  if (stylesheetText.length > 250000 ||
      (!validatedStylesheets.has(stylesheetText) && XMLValidator.validate(stylesheetText) !== true) ||
      !stylesheetText.includes("http://www.w3.org/1999/XSL/Transform") ||
      !/<(?:[\w.-]+:)?(?:stylesheet|transform)\b/.test(stylesheetText)) {
    throw new Error("Invalid or oversized Maestro XSLT stylesheet.");
  }
  if (FORBIDDEN_FUNCTIONS.test(stylesheetText) || FORBIDDEN_INSTRUCTIONS.test(stylesheetText) || FORBIDDEN_EXTENSIONS.test(stylesheetText) || (!options.providerExecutableMarkup && FORBIDDEN_OUTPUT.test(stylesheetText))) {
    throw new Error("External resource access and extensions are not permitted in Maestro templates.");
  }
  if (!validatedStylesheets.has(stylesheetText)) {
    if (validatedStylesheets.size >= 8) validatedStylesheets.delete(validatedStylesheets.values().next().value!);
    validatedStylesheets.add(stylesheetText);
  }
  if (XMLValidator.validate(sourceXml) !== true) throw new Error("Invalid Maestro transformation input XML.");
  reportRecordPerformance("xslt-input-validation", validationStarted);
  const saxon = await getSaxon();
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  // A pinned first-party stylesheet can use its build-time SEF without
  // compiling XSLT source on every warm Record. Dynamic provider stylesheets
  // remain on the existing checked, sandboxed source-XSLT implementation.
  if (saxon.transform && !sefUnavailable) {
    const verified = await verifiedFirstPartySef(stylesheetText).catch(() => null);
    options.signal?.throwIfAborted();
    if (verified) {
      const started = performance.now();
      try {
        const compiled = await saxon.transform({ stylesheetInternal: verified, sourceText: sourceXml,
          destination: "serialized", stylesheetParams: {
            recordUri: options.recordUri ?? "", maestroPhase: options.sandboxPhase ?? "render",
          } }, "async");
        if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
        const output = compiled.principalResult;
        if (typeof output === "string" && output.length <= (options.outputLimit ?? 24_000_000)) {
          reportRecordPerformance("xslt-compiled-sef-render", started, options.sandboxPhase ?? "render");
          return output;
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // One incompatible SEF disables this optimization for the session.
        // Never break the existing supported dynamic XSLT path.
        sefUnavailable = true;
      }
      sefUnavailable = true;
      reportRecordPerformance("xslt-sef-fallback", started);
    }
  }
  const dynamicStarted = performance.now();
  const result = saxon.XPath.evaluate(`transform(map {
    'stylesheet-text': $stylesheet,
    'source-node': parse-xml($source),
    'stylesheet-params': map { QName('', 'recordUri'): $recordUri ${options.sandboxPhase ? ", QName('', 'maestroPhase'): $maestroPhase" : ""} },
    'delivery-format': 'serialized'
  })?output`, null, { params: { stylesheet: stylesheetText, source: sourceXml, recordUri: options.recordUri ?? "", maestroPhase: options.sandboxPhase ?? "" } });
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  // SaxonJS may return a singleton sequence, depending on the XPath runtime.
  const value = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (typeof value !== "string") {
    throw new Error(`Maestro SaxonJS returned ${value === null ? "null" : typeof value} instead of serialized text.`);
  }
  reportRecordPerformance("xslt-dynamic-transform-including-compile", dynamicStarted, options.sandboxPhase ?? "render");
  const limit = options.outputLimit ?? 24_000_000;
  if (value.length > limit) {
    throw new Error(`Maestro SaxonJS output exceeds ${Math.round(limit / 1_000_000)} MB (${Math.round(value.length / 1_000_000)} MB generated).`);
  }
  return value;
}

/** Convert JSON into the W3C XPath `json-to-xml` representation using the
 * same browser SaxonJS distribution as every other Maestro XSLT operation.
 * Do not import the `saxon-js` npm package here: it is the Node distribution.
 */
export async function saxonJsonToXml(json: string): Promise<string> {
  const saxon = await getSaxon();
  const result = saxon.XPath.evaluate(
    "serialize(json-to-xml($json), map { 'method': 'xml', 'omit-xml-declaration': true() })",
    null,
    { params: { json } },
  );
  const serialized = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (typeof serialized !== "string") throw new Error("SaxonJS JSON-to-XML conversion returned a non-string result.");
  return serialized;
}
