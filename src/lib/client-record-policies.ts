"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** Record ClassPolicy discovery is a browser SPARQL + SHACL workflow. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import { writeClientProviderDiscovery } from "@/lib/client-provider-provenance";
import { loadClientPolicyTemplate } from "@/lib/client-policy-template";
import { validateClientShaclRecord, type ShaclDataTriple } from "@/lib/client-record-shacl";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";

const RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH="http://www.w3.org/ns/shacl#";
const MUI="gttp://ggg.maestro.ecosys/ns/ui#";
const safe=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=4096&&/^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i.test(value);
const str=(value:unknown):string=>typeof value==="string"?value:"";
export type ClientRecordPolicy = {uri:string;label:string;recordShape:string;matchedClasses:string[];templates:{uri:string;label:string}[]};
export type ClientRecordPolicyInput = {action:"discover"|"template"|"validate";recordTypes?:string[];queryXml?:string;recordUri?:string;historyUri?:string;recordShape?:string;template?:string;triples?:ShaclDataTriple[]};

/** Supports the prior response contract for the existing Record UI while the
 * execution and policy checks run entirely in the browser. */
export async function requestClientRecordPolicy(input:ClientRecordPolicyInput,signal?:AbortSignal):Promise<unknown>{
  if(input.action==="template"){
    return loadClientPolicyTemplate(str(input.template),signal);
  }
  const ctx=await personalContext(),shapes=`<${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}>`;
  if(input.action==="validate"){
    if(!safe(input.recordShape)||!safe(input.recordUri)||!Array.isArray(input.triples)||input.triples.length>10000)
      throw new Error("Record URI, SHACL shape, and bounded DESCRIBE triples are required.");
    const matches=await selectPersonal(`PREFIX mui: <${MUI}> SELECT DISTINCT ?policy WHERE {
      GRAPH ${shapes} { ?policy a mui:ClassPolicy ; mui:recordShape <${input.recordShape}> }
    } LIMIT 40`,ctx,signal,"client-record-policies:requestClientRecordPolicy");
    const approvals=await readClientPolicyApprovals(matches.map(row=>row.policy?.value??"").filter(safe),signal);
    if(!approvals.some(row=>row.status==="Approved"))throw new Error("This SHACL policy has not been Approved.");
    return {report:await validateClientShaclRecord(input.recordShape,input.recordUri,input.triples,signal)};
  }
  if(input.action!=="discover")throw new Error("Unknown Record policy action.");
  const types=[...new Set((input.recordTypes??[]).filter(safe))];
  if(types.length===0)return {policies:[],debugSparql:""};
  if(types.length>100)throw new Error("Too many Record classes for ClassPolicy discovery.");
  const query=`PREFIX rdf: <${RDF}> PREFIX sh: <${SH}> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX mui: <${MUI}>
    SELECT DISTINCT ?class ?policy ?policyLabel ?recordShape ?provider ?template ?templateLabel WHERE {
    GRAPH ${shapes} { VALUES ?class { ${types.map(iri=>`<${iri}>`).join(" ")} }
      ?policy a mui:ClassPolicy ; mui:forClass ?class ; mui:recordShape ?recordShape ; mui:widget ?widgetClass ; rdfs:label ?policyLabel .
      FILTER EXISTS { ?recordShape ?shapePredicate ?shapeValue }
      OPTIONAL { ?provider a mui:Provider ; mui:widget ?template ; mui:accepts ?inputShape .
        ?inputShape a mui:InputShape ; sh:class ?class .
        ?template rdf:type/rdfs:subClassOf* ?widgetClass .
        OPTIONAL { ?template rdfs:label ?templateLabel }
      }
    } } ORDER BY LCASE(STR(?policyLabel)) LCASE(STR(?templateLabel)) LIMIT 100`;
  const rows=await selectPersonal(query,ctx,signal,"client-record-policies:requestClientRecordPolicy");
  const grouped=new Map<string,{uri:string;label:string;recordShape:string;matchedClasses:string[];templates:{uri:string;label:string;provider:string}[]}>();
  for(const row of rows){
    const uri=row.policy?.value??"",recordShape=row.recordShape?.value??"";
    if(!safe(uri)||!safe(recordShape))continue;
    const item=grouped.get(uri)??{uri,label:row.policyLabel?.value||uri,recordShape,matchedClasses:[],templates:[]};
    const cls=row.class?.value??"";
    if(cls&&!item.matchedClasses.includes(cls))item.matchedClasses.push(cls);
    const template=row.template?.value??"",provider=row.provider?.value??"";
    if(safe(template)&&safe(provider)&&!item.templates.some(t=>t.uri===template&&t.provider===provider))
      item.templates.push({uri:template,provider,label:row.templateLabel?.value||template.split(/[\/#]/).filter(Boolean).pop()||template});
    grouped.set(uri,item);
  }
  let discovered=[...grouped.values()];
  if(safe(input.recordUri)&&Array.isArray(input.triples)&&input.triples.length<=10000){
    const conforms=new Map<string,boolean>();
    for(const shape of [...new Set(discovered.map(item=>item.recordShape))]){
      if(signal?.aborted)throw signal.reason;
      conforms.set(shape,(await validateClientShaclRecord(shape,input.recordUri,input.triples,signal)).conforms);
    }
    discovered=discovered.filter(item=>conforms.get(item.recordShape)===true);
  }
  const policyUris=[...new Set([...discovered.map(item=>item.uri),...discovered.flatMap(item=>item.templates.map(t=>t.provider))])];
  if(safe(input.recordUri)&&policyUris.length){
    await writeClientProviderDiscovery(policyUris,{
      component:UI_COMPONENT.recordPolicyDiscovery,queryXml:input.queryXml??"",record:input.recordUri,
      ...(safe(input.historyUri)?{history:input.historyUri}:{}),
    },signal);
  }
  const approved=new Set((await readClientPolicyApprovals(policyUris,signal)).filter(item=>item.status==="Approved").map(item=>item.uri));
  const policies:ClientRecordPolicy[]=discovered.filter(item=>approved.has(item.uri)).map(item=>({
    uri:item.uri,label:item.label,recordShape:item.recordShape,matchedClasses:item.matchedClasses,
    templates:item.templates.filter(t=>approved.has(t.provider)).map(({uri,label})=>({uri,label})),
  }));
  return {policies,debugSparql:query};
}
/** Browser-side response adapter lets callers retain their current XState
 * request/result/abort handling without a Maestro-specific HTTP endpoint. */
export async function clientRecordPolicyResponse(init:RequestInit):Promise<Response>{
  const input=JSON.parse(str(init.body)) as ClientRecordPolicyInput;
  try{return Response.json(await requestClientRecordPolicy(input,init.signal??undefined),{headers:{"Cache-Control":"no-store"}});}
  catch(error){if(init.signal?.aborted)throw error;
    return Response.json({error:error instanceof Error?error.message:String(error)},{status:400,headers:{"Cache-Control":"no-store"}});
  }
}
