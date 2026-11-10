/** Maestro's application-owned SaxonJS XSLT execution layer.
 * No native browser XSLT engine, round-trip XML upload, or server-side
 * template execution endpoint is involved in client rendering.
 */
// Saxonica's browser distribution is a classic script, not an ES module.
// Wrapping it with an appended ESM export lets Turbopack change the runtime's
// global scope and has caused ReferenceError: Resources is not defined.
// The root layout loads the unmodified distribution before SPA hydration.
// Only this Maestro-owned module knows about its JavaScript API.
type MaestroSaxonRuntime = {
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

const FORBIDDEN_FUNCTIONS = /\b(?:doc|doc-available|document|collection|uri-collection|unparsed-text(?:-lines|-available)?|json-doc|environment-variable|available-environment-variables|function-lookup|load-xquery-module|transform|resolve-uri|static-base-uri)\s*\(/i;
const FORBIDDEN_INSTRUCTIONS = /<\s*xsl:(?:include|import|import-schema|use-package|result-document|evaluate|fork|source-document|stream|package)\b/i;
const FORBIDDEN_OUTPUT = /<\s*(?:script|iframe|object|embed)\b/i;
const FORBIDDEN_EXTENSIONS = /(?:http:\/\/saxon\.sf\.net\/|http:\/\/saxonica\.com|\b(?:java|javascript|ixsl):)/i;

export async function transformWithMaestroSaxon(
  stylesheetText: string,
  sourceXml: string,
  options: { recordUri?: string; outputLimit?: number; signal?: AbortSignal } = {},
): Promise<string> {
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  if (stylesheetText.length > 250000 || XMLValidator.validate(stylesheetText) !== true ||
      !stylesheetText.includes("http://www.w3.org/1999/XSL/Transform") ||
      !/<(?:[\w.-]+:)?(?:stylesheet|transform)\b/.test(stylesheetText)) {
    throw new Error("Invalid or oversized Maestro XSLT stylesheet.");
  }
  if (FORBIDDEN_FUNCTIONS.test(stylesheetText) || FORBIDDEN_INSTRUCTIONS.test(stylesheetText) || FORBIDDEN_EXTENSIONS.test(stylesheetText) || FORBIDDEN_OUTPUT.test(stylesheetText)) {
    throw new Error("External resource access and extensions are not permitted in Maestro templates.");
  }
  if (XMLValidator.validate(sourceXml) !== true) throw new Error("Invalid Maestro transformation input XML.");
  const saxon = await getSaxon();
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  const result = saxon.XPath.evaluate(`transform(map {
    'stylesheet-text': $stylesheet,
    'source-node': parse-xml($source),
    'stylesheet-params': map { QName('', 'recordUri'): $recordUri },
    'delivery-format': 'serialized'
  })?output`, null, { params: { stylesheet: stylesheetText, source: sourceXml, recordUri: options.recordUri ?? "" } });
  if (options.signal?.aborted) throw new DOMException("Transformation canceled", "AbortError");
  // SaxonJS may return a singleton sequence, depending on the XPath runtime.
  const value = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (typeof value !== "string") {
    throw new Error(`Maestro SaxonJS returned ${value === null ? "null" : typeof value} instead of serialized text.`);
  }
  const limit = options.outputLimit ?? 24_000_000;
  if (value.length > limit) {
    throw new Error(`Maestro SaxonJS output exceeds ${Math.round(limit / 1_000_000)} MB (${Math.round(value.length / 1_000_000)} MB generated).`);
  }
  return value;
}
