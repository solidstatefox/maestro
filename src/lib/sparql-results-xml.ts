import { rdfBindingKind } from "@/lib/bnode";
/** Standard W3C SPARQL Results XML, shared by the browser query bridge and SHACL shape transport. */
export function sparqlBindingsToXml(payload: {
  head?: { vars?: string[] };
  boolean?: boolean;
  results?: { bindings?: Record<string, { type?: string; value?: string; datatype?: string; "xml:lang"?: string }>[] };
}): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const NS = "http://www.w3.org/2005/sparql-results#";
  const vars = payload.head?.vars ?? [...new Set((payload.results?.bindings ?? []).flatMap(row => Object.keys(row)))];
  const head = `<head>${vars.map(name => `<variable name="${escape(name)}"/>`).join("")}</head>`;
  if (typeof payload.boolean === "boolean")
    return `<sparql xmlns="${NS}">${head}<boolean>${payload.boolean}</boolean></sparql>`;
  const rows = (payload.results?.bindings ?? []).map(row => `<result>${vars.flatMap(name => {
    const binding = row[name];
    if (!binding || typeof binding.value !== "string") return [];
    const type = rdfBindingKind(binding.type);
    const attrs = type === "literal" ? `${binding.datatype ? ` datatype="${escape(binding.datatype)}"` : ""}${binding["xml:lang"] ? ` xml:lang="${escape(binding["xml:lang"])}"` : ""}` : "";
    return [`<binding name="${escape(name)}"><${type}${attrs}>${escape(binding.value)}</${type}></binding>`];
  }).join("")}</result>`).join("");
  return `<sparql xmlns="${NS}">${head}<results>${rows}</results></sparql>`;
}
