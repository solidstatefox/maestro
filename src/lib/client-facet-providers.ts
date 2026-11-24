"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";
/** SHACL-selected Personal facet providers are discovered, validated and
 * approval-filtered exclusively in the browser and the user's RDF graphs. */
import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";
import { browserLog } from "@/lib/maestro-client-logging";
import { readClientPolicyApprovals } from "@/lib/client-policy-approvals";
import { writeClientProviderDiscovery } from "@/lib/client-provider-provenance";
import { readClientShaclShapeTriples, validateClientShaclRows } from "@/lib/client-record-shacl";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";
import { COERCIBLE_NUMERIC_MODE, NUMERIC_LEXICAL_PATTERN, NUMERIC_FACET_PROJECTION } from "@/lib/virtuoso-numeric-coercion";
import type { DateProviderMatch, NumericProviderMatch, TagProviderMatch, ProviderMatches } from "@/lib/app-lifecycle/providers";

const MUI="gttp://ggg.maestro.ecosys/ns/ui#", SH="http://www.w3.org/ns/shacl#";
const RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#", RDFS="http://www.w3.org/2000/01/rdf-schema#";
const valid=(value:string)=>value.length>0&&value.length<4096&&/^[a-z][a-z0-9+.-]*:[^\s<>\"{}|^`\\]+$/i.test(value);
type Input={properties:string[];queryXml:string;datatypeEvidence:Record<string,string[]>};
type NumericEntry=NumericProviderMatch & {shape:string};
const unique=<T,>(values:T[])=>[...new Set(values)];
export async function discoverClientFacetProviders(
  input:Input, signal?:AbortSignal, onTags?: (approvedTags: TagProviderMatch[]) => void,
):Promise<ProviderMatches>{
  const properties=unique(input.properties.filter(valid)).slice(0,200);
  if(!properties.length)return {temporal:[],numeric:[],tags:[]};
  const ctx=await personalContext(),graph=`${resolveGraph(GRAPH.SHACL_POLICIES, ctx.base)}`,ontology=`${resolveGraph(GRAPH.ONTOLOGY_CACHE, ctx.base)}`;
  const values=properties.map(value=>`<${value}>`).join(" ");
  const prefixes=`PREFIX mui: <${MUI}> PREFIX sh: <${SH}> PREFIX rdf: <${RDF}> PREFIX rdfs: <${RDFS}>`;
  // Start the Tag Cloud lookup immediately. This provider is structurally
  // matched by the live facet property; unrelated Calendar/Numeric SHACL
  // probes must not delay or veto it. Its own approval is still mandatory.
  const tagDiscovery = (async (): Promise<TagProviderMatch[]> => {
    try {
      const rows = await selectPersonal(`${prefixes} SELECT DISTINCT ?provider ?property WHERE { GRAPH <${graph}> {
        ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget ; mui:tagProperty ?property .
        ?widget a mui:TagCloudFacetWidget . ?shape a mui:InputShape .
        { { ?shape sh:property/sh:path ?property }
          UNION { ?shape sh:or/rdf:rest*/rdf:first/sh:property/sh:path ?property } }
        } VALUES ?property { ${values} }
      } LIMIT 200`, ctx, signal,"client-facet-providers:discoverClientFacetProviders");
      const candidates:TagProviderMatch[] = [...new Map(rows.map(row => ({
        uri: row.provider?.value ?? "", property: row.property?.value ?? "",
      })).filter(row => valid(row.uri) && properties.includes(row.property))
        .map(row => [row.property,row] as const)).values()];
      const decisions = await readClientPolicyApprovals(unique(candidates.map(row => row.uri)), signal);
      const approved = new Set(decisions.filter(row => row.status === "Approved").map(row => row.uri));
      const ready = candidates.filter(row => approved.has(row.uri));
      if (!signal?.aborted) onTags?.(ready);
      return ready;
    } catch (error) {
      if (!signal?.aborted) browserLog.warn("facet-provider.tags-discovery.unavailable", error);
      return [];
    }
  })();
  const dateRows=await selectPersonal(`${prefixes} SELECT DISTINCT ?provider ?property ?label ?range ?acceptedDatatype WHERE {
    GRAPH <${graph}> { ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
      ?shape sh:path ?property . ?widget a mui:DateRangeFacetWidget .
      OPTIONAL { ?widget rdfs:label ?label }
      OPTIONAL { ?shape sh:or/rdf:rest*/rdf:first/sh:datatype ?acceptedDatatype }
    }
    VALUES ?property { ${values} }
    OPTIONAL { GRAPH <${ontology}> { ?property rdfs:range ?range } }
  } LIMIT 200`,ctx,signal,"client-facet-providers:discoverClientFacetProviders");
  const dates:DateProviderMatch[]=[...new Map(dateRows.filter(row=>!row.range?.value ||
    row.acceptedDatatype?.value===row.range.value).map(row=>({
      uri:row.provider?.value??"",property:row.property?.value??"",label:row.label?.value??"Date/time range",
    })).filter(row=>valid(row.uri)&&properties.includes(row.property)).map(row=>[`${row.uri}|${row.property}`,row] as const)).values()];
  // Generic Calendar providers define SHACL datatype constraints instead of
  // naming particular properties. Materialize actual current-scope datatype
  // evidence and validate it against the provider's RDF shape in the browser.
  // Missing evidence never authorizes a widget. The user's approval gate below
  // remains mandatory, exactly as for Numeric and Tag Cloud.
  // A new/optional Calendar policy must not take down Numeric and Tag Cloud
  // on graph servers that cannot evaluate its SHACL discovery path.
  try {
  const inferredDateRows=await selectPersonal(`${prefixes} SELECT DISTINCT ?provider ?shape ?label WHERE {
    GRAPH <${graph}> {
      ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
      ?widget a mui:DateRangeFacetWidget .
      ?shape a mui:InputShape ; sh:property/sh:path mui:inferredDatatype .
      OPTIONAL { ?widget rdfs:label ?label }
    }
  } LIMIT 30`,ctx,signal,"client-facet-providers:discoverClientFacetProviders");
  for (const row of inferredDateRows) {
    const uri=row.provider?.value??"",shape=row.shape?.value??"";
    if (!valid(uri) || !valid(shape)) continue;
    const shapeRows=await readClientShaclShapeTriples(shape,signal);
    for (const property of properties) {
      const evidence=unique((input.datatypeEvidence?.[property]??[]).filter(valid)).slice(0,100);
      if (!evidence.length) continue;
      const focus=`urn:maestro:facet:${encodeURIComponent(property)}`;
      const report=await validateClientShaclRows(shape,focus,shapeRows,evidence.map(datatype=>({
        subject:focus,predicate:`${MUI}inferredDatatype`,object:datatype,objectType:"uri",
      })));
      if (report.conforms && !dates.some(item=>item.property===property && item.uri===uri)) {
        dates.push({uri,property,label:row.label?.value??"Date/time range"});
      }
    }
  }
  } catch (error) {
    if (signal?.aborted) throw error;
    browserLog.warn("facet-provider.calendar-discovery.unavailable", error);
  }
  const numericRows=await selectPersonal(`${prefixes} SELECT DISTINCT ?provider ?shape ?aggregate ?expression ?alias ?subjectSlot ?predicateSlot ?objectSlot ?coercion ?lexicalPattern WHERE {
    GRAPH <${graph}> { ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget ;
      mui:countProjection ?projection ; mui:countTriple ?triple .
      ?widget a mui:NumericRangeFacetWidget .
      OPTIONAL { ?provider mui:numericCoercion ?coercion ; mui:numericPattern ?lexicalPattern }
      ?projection mui:aggregate ?aggregate ; mui:expression ?expression ; mui:alias ?alias .
      ?triple mui:subjectSlot ?subjectSlot ; mui:predicateSlot ?predicateSlot ; mui:objectSlot ?objectSlot .
      ?shape a mui:InputShape .
      FILTER EXISTS { ?shape sh:property/sh:qualifiedValueShape/sh:in/rdf:rest*/rdf:first ?numericDatatype .
        FILTER(?numericDatatype IN (<http://www.w3.org/2001/XMLSchema#integer>,
          <http://www.w3.org/2001/XMLSchema#decimal>,<http://www.w3.org/2001/XMLSchema#double>,
          <http://www.w3.org/2001/XMLSchema#float>)) }
    }
  } LIMIT 20`,ctx,signal,"client-facet-providers:discoverClientFacetProviders");
  const numericByUri=new Map<string,NumericEntry>();
  for(const row of numericRows){
    const uri=row.provider?.value??"",shape=row.shape?.value??"",aggregate=row.aggregate?.value??"",
      expression=row.expression?.value??"",alias=row.alias?.value??"";
    const coercible=row.coercion?.value===COERCIBLE_NUMERIC_MODE&&row.lexicalPattern?.value===NUMERIC_LEXICAL_PATTERN;
    if(!valid(uri)||!valid(shape)||!["MIN","MAX","AVG","SUM"].includes(aggregate)||
      (coercible?expression!==NUMERIC_FACET_PROJECTION:expression!=="xsd:decimal(?facetValue)")||
      !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(alias)||row.subjectSlot?.value!=="view"||
      row.predicateSlot?.value!=="facetProperty"||row.objectSlot?.value!=="facetValue")continue;
    const entry:NumericEntry=numericByUri.get(uri)??{uri,shape,eligibleProperties:[],projections:[]};
    entry.projections.push({aggregate:aggregate as "MIN"|"MAX"|"AVG"|"SUM",
      expression:coercible?NUMERIC_FACET_PROJECTION:"xsd:decimal(?facetValue)",alias});
    numericByUri.set(uri,entry);
  }
  const numeric:NumericEntry[]=[...numericByUri.values()].filter(item=>item.projections.some(p=>p.alias==="min")&&item.projections.some(p=>p.alias==="max"));
  if(numeric.length&&input.queryXml?.includes("<query")){
    for(const entry of numeric){
      const shapeRows=await readClientShaclShapeTriples(entry.shape,signal);
      for(const property of properties){
        const data=unique((Array.isArray(input.datatypeEvidence?.[property])?input.datatypeEvidence[property]:[]).filter(valid)).slice(0,100);
        if(!data.length)continue;
        const focus=`urn:maestro:facet:${encodeURIComponent(property)}`;
        const conform=await validateClientShaclRows(entry.shape,focus,shapeRows,data.map(datatype=>({
          subject:focus,predicate:`${MUI}inferredDatatype`,object:datatype,objectType:"uri",
        })));
        if(conform.conforms)entry.eligibleProperties.push(property);
      }
    }
  }
  const tags = await tagDiscovery;
  const eligibleNumeric=numeric.filter(p=>p.eligibleProperties.length>0);
  if(input.queryXml?.includes("<query")&&input.queryXml.length<=200_000){
    const discovered=unique([...dates.map(p=>p.uri),...eligibleNumeric.map(p=>p.uri),...tags.map(p=>p.uri)]);
    if (discovered.length) {
      try {
        await writeClientProviderDiscovery(discovered,{component:UI_COMPONENT.personalPane,queryXml:input.queryXml},signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        // Recording discovery provenance is separate from approving, matching,
        // and rendering an already approved provider. A read-only provider must
        // remain usable when the personal provenance update is unavailable.
        browserLog.warn("facet-provider.provenance.unavailable", error);
      }
    }
  }
  const statuses=await readClientPolicyApprovals(unique([...dates.map(p=>p.uri),...numeric.map(p=>p.uri),...tags.map(p=>p.uri)]),signal);
  const approved=new Set(statuses.filter(p=>p.status==="Approved").map(p=>p.uri));
  return {temporal:dates.filter(p=>approved.has(p.uri)),tags:tags.filter(p=>approved.has(p.uri)),
    numeric:eligibleNumeric.filter(p=>approved.has(p.uri)).map(({uri,eligibleProperties,projections})=>({uri,eligibleProperties,projections}))};
}
