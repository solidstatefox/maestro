import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureShapesGraphSeeded, getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { logProxyCaller } from "@/lib/proxy-debug-server";
import { proxyFailure, proxyLog } from "@/lib/maestro-logger";
import { requirePersonalLogin } from "@/lib/personal-guard";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH = "http://www.w3.org/ns/shacl#";
const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";

type Binding = { type?: string; value?: string; datatype?: string };
type BindingRow = Record<string, Binding>;
type RecordTriple = { subject: string; predicate: string; object: string; objectType?: string; datatype?: string };

function safeIri(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]*$/i.test(value);
}
function sparqlIri(value: string): string { return `<${value}>`; }
function get(row: BindingRow, key: string): string { return row[key]?.value ?? ""; }

/** Resolve the class policy and its XSLT template from the configured personal SPARQL server. */

export async function POST(request: Request) {
  const loginRequired = requirePersonalLogin(request);
  if (loginRequired) return loginRequired;
  logProxyCaller(request, "/proxy/api/policies", { source: "record-policy", component: "RecordPolicyRoute" });
  try {
    const body = await request.json().catch(() => null) as {
      action?: unknown;
      recordTypes?: unknown;
      recordUri?: unknown;
      recordShape?: unknown;
      template?: unknown;
      triples?: unknown;
      classes?: unknown;
      properties?: unknown;
      roles?: unknown;
      classQuery?: unknown;
      propertyQuery?: unknown;
      roleQuery?: unknown;
    } | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ error: "A policy action is required." }, { status: 400 });
    }

    if (body.action === "discover") {
      await ensureShapesGraphSeeded(request);
      const types = Array.isArray(body.recordTypes) ? [...new Set(body.recordTypes.filter(safeIri))] : [];
      if (types.length === 0) return NextResponse.json({ policy: null });
      const values = types.map(sparqlIri).join(" ");
      const shapesGraph = sparqlIri(getShapesGraph(request));
      const query = `PREFIX rdf: <${RDF}>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX mui: <${MUI}>\nSELECT DISTINCT ?class ?policy ?policyLabel ?recordShape ?template ?templateLabel WHERE { GRAPH ${shapesGraph} { VALUES ?class { ${values} } ?policy a mui:ClassPolicy ; mui:forClass ?class ; mui:recordShape ?recordShape ; rdfs:label ?policyLabel . OPTIONAL { ?policy mui:xsltTemplate ?template . OPTIONAL { ?template rdfs:label ?templateLabel } } } } ORDER BY LCASE(STR(?policyLabel)) LCASE(STR(?templateLabel)) LIMIT 100`;
      const payload = await queryPersonalSparql(query, 20000, request);
      const grouped = new Map<string, { uri: string; label: string; recordShape: string; matchedClasses: string[]; templates: { uri: string; label: string }[] }>();
      for (const row of (payload.results?.bindings ?? []) as BindingRow[]) {
        const uri = get(row, "policy");
        const recordShape = get(row, "recordShape");
        if (!uri || !recordShape) continue;
        const item = grouped.get(uri) ?? { uri, label: get(row, "policyLabel") || uri, recordShape, matchedClasses: [], templates: [] };
        const matchedClass = get(row, "class");
        if (matchedClass && !item.matchedClasses.includes(matchedClass)) item.matchedClasses.push(matchedClass);
        const template = get(row, "template");
        if (template && !item.templates.some((entry) => entry.uri === template)) item.templates.push({ uri: template, label: get(row, "templateLabel") || template.split(/[\/#]/).filter(Boolean).pop() || template });
        grouped.set(uri, item);
      }
      return NextResponse.json({ policies: [...grouped.values()], debugSparql: query });
    }

    if (body.action === "template") {
      if (!safeIri(body.template)) return NextResponse.json({ error: "A valid XSLT template URI is required." }, { status: 400 });
      // Load the graph-stored XSLT 3.0 stylesheet; the SaxonJS proxy
      // compiles it to SEF, and Maestro validates its rendered commands.
      const query = `PREFIX rdf: <${RDF}>\nPREFIX mui: <${MUI}>\nSELECT DISTINCT ?templateXslt WHERE { GRAPH ${sparqlIri(getShapesGraph(request))} { ${sparqlIri(body.template)} (rdf:value|mui:templateContent) ?templateXslt . FILTER(CONTAINS(STR(?templateXslt), 'xsl:stylesheet')) } } LIMIT 1`;
      const payload = await queryPersonalSparql(query, 20000, request);
      const templateXslt = get((payload.results?.bindings?.[0] ?? {}) as BindingRow, "templateXslt");
      if (!templateXslt) return NextResponse.json({ error: `Template ${body.template} has no XSLT stylesheet in ${getShapesGraph(request)}. Reload the updated ./graph policy documents into the Personal graph store.` }, { status: 404 });
      if (templateXslt.length > 250000) return NextResponse.json({ error: "XSLT template is too large." }, { status: 413 });
      // Resolve the actual installed runtime version instead of trusting a version copied into the template.
      const nextPackage = JSON.parse(await readFile(resolve(process.cwd(), "node_modules/next/package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (nextPackage.name !== "next" || typeof nextPackage.version !== "string") throw new Error("Could not determine the installed Next.js package name and version.");
      return NextResponse.json({ templateXslt, nextName: nextPackage.name, nextVersion: nextPackage.version, debugSparql: query });
    }

    if (body.action === "facet-discover") {
      // Discovery is explicitly triggered by the Record Validate button.
      // The three FCT facet query clones are carried as scope provenance, while
      // their resolved classes/properties/roles provide bounded candidate IRIs.
      const data = body as typeof body & {
        classes?: unknown; properties?: unknown; roles?: unknown;
        classQuery?: unknown; propertyQuery?: unknown; roleQuery?: unknown;
      };
      const bounded = (value: unknown): string[] => Array.isArray(value) && value.length <= 500
        ? [...new Set(value.filter(safeIri))] : [];
      const classes = bounded(data.classes);
      const forward = bounded(data.properties);
      const reverse = bounded(data.roles);
      const snapshots = [data.classQuery, data.propertyQuery, data.roleQuery];
      if (snapshots.some((item) => typeof item !== "string" || item.length > 200000))
        return NextResponse.json({ error: "The cloned FCT facet queries are required." }, { status: 400 });
      // The selected record's SHACL shape is authoritative. Scanning all
      // Categories/Properties/Roles candidate target shapes can turn a simple
      // Record Validate into an expensive endpoint-wide join (and return no
      // rows after Virtuoso ANYTIME). The clone snapshots are still retained
      // as scope context; only sh:property of this record shape is ingested.
      if (!safeIri(body.recordShape)) {
        return NextResponse.json({ error: "A valid Record SHACL shape IRI is required." }, { status: 400 });
      }
      // Read the SHACL path term directly. The previous OPTIONAL/FILTER/BIND
      // projection could leave ?path unbound even when a sh:path triple existed.
      // Inverse paths are blank nodes carrying sh:inversePath; ordinary paths
      // are IRI-valued sh:path terms. Neither needs a computed SPARQL binding.
      const shapesGraph = getShapesGraph(request);
      const query = `PREFIX sh: <${SH}>\nPREFIX rdf: <${RDF}>\nSELECT DISTINCT ?propertyShape ?rawPath ?inverse ?alternative ?name WHERE { GRAPH ${sparqlIri(shapesGraph)} {
        ${sparqlIri(body.recordShape)} sh:property ?propertyShape .
        ?propertyShape sh:path ?rawPath .
        OPTIONAL { ?propertyShape sh:name ?name }
        OPTIONAL { ?rawPath sh:inversePath ?inverse }
        OPTIONAL { ?rawPath sh:alternativePath/rdf:rest*/rdf:first ?alternative }
      } } LIMIT 300`;
      const payload = await queryPersonalSparql(query, 20000, request);
      const rows = (payload.results?.bindings ?? []) as BindingRow[];
      const facets = [...new Map(rows.flatMap((row) => {
        const inverse = row.inverse?.type === "uri" ? get(row, "inverse") : "";
        const direct = row.rawPath?.type === "uri" ? get(row, "rawPath") : "";
        const alternative = row.alternative?.type === "uri" ? get(row, "alternative") : "";
        const uri = inverse || alternative || direct;
        // Categories already own rdf:type, so it must not become a Personal facet.
        if (!safeIri(uri) || uri === `${RDF}type`) return [];
        const direction: "forward" | "reverse" = inverse ? "reverse" : "forward";
        return [{ uri, direction, label: get(row, "name") || "" }];
      }).map((facet) => [`${facet.direction}:${facet.uri}`, facet])).values()];
      // A successful SELECT with no paths does not prove a shape has none:
      // check whether its sh:property links are present in the installed graph.
      let propertyShapes: number | undefined;
      if (!rows.length) {
        const diagnostics = await queryPersonalSparql(
          `PREFIX sh: <${SH}>\nSELECT (COUNT(?propertyShape) AS ?ct) WHERE { GRAPH ${sparqlIri(shapesGraph)} { ${sparqlIri(body.recordShape)} sh:property ?propertyShape } }`,
          20000, request,
        );
        propertyShapes = Number(get(((diagnostics.results?.bindings ?? [])[0] ?? {}) as BindingRow, "ct") || 0);
        proxyLog("warn", "policies.facet-discover.no-paths", { recordShape: body.recordShape, shapesGraph, propertyShapes });
      } else {
        propertyShapes = new Set(rows.map((row) => get(row, "propertyShape")).filter(Boolean)).size;
      }
      proxyLog("info", "policies.facet-discover", { count: facets.length, rawPaths: rows.length, propertyShapes, recordShape: body.recordShape });
      return NextResponse.json({ facets, graph: shapesGraph, propertyShapes, rawPaths: rows.length });
    }

    if (body.action === "validate") {
      if (!safeIri(body.recordUri) || !safeIri(body.recordShape) || !Array.isArray(body.triples) || body.triples.length > 10000) {
        return NextResponse.json({ error: "A record URI, record shape, and bounded DESCRIBE triple list are required." }, { status: 400 });
      }
      const triples = (body.triples as RecordTriple[]).filter((triple) =>
        triple && typeof triple.subject === "string" && safeIri(triple.predicate) && typeof triple.object === "string" && triple.subject.length <= 4096 && triple.object.length <= 100000,
      );
      const shapeQuery = `PREFIX sh: <${SH}>\nSELECT ?propertyShape ?constraint ?value WHERE { GRAPH ${sparqlIri(getShapesGraph(request))} { { ${sparqlIri(body.recordShape)} ?constraint ?value . BIND(${sparqlIri(body.recordShape)} AS ?propertyShape) } UNION { ${sparqlIri(body.recordShape)} sh:property ?propertyShape . ?propertyShape ?constraint ?value } } }`;
      const shapePayload = await queryPersonalSparql(shapeQuery, 20000, request);
      const shapeRows = (shapePayload.results?.bindings ?? []) as BindingRow[];
      if (shapeRows.length === 0) return NextResponse.json({ error: `No SHACL statements for ${body.recordShape} were found in the configured shapes graph ${getShapesGraph(request)}.` }, { status: 404 });
      const properties = new Map<string, Record<string, string[]>>();
      const topLevel: Record<string, string[]> = {};
      for (const row of shapeRows) {
        const node = get(row, "propertyShape");
        const predicate = get(row, "constraint");
        const value = get(row, "value");
        if (!node || !predicate) continue;
        const target = node === body.recordShape ? topLevel : (properties.get(node) ?? {});
        target[predicate] ??= [];
        target[predicate].push(value);
        if (node !== body.recordShape) properties.set(node, target);
      }
      // Resolve sh:alternativePath RDF lists explicitly. The ordinary constraint
      // query only sees the blank-node path, not its list members. Each member
      // is a property IRI and all members contribute values to one field.
      const alternativeQuery = `PREFIX sh: <${SH}>\nPREFIX rdf: <${RDF}>\nSELECT DISTINCT ?propertyShape ?alternative WHERE { GRAPH ${sparqlIri(getShapesGraph(request))} {
        ${sparqlIri(body.recordShape)} sh:property ?propertyShape .
        ?propertyShape sh:path/sh:alternativePath/rdf:rest*/rdf:first ?alternative .
      } } LIMIT 300`;
      const alternativePayload = await queryPersonalSparql(alternativeQuery, 20000, request);
      const alternativePaths = new Map<string, string[]>();
      for (const row of (alternativePayload.results?.bindings ?? []) as BindingRow[]) {
        const propertyShape = get(row, "propertyShape");
        const alternative = get(row, "alternative");
        if (!propertyShape || row.alternative?.type !== "uri" || !safeIri(alternative)) continue;
        const paths = alternativePaths.get(propertyShape) ?? [];
        if (!paths.includes(alternative)) paths.push(alternative);
        alternativePaths.set(propertyShape, paths);
      }
      const supported = new Set([`${RDF}type`, `${SH}property`, `${SH}targetClass`, `${SH}path`, `${SH}name`, `${SH}description`, `${SH}order`, `${SH}group`, `${SH}minCount`, `${SH}maxCount`, `${SH}minLength`, `${SH}datatype`, `${SH}class`, `${SH}nodeKind`, `${SH}pattern`, `${SH}severity`, `${SH}message`]);
      const unsupportedConstraints = new Set<string>();
      for (const row of shapeRows) {
        const predicate = get(row, "constraint");
        if (predicate.startsWith(SH) && !supported.has(predicate)) unsupportedConstraints.add(predicate);
      }
      const violations: { path: string; message: string; value?: string }[] = [];
      const optionalMissing: { path: string; name: string }[] = [];
      const topLevelSupported = new Set([`${RDF}type`, `${SH}property`, `${SH}targetClass`, `${SH}class`, `${SH}nodeKind`, `${SH}name`, `${SH}description`, `${SH}message`, `${SH}severity`, `${SH}deactivated`]);
      for (const predicate of Object.keys(topLevel)) {
        if (predicate.startsWith(SH) && !topLevelSupported.has(predicate)) unsupportedConstraints.add(`${predicate} (node-shape constraint)`);
      }
      const recordTypes = triples.filter((triple) => triple.subject === body.recordUri && triple.predicate === `${RDF}type`).map((triple) => triple.object);
      for (const expectedClass of topLevel[`${SH}class`] ?? []) {
        if (recordTypes.length === 0) unsupportedConstraints.add(`${SH}class (record rdf:type data is missing)`);
        else if (!recordTypes.includes(expectedClass)) violations.push({ path: `${RDF}type`, message: `Record is not typed as ${expectedClass}.` });
      }
      for (const nodeKind of topLevel[`${SH}nodeKind`] ?? []) {
        if (nodeKind === `${SH}Literal` || nodeKind === `${SH}BlankNode`) violations.push({ path: "", message: `The record focus node is an IRI, not ${nodeKind.slice(SH.length)}.` });
      }
      for (const [shapeNode, constraints] of properties) {
        const path = constraints[`${SH}path`]?.[0];
        if (!path) continue;
        const alternatives = alternativePaths.get(shapeNode) ?? [];
        if (!alternatives.length && !safeIri(path)) { unsupportedConstraints.add(`${SH}path (unsupported path on ${shapeNode})`); continue; }
        const paths = alternatives.length ? alternatives : [path];
        const values = triples.filter((triple) => triple.subject === body.recordUri && paths.includes(triple.predicate));
        const minCount = Number(constraints[`${SH}minCount`]?.[0] ?? 0);
        const maxCountText = constraints[`${SH}maxCount`]?.[0];
        const maxCount = maxCountText === undefined ? Number.POSITIVE_INFINITY : Number(maxCountText);
        const name = constraints[`${SH}name`]?.[0] ?? path;
        if (values.length === 0 && minCount === 0) optionalMissing.push({ path, name });
        if (values.length < minCount) violations.push({ path, message: `${name}: expected at least ${minCount} value(s), found ${values.length}.` });
        if (values.length > maxCount) violations.push({ path, message: `${name}: expected at most ${maxCount} value(s), found ${values.length}.` });
        const minLengthText = constraints[`${SH}minLength`]?.[0];
        if (minLengthText !== undefined) {
          const minLength = Number(minLengthText);
          if (!Number.isSafeInteger(minLength) || minLength < 0) {
            unsupportedConstraints.add(`${SH}minLength (invalid non-negative integer on ${shapeNode})`);
          } else {
            for (const value of values) {
              if (Array.from(value.object).length < minLength) {
                violations.push({ path, value: value.object, message: `${name}: expected at least ${minLength} character(s).` });
              }
            }
          }
        }
        const datatype = constraints[`${SH}datatype`]?.[0];
        if (datatype) for (const value of values) {
          if (value.objectType === "uri" || value.objectType === "bnode" || value.datatype !== datatype) violations.push({ path, value: value.object, message: `${name}: value does not have datatype ${datatype}.` });
        }
        const nodeKind = constraints[`${SH}nodeKind`]?.[0];
        if (nodeKind) for (const value of values) {
          if (nodeKind === `${SH}IRI` && value.objectType !== "uri") violations.push({ path, value: value.object, message: `${name}: expected an IRI.` });
          if (nodeKind === `${SH}Literal` && value.objectType !== "literal") violations.push({ path, value: value.object, message: `${name}: expected a literal.` });
          if (nodeKind === `${SH}BlankNode` && value.objectType !== "bnode") violations.push({ path, value: value.object, message: `${name}: expected a blank node.` });
        }
        const pattern = constraints[`${SH}pattern`]?.[0];
        if (pattern) {
          try { const regex = new RegExp(pattern); for (const value of values) if (!regex.test(value.object)) violations.push({ path, value: value.object, message: `${name}: value does not match pattern ${pattern}.` }); }
          catch { unsupportedConstraints.add(`${SH}pattern (invalid regular expression on ${shapeNode})`); }
        }
        const expectedClass = constraints[`${SH}class`]?.[0];
        if (expectedClass) for (const value of values) {
          const knownTypes = triples.filter((triple) => triple.subject === value.object && triple.predicate === `${RDF}type`);
          if (value.objectType !== "uri" || (knownTypes.length > 0 && !knownTypes.some((triple) => triple.object === expectedClass))) {
            violations.push({ path, value: value.object, message: `${name}: value is not typed as ${expectedClass} in the supplied DESCRIBE graph.` });
          } else if (knownTypes.length === 0) {
            unsupportedConstraints.add(`${SH}class (no rdf:type data for ${value.object} in the supplied graph)`);
          }
        }
      }
      const report = {
        conforms: violations.length === 0 && unsupportedConstraints.size === 0,
        complete: unsupportedConstraints.size === 0,
        violations,
        optionalMissing,
        unsupportedConstraints: [...unsupportedConstraints],
        message: unsupportedConstraints.size
          ? `Partial validation: ${unsupportedConstraints.size} SHACL constraint type(s) are not implemented by this initial validator.`
          : violations.length ? `${violations.length} validation violation(s).` : "No violations found for the supported SHACL constraints.",
      };
      return NextResponse.json({ report });
    }
    return NextResponse.json({ error: "Unknown policy action." }, { status: 400 });
  } catch (error) {
    return proxyFailure(request, "policies.POST", error);
  }
}
