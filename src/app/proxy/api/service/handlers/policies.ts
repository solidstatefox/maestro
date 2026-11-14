import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getShapesGraph, queryPersonalSparql, waitForPersonalGraphSeed } from "@/lib/personal-sparql";
import { logProxyCaller } from "@/lib/proxy-debug-server";
import { proxyFailure, proxyLog } from "@/lib/maestro-logger";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { readPolicyApprovals, discoverPolicyApprovals } from "@/lib/policy-approval-store";

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
  logProxyCaller(request, "service:policies", { source: "record-policy", component: "RecordPolicyRoute" });
  try {
    const body = await request.json().catch(() => null) as {
      action?: unknown;
      recordTypes?: unknown;
      queryXml?: unknown;
      recordUri?: unknown;
      historyUri?: unknown;
      recordShape?: unknown;
      template?: unknown;
      triples?: unknown;
      uris?: unknown;
    } | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ error: "A policy action is required." }, { status: 400 });
    }
    // Login reloads CLEAR and repopulate the SHACL graph. Do not read it midway.
    await waitForPersonalGraphSeed(request);
    if (body.action === "statuses") {
      const uris = Array.isArray(body.uris) ? [...new Set(body.uris.filter(safeIri))].slice(0, 500) : [];
      if (!uris.length) return NextResponse.json({ approvals: [] }, {headers:{"Cache-Control":"no-store"}});
      return NextResponse.json({ approvals: await readPolicyApprovals(uris, request) },
        {headers:{"Cache-Control":"no-store"}});
    }

    if (body.action === "discover") {
      const types = Array.isArray(body.recordTypes) ? [...new Set(body.recordTypes.filter(safeIri))] : [];
      if (types.length === 0) return NextResponse.json({ policy: null });
      const values = types.map(sparqlIri).join(" ");
      const shapesGraph = sparqlIri(getShapesGraph(request));
      const query = `PREFIX rdf: <${RDF}>\nPREFIX sh: <${SH}>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX mui: <${MUI}>\nSELECT DISTINCT ?class ?policy ?policyLabel ?recordShape ?provider ?template ?templateLabel WHERE { GRAPH ${shapesGraph} { VALUES ?class { ${values} } ?policy a mui:ClassPolicy ; mui:forClass ?class ; mui:recordShape ?recordShape ; mui:widget ?widgetClass ; rdfs:label ?policyLabel .
  FILTER EXISTS { ?recordShape ?shapePredicate ?shapeValue }
  OPTIONAL { ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
    ?inputShape a mui:InputShape .
    ?inputShape sh:class ?class .
    ?template rdf:type/rdfs:subClassOf* ?widgetClass .
    OPTIONAL { ?template rdfs:label ?templateLabel }
  } } } ORDER BY LCASE(STR(?policyLabel)) LCASE(STR(?templateLabel)) LIMIT 100`;
      const payload = await queryPersonalSparql(query, 20000, request);
      // Template discovery is informational; rendering is independently guarded
      // in action=template by both the ClassPolicy and Provider status.
      const grouped = new Map<string, { uri: string; label: string; recordShape: string; matchedClasses: string[]; templates: { uri: string; label: string; provider: string }[] }>();
      for (const row of (payload.results?.bindings ?? []) as BindingRow[]) {
        const uri = get(row, "policy");
        const recordShape = get(row, "recordShape");
        if (!uri || !recordShape) continue;
        const item = grouped.get(uri) ?? { uri, label: get(row, "policyLabel") || uri, recordShape, matchedClasses: [], templates: [] };
        const matchedClass = get(row, "class");
        if (matchedClass && !item.matchedClasses.includes(matchedClass)) item.matchedClasses.push(matchedClass);
        const template = get(row, "template");
        const provider = get(row, "provider");
        if (safeIri(template) && safeIri(provider) && !item.templates.some((entry) => entry.uri === template && entry.provider === provider)) {
          item.templates.push({ uri: template, label: get(row, "templateLabel") || template.split(/[\/#]/).filter(Boolean).pop() || template, provider });
        }
        grouped.set(uri, item);
      }
      let discovered = [...grouped.values()];
      // Where the Record's DESCRIBE is supplied, use true SHACL Core reports
      // to decide which ClassPolicies matched. Keep the class-only discovery
      // path for callers that have no Record graph yet; do not mislabel their
      // class lookup as SHACL validation.
      if (safeIri(body.recordUri) && Array.isArray(body.triples) && body.triples.length <= 10000) {
        const { validateStandardShaclRecord } = await import("@/lib/shacl-standard-validation");
        const validated = new Map<string, boolean>();
        const shapes = [...new Set(discovered.map(entry => entry.recordShape))];
        // Limit concurrent personal-store reads without inventing a second
        // queue or bypassing the existing query lifecycle.
        for (let offset = 0; offset < shapes.length; offset += 4) {
          const batch = shapes.slice(offset, offset + 4);
          const reports = await Promise.all(batch.map(shapeUri =>
            validateStandardShaclRecord(shapeUri, body.recordUri as string, body.triples as RecordTriple[], request)));
          for (let index = 0; index < batch.length; index++) validated.set(batch[index], reports[index].conforms);
        }
        discovered = discovered.filter(policy => validated.get(policy.recordShape) === true);
      }
      // This matched an actual Record type to a SHACL ClassPolicy, as opposed
      // to merely enumerating policies in View > Features. Queue new matches
      // as Pending and retain the matching Record as the requester. Discovery
      // does NOT grant execution permission; only Approved does that.
      // Record matching discovers BOTH authorization gates. Approving a
      // ClassPolicy never automatically approves the provider of its formatter.
      const discoveryUris = [...new Set([
        ...discovered.map(policy => policy.uri),
        ...discovered.flatMap(policy => policy.templates.map(template => template.provider)),
      ])];
      if (safeIri(body.recordUri)) {
        await discoverPolicyApprovals(discoveryUris, {
          component: UI_COMPONENT.recordPolicyDiscovery,
          queryXml: typeof body.queryXml === "string" ? body.queryXml : "",
          record: body.recordUri,
          history: safeIri(body.historyUri) ? body.historyUri : undefined,
        }, request);
      }
      const statuses = await readPolicyApprovals(discoveryUris, request);
      const approved = new Set(statuses.filter(item => item.status === "Approved").map(item => item.uri));
      // Never advertise or auto-select a template whose supplier is Pending,
      // even if the surrounding ClassPolicy was previously Approved.
      const policies = discovered.filter(policy => approved.has(policy.uri)).map(policy => ({
        ...policy,
        templates: policy.templates.filter(template => approved.has(template.provider)).map(({ uri, label }) => ({ uri, label })),
      }));
      return NextResponse.json({ policies, debugSparql: query });
    }

    if (body.action === "template") {
      if (!safeIri(body.template)) return NextResponse.json({ error: "A valid XSLT template URI is required." }, { status: 400 });
      // Both the ClassPolicy and the supplying Provider must be Approved.
      // A direct request to the template endpoint cannot bypass approval.
      const graph = sparqlIri(getShapesGraph(request));
      const query = `PREFIX rdf: <${RDF}>\nPREFIX sh: <${SH}>\nPREFIX mui: <${MUI}>\nSELECT DISTINCT ?policy ?provider ?templateXslt ?enrichmentXslt WHERE {
        GRAPH ${graph} { ?policy a mui:ClassPolicy ; mui:forClass ?class ; mui:widget ?widgetClass .
          ?provider a mui:Provider ; mui:accepts ?inputShape ; mui:widget ${sparqlIri(body.template)} .
          ?inputShape a mui:InputShape ; sh:class ?class .
          ${sparqlIri(body.template)} rdf:type/rdfs:subClassOf* ?widgetClass ; (rdf:value|mui:templateContent) ?templateXslt .
          FILTER(CONTAINS(STR(?templateXslt), 'xsl:stylesheet'))
          OPTIONAL { ${sparqlIri(body.template)} mui:enrichmentTemplate ?enrichmentTemplate . ?enrichmentTemplate (rdf:value|mui:templateContent) ?enrichmentXslt }
        }
      } LIMIT 50`;
      const payload = await queryPersonalSparql(query, 20000, request);
      const rows = (payload.results?.bindings ?? []) as BindingRow[];
      const statuses = await readPolicyApprovals([...new Set(rows.flatMap(row => [get(row, "policy"), get(row, "provider")]).filter(safeIri))], request);
      const approved = new Set(statuses.filter(item => item.status === "Approved").map(item => item.uri));
      const selected = rows.find(row => approved.has(get(row, "policy")) && approved.has(get(row, "provider")));
      const templateXslt = selected ? get(selected, "templateXslt") : "";
      if (!templateXslt) return NextResponse.json({ error: `Template ${body.template} is not available from an Approved policy.`, }, { status: 403 });
      const enrichmentXslt = selected ? get(selected, "enrichmentXslt") : "";
      if (enrichmentXslt.length > 250000) return NextResponse.json({ error: "Formatter enrichment XSLT is too large." }, { status: 413 });
      if (templateXslt.length > 250000) return NextResponse.json({ error: "XSLT template is too large." }, { status: 413 });
      // Resolve the actual installed runtime version instead of trusting a version copied into the template.
      const nextPackage = JSON.parse(await readFile(resolve(process.cwd(), "node_modules/next/package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (nextPackage.name !== "next" || typeof nextPackage.version !== "string") throw new Error("Could not determine the installed Next.js package name and version.");
      return NextResponse.json({ templateXslt, enrichmentXslt, nextName: nextPackage.name, nextVersion: nextPackage.version, debugSparql: query });
    }

    if (body.action === "validate") {
      if (!safeIri(body.recordShape)) return NextResponse.json({ error: "A valid policy shape is required." }, { status: 400 });
      const shape = sparqlIri(body.recordShape);
      const matching = await queryPersonalSparql(`PREFIX mui: <${MUI}>
        SELECT DISTINCT ?policy WHERE { GRAPH ${sparqlIri(getShapesGraph(request))} { ?policy a mui:ClassPolicy ; mui:recordShape ${shape} } } LIMIT 40`, 12000, request);
      const approvedPolicies = await readPolicyApprovals((matching.results?.bindings ?? []).map(row => row.policy?.value ?? "").filter(safeIri), request);
      if (!approvedPolicies.some(entry => entry.status === "Approved"))
        return NextResponse.json({ error: "This SHACL policy has not been Approved." }, { status: 403 });
    }

    if (body.action === "validate") {
      if (!safeIri(body.recordUri) || !safeIri(body.recordShape) || !Array.isArray(body.triples) || body.triples.length > 10000) {
        return NextResponse.json({ error: "A record URI, record shape, and bounded DESCRIBE triples are required." }, { status: 400 });
      }
      // The selected Record is validated by a genuine SHACL Core processor.
      // Return both its standards-based RDF report and the existing UI summary.
      // Unlike the old hand-written validator, SHACL Core RDF lists, sh:or,
      // inverse/sequence paths, and supported constraint components are handled
      // by the validator instead of being silently skipped.
      const { validateStandardShaclRecord } = await import("@/lib/shacl-standard-validation");
      const report = await validateStandardShaclRecord(
        body.recordShape, body.recordUri, body.triples as RecordTriple[], request,
      );
      return NextResponse.json({ report }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Unknown policy action." }, { status: 400 });
  } catch (error) {
    return proxyFailure(request, "policies.POST", error);
  }
}
