/** Generic FCT-to-XSLT compiler context. No provider-specific predicates or query plans. */
import { compileFctXmlToSparql } from "@/lib/fct-sparql-translator";
const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Extract the outer SELECT body, preserving nested groups, strings, and IRI tokens.
 * This is a SPARQL scanner, not a regex that truncates at the first closing brace.
 */
export function splitCompiledSelect(sparql: string): { prefix: string; where: string } {
  const match = /\bSELECT\b[\s\S]*?\bWHERE\s*\{/i.exec(sparql);
  if (!match || match.index === undefined) throw new Error("Provider query requires a compiled SELECT.");
  const start = match.index + match[0].length - 1;
  let depth = 0, quote: "'" | '"' | null = null, escaped = false, iri = false, comment = false;
  for (let i = start; i < sparql.length; i++) {
    const c = sparql[i];
    if (comment) { if (c === "\n") comment = false; continue; }
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = null; continue; }
    if (iri) { if (c === ">") iri = false; continue; }
    if (c === "#") { comment = true; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "<" && /[A-Za-z]/.test(sparql[i + 1] ?? "")) { iri = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return { prefix: sparql.slice(0, match.index), where: sparql.slice(start + 1, i) };
  }
  throw new Error("Unclosed outer SELECT WHERE group.");
}

export function providerFctContextXml(queryXml: string, shapeXml: string, shapeUri: string): { xml: string; timeoutMs: number } {
  const compiled = compileFctXmlToSparql(queryXml);
  if (!/^\?[A-Za-z][A-Za-z0-9_]*$/.test(compiled.target)) throw new Error("Provider requires a bound resource focus.");
  const outer = splitCompiledSelect(compiled.query);
  // XML IDs and the live query are passed unchanged; the compiled SPARQL WHERE
  // only supplies the semantic FCT focus to the provider stylesheet.
  const normalizedQuery = queryXml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  const normalizedShape = shapeXml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  const xml = `<mctx:context xmlns:mctx="gttp://ggg.maestro.ui/context"><mctx:compiled target="${escape(compiled.target)}" timeout="${compiled.timeoutMs}"><mctx:prefix>${escape(outer.prefix)}</mctx:prefix><mctx:where>${escape(outer.where)}</mctx:where></mctx:compiled><mctx:query>${normalizedQuery}</mctx:query><mctx:shape uri="${escape(shapeUri)}">${normalizedShape}</mctx:shape></mctx:context>`;
  return { xml, timeoutMs: compiled.timeoutMs };
}
