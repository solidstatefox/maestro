/** Validate browser-supplied generic SPARQL reads before proxy dispatch.
 *
 * `SERVICE` as a standalone SPARQL keyword is forbidden. `?service` and
 * `svc:Service` are ordinary variable/prefixed-name tokens, not federation.
 * Likewise, do not confuse `?load`, `ex:Delete`, etc. with update operators.
 * Keep the existing query-size and SELECT/ASK-only restrictions.
 */
export function isBoundedReadOnlySparql(query: string, maximumQueryLength: number): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > maximumQueryLength ||
      !/^(?:PREFIX\s+[^\n]+\s*)*(?:SELECT|ASK)\b/i.test(trimmed)) return false;

  // Strings and IRI references are data, not SPARQL operators.
  const executable = trimmed.replace(/<[^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  // A keyword must be a complete bare token. Variables and prefixed local
  // names may legitimately contain any of these words.
  return !/(?<![\w?:$])(?:INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|MOVE|COPY|ADD|SERVICE)(?![\w:-])/i.test(executable);
}
