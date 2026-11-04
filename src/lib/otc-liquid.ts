/** Server-only Liquid renderer for OTC RDF templates. Bindings are implicit in otc:query projection. */
import { Liquid } from "liquidjs";

export type LiquidTerm = { type: string; value: string; datatype?: string; "xml:lang"?: string };

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  cache: false,
  jsTruthy: false,
});

function iri(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !/^[a-z][a-z0-9+.-]*:[^\u0000-\u0020<>"{}|^`\\]*$/i.test(value)) {
    throw new Error("OTC rdf_iri requires a valid absolute IRI.");
  }
  return `<${value}>`;
}

engine.registerFilter("rdf_iri", (value: unknown) => iri(value));
engine.registerFilter("rdf_literal", (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("OTC rdf_literal requires a scalar RDF literal value.");
  }
  return JSON.stringify(String(value));
});

/** No filesystem partials or arbitrary code execution: each rule is a self-contained template. */
export async function renderOtcLiquid(template: string, bindings: Record<string, LiquidTerm>): Promise<string> {
  if (template.length > 100_000) throw new Error("OTC Liquid template exceeds the size limit.");
  if (/{%\s*(?:include|render|layout)\b/i.test(template)) {
    throw new Error("OTC Liquid templates may not load filesystem partials or layouts.");
  }
  const context: Record<string, string | boolean> = Object.create(null) as Record<string, string | boolean>;
  for (const [name, term] of Object.entries(bindings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !term || typeof term.value !== "string") {
      throw new Error("Invalid OTC Liquid binding.");
    }
    context[name] = term.value;
    context[`${name}_is_uri`] = term.type === "uri";
  }
  const rendered = await engine.parseAndRender(template, context);
  if (rendered.length > 200_000) throw new Error("OTC Liquid output exceeds the size limit.");
  return rendered;
}
