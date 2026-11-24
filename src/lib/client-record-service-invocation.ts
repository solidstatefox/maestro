"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Browser-owned execution of graph-described Record service providers.
 * SPARQL reads service definitions; Saxon-JS handles request/response XSLT;
 * the generic HTTP bridge transports the authorized outbound GET unchanged.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { matchRegisteredOpenApiGet } from "@/lib/openapi-registry";
import { callOpenApiService } from "@/lib/service-client";
import { executeServiceXslt, serviceJsonToXml } from "@/lib/maestro-service-xslt";
import { safeRecordServiceIri } from "@/lib/record-service-discovery-query";

const SVC = "gttp://ggg.maestro.ecosys/ns/service#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const CTX = "gttp://ggg.maestro.ecosys/ns/xslt/context#";
const FCT = "http://openlinksw.com/services/facets/1.0/";
const escapeXml = (value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const stripDeclaration = (value:string)=>value.replace(/^\s*<\?xml[^>]*\?>\s*/i,"").trim();

type Operation = {uri:string; endpoint:string; method:string; inputXslt:string; outputXslt:string;
  requires:string[]; queryParams:string[]; extracts:{name:string;pointer:string;format:string}[]};
export type ClientRecordServiceResult = {html:string;values:Record<string,string>};

function envelope(queryXml:string,fctXml:string,args:Record<string,string>,responseXml=""):string {
  return `<mctx:context xmlns:mctx="${CTX}" xmlns:fct="${FCT}"><mctx:query>${stripDeclaration(queryXml)}</mctx:query>`+
    `<mctx:describe>${stripDeclaration(fctXml)}</mctx:describe><mctx:arguments>`+
    Object.entries(args).map(([k,v])=>`<mctx:argument name="${escapeXml(k)}">${escapeXml(v)}</mctx:argument>`).join("")+
    `</mctx:arguments><mctx:response>${responseXml}</mctx:response></mctx:context>`;
}
async function describeOperation(service:string,operation:string,signal?:AbortSignal):Promise<Operation> {
  const ctx=await personalContext();
  const graph=`${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`;
  const query=`PREFIX svc: <${SVC}> PREFIX rdf: <${RDF}>
SELECT ?endpoint ?method ?inputXslt ?outputXslt ?requires ?queryParam ?paramName ?pointer ?bindingFormat WHERE {
  GRAPH <${graph}> {
    <${service}> a svc:Service ; svc:operation <${operation}> .
    <${operation}> svc:endpoint ?endpoint ; svc:method ?method ; svc:inputTransform/rdf:value ?inputXslt ; svc:outputTransform/rdf:value ?outputXslt .
    OPTIONAL { <${operation}> svc:requires ?requires }
    OPTIONAL { <${operation}> svc:queryParameter ?queryParam }
    OPTIONAL { <${operation}> svc:extract ?param . ?param svc:name ?paramName ; svc:pointer ?pointer . OPTIONAL { ?param svc:format ?bindingFormat } }
  }
} LIMIT 150`;
  const rows=await selectPersonal(query,ctx,signal,"client-record-service-invocation:describeOperation");
  if(!rows.length)throw new Error("Service operation is not described in the personal policy graph.");
  const first=rows[0], op:Operation={uri:operation,endpoint:first.endpoint?.value??"",method:first.method?.value??"",
    inputXslt:first.inputXslt?.value??"",outputXslt:first.outputXslt?.value??"",requires:[],queryParams:[],extracts:[]};
  for(const row of rows){
    const required=row.requires?.value??"";if(required&&!op.requires.includes(required))op.requires.push(required);
    const queryParam=row.queryParam?.value??"";if(queryParam&&!op.queryParams.includes(queryParam))op.queryParams.push(queryParam);
    const name=row.paramName?.value??"",pointer=row.pointer?.value??"";
    if(name&&pointer&&!op.extracts.some(e=>e.name===name&&e.pointer===pointer))op.extracts.push({name,pointer,format:row.bindingFormat?.value??""});
  }
  return op;
}
export async function invokeClientRecordService(input:{service:string;operation:string;recordUri:string;
  queryXml:string;fctXml:string;arguments:Record<string,string>},signal?:AbortSignal):Promise<ClientRecordServiceResult> {
  if(!safeRecordServiceIri(input.service)||!safeRecordServiceIri(input.operation)||!safeRecordServiceIri(input.recordUri))
    throw new Error("Invalid service or Record identifier.");
  if(input.queryXml.length>200000||input.fctXml.length>600000||XMLValidator.validate(input.queryXml)!==true||
    XMLValidator.validate(input.fctXml)!==true||/<!DOCTYPE|<!ENTITY/i.test(input.queryXml+input.fctXml))
    throw new Error("Invalid service input XML.");
  const args=input.arguments??{};
  if(Object.entries(args).length>30||Object.entries(args).some(([k,v])=>!(/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(k))||typeof v!=="string"||v.length>400))
    throw new Error("Invalid service arguments.");
  const op=await describeOperation(input.service,input.operation,signal);
  if(op.method!=="GET")throw new Error("Only read-only HTTP GET service operations are enabled.");
  if(op.requires.some(key=>!args[key]))throw new Error("The service requires additional input identifiers.");
  const requestXml=await executeServiceXslt(op.inputXslt,envelope(input.queryXml,input.fctXml,args),input.recordUri);
  if(XMLValidator.validate(requestXml)!==true)throw new Error("Service input XSLT did not produce XML.");
  const descriptor=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_"}).parse(requestXml) as {
    request?:{param?:{"@_name"?:string;"#text"?:string}|{"@_name"?:string;"#text"?:string}[]}};
  if(!descriptor.request)throw new Error("Service XSLT did not describe an HTTP request.");
  const params=new Map<string,string>();
  for(const param of [descriptor.request.param??[]].flat()){
    const name=param?.["@_name"]??"",value=String(param?.["#text"]??"").trim();
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(name)||value.length>500)throw new Error("Invalid service request parameter.");
    if(value)params.set(name,value);
  }
  const destination=op.endpoint.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g,(_match,name:string)=>{
    const value=params.get(name);
    if(!value||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error("Missing or unsafe service path parameter.");
    params.delete(name);return encodeURIComponent(value);
  });
  if(destination.includes("{"))throw new Error("Unresolved service URL template.");
  const url=new URL(destination);
  if(url.protocol!=="https:"||url.username||url.password||url.hash)throw new Error("Service destination must be an HTTPS URL.");
  params.forEach((value,key)=>{if(op.queryParams.includes(key))url.searchParams.set(key,value);});
  // Endpoint is accepted only if it resolves to an operation in the reviewed
  // OpenAPI registry; a graph-provided URL cannot turn /service into SSRF.
  const registered=matchRegisteredOpenApiGet(url.toString());
  if(!registered)throw new Error("Record service endpoint is not in the accepted OpenAPI registry.");
  const data=await callOpenApiService<unknown>(registered.service,registered.operationId,registered.parameters,signal);
  const raw=JSON.stringify(data);
  if(raw.length>400000)throw new Error("Service response too large.");
  const responseXml = await serviceJsonToXml(raw);
  const transformed = await executeServiceXslt(op.outputXslt, envelope(input.queryXml, input.fctXml, args, responseXml), input.recordUri);
  const values:Record<string,string>={};
  for(const extraction of op.extracts){
    if(!extraction.pointer.startsWith("/"))continue;
    let value:unknown=data;
    for(const part of extraction.pointer.split("/").slice(1).map(p=>p.replace(/~1/g,"/").replace(/~0/g,"~"))){
      if(!value||typeof value!=="object"){value=undefined;break;}
      value=(value as Record<string,unknown>)[part];
    }
    if(typeof value!=="string"&&typeof value!=="number")continue;
    const text=String(value);
    values[extraction.name]=extraction.format==="tail"?text.split("/").pop()??"":
      extraction.format==="slug"?text.trim().toLowerCase().replace(/\s+/g,"_"):text;
  }
  return {html:transformed,values};
}
