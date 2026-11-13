/** Standards-based, model-agnostic provider matching.
 *
 * Providers are enumerated solely from rdf:type mui:Provider / mui:accepts.
 * Every eligible shape is evaluated with the same SHACL Core processor used
 * for Record validation. A matching provider does not receive execution
 * authority: mui:status lives in the user's approval named graph.
 */
import { getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { readPolicyApprovals, discoverPolicyApprovals, validPolicyIri } from "@/lib/policy-approval-store";
import { readShaclShapeTriples, validateStandardShaclRows, type ShaclDataTriple, type StandardShaclResult } from "@/lib/shacl-standard-validation";

const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const safeIri = (value: unknown): value is string => validPolicyIri(value);

export type ShaclProviderDefinition = {
  uri: string;
  shape: string;
  widget: string;
  label: string;
  icon: string;
};
export type ShaclProviderMatch = ShaclProviderDefinition & {
  report: StandardShaclResult;
  status: "Pending" | "Approved" | null;
};
export type ShaclProviderValidation = ShaclProviderDefinition & { report: StandardShaclResult };

type Row = Record<string, { value?: string }>;
/** No `perspectiveKind`, URI naming convention, or provider-specific filter. */
export async function listShaclProviderDefinitions(request: Request, widgetType?: string): Promise<ShaclProviderDefinition[]> {
  if (widgetType && !safeIri(widgetType)) throw new Error("Invalid provider widget type.");
  const graph = getShapesGraph(request);
  if (!safeIri(graph)) throw new Error("Invalid personal shapes graph.");
  const query = `PREFIX mui: <${MUI}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>
SELECT DISTINCT ?provider ?shape ?widget ?label ?icon WHERE { GRAPH <${graph}> {
  ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
  ${widgetType ? `?widget a <${widgetType}> .` : ""}
  OPTIONAL { ?provider rdfs:label ?label }
  OPTIONAL { ?provider mui:icon ?icon }
} } ORDER BY ?provider ?shape LIMIT 201`;
  const rows = (await queryPersonalSparql(query, 20000, request)).results?.bindings as Row[] | undefined ?? [];
  if (rows.length > 200) throw new Error("More than 200 SHACL provider bindings; narrow the widget scope.");
  return rows.map(row => ({
    uri: row.provider?.value ?? "", shape: row.shape?.value ?? "",
    widget: row.widget?.value ?? "", label: row.label?.value ?? row.provider?.value ?? "",
    icon: row.icon?.value ?? "",
  })).filter(value => safeIri(value.uri) && safeIri(value.shape) && safeIri(value.widget));
}

/** Evaluate candidate input shapes using the actual SHACL report, not an ASK
 * approximation of provider-specific constraints. Failed/unsupported shapes
 * remain unapproved and are returned as errors rather than silent matches.
 */
export async function matchShaclProviders(
  request: Request,
  focusNode: string,
  triples: ShaclDataTriple[],
  options: { widgetType?: string; queryXml?: string; component?: string; historyUri?: string; discover?: boolean } = {},
): Promise<{ matches: ShaclProviderMatch[]; validations: ShaclProviderValidation[]; failures: Array<{ provider: string; shape: string; error: string }> }> {
  if (!safeIri(focusNode)) throw new Error("A valid SHACL focus-node IRI is required.");
  if (!Array.isArray(triples) || triples.length > 10000) throw new Error("The focus-node RDF data must be a bounded triple list.");
  const candidates = await listShaclProviderDefinitions(request, options.widgetType);
  const shapeCache = new Map<string, Awaited<ReturnType<typeof readShaclShapeTriples>>>();
  const failures: Array<{ provider: string; shape: string; error: string }> = [];
  const validations: ShaclProviderValidation[] = [];
  const conforming: ShaclProviderValidation[] = [];
  // Intentionally bounded and sequential: avoid flooding the personal server
  // with parallel shape-list traversals when many providers share a focus.
  for (const candidate of candidates) {
    try {
      let rows = shapeCache.get(candidate.shape);
      if (!rows) { rows = await readShaclShapeTriples(candidate.shape, request); shapeCache.set(candidate.shape, rows); }
      const report = await validateStandardShaclRows(candidate.shape, focusNode, rows, triples);
      const validated = { ...candidate, report };
      validations.push(validated);
      if (report.conforms) conforming.push(validated);
    } catch (error) {
      failures.push({ provider: candidate.uri, shape: candidate.shape, error: error instanceof Error ? error.message : "SHACL validation failed." });
    }
  }
  const uris = [...new Set(conforming.map(candidate => candidate.uri))];
  // A successful validation is discovery only. It must not approve execution.
  if (options.discover && uris.length && options.queryXml && options.component) {
    await discoverPolicyApprovals(uris, {
      component: options.component, queryXml: options.queryXml, record: focusNode,
      history: options.historyUri,
    }, request);
  }
  const statuses = await readPolicyApprovals(uris, request);
  const byUri = new Map(statuses.map(entry => [entry.uri, entry.status]));
  return { matches: conforming.map(candidate => ({ ...candidate, status: byUri.get(candidate.uri) ?? null })), validations, failures };
}
