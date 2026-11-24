/** Validate browser-supplied generic SPARQL reads before proxy dispatch.
 *
 * `SERVICE` as a standalone SPARQL keyword is forbidden. `?service` and
 * `svc:Service` are ordinary variable/prefixed-name tokens, not federation.
 * Likewise, do not confuse `?load`, `ex:Delete`, etc. with update operators.
 * Keep the existing query-size and SELECT/ASK-only restrictions.
 */
export function isBoundedReadOnlySparql(query: string, maximumQueryLength: number): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > maximumQueryLength) return false;
  // The FCT and Count compilers emit standard Virtuoso DEFINE input options.
  // Permit ONLY these two quoted, generated directives before SELECT/ASK;
  // never allow arbitrary DEFINE sql:... or update/federation operations.
  // Parse only complete PREFIX declarations (prefix name + IRI). An older
  // line-based matcher swallowed SELECT whenever a query wrote PREFIX and
  // SELECT on the SAME line, as History query SHACL discovery does. SPARQL
  // permits arbitrary whitespace between declarations and the query verb.
  // Keep the DEFINE allowlist unchanged: never accept arbitrary directives.
  // The Record Kinds inspector starts with two diagnostic comment lines.
  // SPARQL allows such leading comments: strip ONLY complete leading comment
  // lines for the safety gate; forward the original query unchanged.
  const withoutHeaderComments = trimmed.replace(/^(?:#[^\r\n]*(?:\r?\n|$)\s*)+/, "");
  const withoutSafeDirectives = withoutHeaderComments.replace(
    /^(?:(?:DEFINE\s+input:(?:inference|same-as)\s+"(?:\\.|[^"\\])*"\s*)|(?:PREFIX\s+(?:[A-Za-z_][\w.-]*)?:\s*<[^<>\s]*>\s*))+/i,
    "",
  );
  if (!/^(?:SELECT|ASK)\b/i.test(withoutSafeDirectives)) return false;

  // Strings and IRI references are data, not SPARQL operators.
  const executable = withoutHeaderComments.replace(/<[^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  // A keyword must be a complete bare token. Variables and prefixed local
  // names may legitimately contain any of these words.
  return !/(?<![\w?:$])(?:INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|MOVE|COPY|ADD|SERVICE)(?![\w:-])/i.test(executable);
}
