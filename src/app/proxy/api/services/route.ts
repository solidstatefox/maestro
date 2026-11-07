import { NextResponse } from "next/server";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ensureShapesGraphSeeded, getShapesGraph, queryPersonalSparql } from "@/lib/personal-sparql";
import { requirePersonalLogin } from "@/lib/personal-guard";
import { executeServiceXslt, serviceJsonToXml } from "@/lib/maestro-service-xslt";

const SVC = "gttp://ggg.maestro.ecosys/ns/service#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const CTX = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT = "http://openlinksw.com/services/facets/1.0/";
type Binding = { type?: string; value?: string };
const withoutDeclaration = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "").trim();
type Row = Record<string, Binding>;
const get = (r: Row, k: string) => r[k]?.value ?? "";
const iri = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 2048 && /^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]*$/i.test(v);
const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The user's trusted services graph describes the operations, not the browser.
async function describe(service: string, request: Request) {
  const q = `PREFIX svc: <${SVC}> PREFIX rdf: <${RDF}>
  SELECT ?operation ?label ?endpoint ?method ?inputXslt ?outputXslt ?requires ?queryParam ?param ?paramName ?pointer ?bindingFormat WHERE {
    GRAPH <${getShapesGraph(request)}> {
      <${service}> a svc:Service ; svc:operation ?operation .
      ?operation <http://www.w3.org/2000/01/rdf-schema#label> ?label ; svc:endpoint ?endpoint ; svc:method ?method ; svc:inputTransform/rdf:value ?inputXslt ; svc:outputTransform/rdf:value ?outputXslt .
      OPTIONAL { ?operation svc:requires ?requires }
      OPTIONAL { ?operation svc:queryParameter ?queryParam }
      OPTIONAL { ?operation svc:extract ?param . ?param svc:name ?paramName ; svc:pointer ?pointer . OPTIONAL { ?param svc:format ?bindingFormat } }
    }
  } LIMIT 150`;
  const result = await queryPersonalSparql(q, 20000, request);
  const operations = new Map<string, { uri: string; label: string; endpoint: string; method: string; inputXslt: string; outputXslt: string; requires: string[]; queryParams: string[]; extracts: { name: string; pointer: string; format: string }[] }>();
  for (const row of (result.results?.bindings ?? []) as Row[]) {
    const uri = get(row, "operation");
    if (!iri(uri)) continue;
    const op = operations.get(uri) ?? { uri, label: get(row,"label"), endpoint: get(row,"endpoint"), method: get(row,"method"), inputXslt: get(row,"inputXslt"), outputXslt: get(row,"outputXslt"), requires: [], queryParams: [], extracts: [] };
    const required = get(row,"requires");
    if (required && !op.requires.includes(required)) op.requires.push(required);
    const queryParam = get(row,"queryParam");
    if (queryParam && !op.queryParams.includes(queryParam)) op.queryParams.push(queryParam);
    const name = get(row,"paramName"), pointer = get(row,"pointer");
    if (name && pointer && !op.extracts.some((it) => it.name === name && it.pointer === pointer)) op.extracts.push({name, pointer, format:get(row,"bindingFormat")});
    operations.set(uri, op);
  }
  return [...operations.values()];
}

function formatEnvelope(queryXml: string, fctXml: string, args: Record<string,string>, responseXml?: string): string {
  return `<mctx:context xmlns:mctx="${CTX}" xmlns:fct="${FCT}">
    <mctx:live-query>${withoutDeclaration(queryXml)}</mctx:live-query>
    <mctx:describe>${withoutDeclaration(fctXml)}</mctx:describe>
    <mctx:arguments>${Object.entries(args).map(([k,v]) => `<mctx:argument name="${xmlEscape(k)}">${xmlEscape(v)}</mctx:argument>`).join("")}</mctx:arguments>
    <mctx:response>${responseXml ?? ""}</mctx:response>
  </mctx:context>`;
}

// Don't let service-authored XSLT select arbitrary network destinations. An
// operator must explicitly trust a service origin before it becomes callable.
const permittedOrigins = new Set(["https://openlibrary.org"]);
function authorizedEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (!permittedOrigins.has(url.origin) || url.username || url.password || url.hash) throw new Error("The service origin is not approved for execution.");
  return url;
}

export async function POST(request: Request) {
  const login = requirePersonalLogin(request);
  if (login) return login;
  try {
    if (Number(request.headers.get("content-length") ?? "0") > 1050000) return NextResponse.json({error:"Service request too large."},{status:413});
    const body = await request.json() as { action?: string; recordTypes?: string[]; service?: string; operation?: string; queryXml?: string; fctXml?: string; recordUri?: string; arguments?: Record<string,string> };
    await ensureShapesGraphSeeded(request);
    if (body.action === "discover") {
      const classes = [...new Set((Array.isArray(body.recordTypes) ? body.recordTypes : []).filter(iri))].slice(0, 100);
      if (!classes.length) return NextResponse.json({services:[]});
      const query = `PREFIX svc: <${SVC}> PREFIX sh: <http://www.w3.org/ns/shacl#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT DISTINCT ?service ?label WHERE { GRAPH <${getShapesGraph(request)}> {
          VALUES ?class { ${classes.map((value) => `<${value}>`).join(" ")} }
          ?service a svc:Service, sh:NodeShape ; sh:targetClass ?class ; rdfs:label ?label .
        } } LIMIT 100`;
      const payload = await queryPersonalSparql(query, 20000, request);
      const services: { uri: string; label: string; operations: { uri: string; label: string; requires: string[] }[] }[] = [];
      for (const row of (payload.results?.bindings ?? []) as Row[]) {
        const service = get(row,"service");
        if (!iri(service) || services.some((item: {uri:string}) => item.uri === service)) continue;
        const operations = await describe(service, request);
        if (operations.length) services.push({uri:service, label:get(row,"label") || service, operations: operations.map(({uri,label,requires})=>({uri,label,requires}))});
      }
      return NextResponse.json({services});
    }
    if (body.action !== "invoke" || !iri(body.service) || !iri(body.operation) || !iri(body.recordUri))
      return NextResponse.json({error:"Valid service, operation and record identifiers are required."},{status:400});
    const {queryXml, fctXml} = body;
    if (typeof queryXml !== "string" || typeof fctXml !== "string" || queryXml.length > 200000 || fctXml.length > 600000 ||
        XMLValidator.validate(queryXml) !== true || XMLValidator.validate(fctXml) !== true || !/<(?:\w+:)?query\b/.test(queryXml) || !/<(?:\w+:)?facets\b/.test(fctXml) || /<!DOCTYPE|<!ENTITY/i.test(queryXml + fctXml))
      return NextResponse.json({error:"An FCT query and FCT result snapshot are required."},{status:400});
    const args = body.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length > 30 || Object.entries(args).some(([k,v]) => !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(k) || typeof v !== "string" || v.length > 400))
      return NextResponse.json({error:"Invalid service arguments."},{status:400});
    const operations = await describe(body.service, request);
    const operation = operations.find((op) => op.uri === body.operation);
    if (!operation) return NextResponse.json({error:"Operation not registered for this service."},{status:404});
    if (operation.requires.some((name) => !args[name])) return NextResponse.json({error:"Operation requires additional service identifiers. Search for the book first."},{status:400});
    if (operation.method !== "GET") return NextResponse.json({error:"Only read-only GET operations are enabled in this first release."},{status:400});
    const envelope = formatEnvelope(queryXml, fctXml, args);
    if (XMLValidator.validate(envelope) !== true) throw new Error("Invalid service input context.");
    const transformed = executeServiceXslt(operation.inputXslt, envelope, body.recordUri);
    if (XMLValidator.validate(transformed) !== true) throw new Error("Service XSLT must produce an XML request descriptor.");
    const parsed = new XMLParser({ignoreAttributes:false, attributeNamePrefix:"@_"}).parse(transformed) as {request?: {param?: {"@_name"?:string,"#text"?:string}| {"@_name"?:string,"#text"?:string}[] }};
    if (!parsed.request) throw new Error("Service XSLT must produce a request element.");
    const params = new Map<string,string>();
    for (const p of [parsed.request.param ?? []].flat()) {
      const name = p?.["@_name"] ?? "", value = String(p?.["#text"] ?? "").trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(name) || value.length > 500) throw new Error("Invalid transformed service parameter.");
      if (value) params.set(name,value);
    }
    let destination = operation.endpoint.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (_match,name: string) => {
      const value = params.get(name);
      if (!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error(`Invalid service path parameter ${name}.`);
      params.delete(name);
      return encodeURIComponent(value);
    });
    if (destination.includes("{")) throw new Error("Unresolved service endpoint parameter.");
    const url = authorizedEndpoint(destination);
    params.forEach((value,name) => { if (operation.queryParams.includes(name)) url.searchParams.set(name,value); });
    // No automatic redirects to untrusted origins; bounded remote response.
    const response = await fetch(url,{headers:{Accept:"application/json", "User-Agent":"Maestro/1.0 (SHACL service client)"},redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if (!response.ok) return NextResponse.json({error:`Service returned HTTP ${response.status}.`},{status:502});
    if (!/application\/json/i.test(response.headers.get("content-type") ?? "")) throw new Error("Service did not return JSON.");
    const size = Number(response.headers.get("content-length") ?? "0");
    if (size > 400000) throw new Error("Service response exceeds the size limit.");
    const raw = await response.text();
    if (raw.length > 400000) throw new Error("Service response exceeds the size limit.");
    const json = JSON.parse(raw) as unknown;
    // Saxon converts JSON to standard XPath-functions XML once, before any
    // service-authored presentation stylesheet runs.
    const responseXml = serviceJsonToXml(raw);
    const viewEnvelope = formatEnvelope(queryXml, fctXml, args, responseXml);
    if (XMLValidator.validate(viewEnvelope) !== true) throw new Error("Invalid XMLized service response.");
    const html = executeServiceXslt(operation.outputXslt, viewEnvelope, body.recordUri);
    const values: Record<string,string> = {};
    for (const spec of operation.extracts) {
      if (!spec.pointer.startsWith("/")) continue;
      let v: unknown = json;
      for (const key of spec.pointer.split("/").slice(1).map((x) => x.replace(/~1/g,"/").replace(/~0/g,"~"))) {
        if (v === null || typeof v !== "object") {v=undefined; break;}
        v=(v as Record<string,unknown>)[key];
      }
      if (typeof v === "string" || typeof v === "number") {
        const text = String(v);
        values[spec.name] = spec.format === "tail" ? (text.split("/").pop() ?? "") : spec.format === "slug" ? text.trim().toLowerCase().replace(/\s+/g,"_") : text;
      }
    }
    return NextResponse.json({html, values}, {headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    console.error("Maestro service invocation failed:",error);
    const msg = error instanceof Error ? error.message : "Service unavailable.";
    return NextResponse.json({error: /^(Invalid |Service |Only |Operation |An FCT|Unresolved |The service|Unsafe |External )/.test(msg) ? msg : "Service request failed. Check the proxy logs."},{status:400});
  }
}
