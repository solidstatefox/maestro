import type { ProviderValidationData } from "./client-provider-validation";
import { isValidRdfIri } from "./rdf-iri";
/** Declarative output of a provider's sandboxed XSLT. Only data, never executable markup. */
export type ProviderRadar = { members:{key:string;label:string}[]; chart:Record<string,string|number>[]; description:string };
export type ProviderPageProgram = {data:ProviderValidationData;message:string;description:string;radar:ProviderRadar|null};
export function parseProviderPageProgram(xml:string):ProviderPageProgram{
 const doc=new DOMParser().parseFromString(xml,"application/xml");
 const root=doc.documentElement;
 if(root.localName!=="analysis"||doc.getElementsByTagName("parsererror").length)throw new Error("Provider must return a valid analysis document.");
 const children=(node:Element,name:string)=>Array.from(node.children).filter(e=>e.localName===name);
 const attr=(node:Element,key:string)=>node.getAttribute(key)||"";
 const validation=children(root,"validation")[0];
 const focus=validation?children(validation,"focus").map(e=>({iri:attr(e,"iri"),label:attr(e,"label")})):[];
 if(focus.length>5000||focus.some(f=>!isValidRdfIri(f.iri))||new Set(focus.map(f=>f.iri)).size!==focus.length)throw new Error("Invalid provider validation focus nodes.");
 const triples=validation?children(validation,"triple").map(e=>({subject:attr(e,"subject"),predicate:attr(e,"predicate"),object:e.textContent||"",objectType:attr(e,"type")||"literal",datatype:attr(e,"datatype")||undefined,lang:attr(e,"lang")||undefined})):[];
 if(triples.length>10000)throw new Error("Provider validation data exceeds the triple limit.");
 const message=children(root,"message")[0]?.textContent||"";
 const description=children(root,"description")[0]?.textContent||"";
 const chartNode=children(root,"radar")[0];let radar:ProviderRadar|null=null;
 if(chartNode){
  const members=children(chartNode,"member").map((e,i)=>({key:`m${i}`,label:attr(e,"label")}));
  const axes=children(chartNode,"axis");
  if(!focus.length||!members.length||members.length>500||axes.length<3||axes.length*members.length>5000)throw new Error("Invalid provider radar dimensions.");
  const chart=axes.map(axis=>{
   const cells=children(axis,"cell");if(cells.length!==members.length)throw new Error("Provider radar cells do not match its series.");
   const row:Record<string,string|number>={axis:attr(axis,"label")};
   cells.forEach((cell,i)=>{const lexical=attr(cell,"value"),value=Number(lexical);if(!lexical||!Number.isFinite(value)||value<0||value>100)throw new Error("Invalid radar coordinate.");row[members[i].key]=value;row[`raw_${members[i].key}`]=attr(cell,"raw");});return row;
  });radar={members,chart,description:attr(chartNode,"description")};
 }
 if(!focus.length&&!message)throw new Error("Provider did not supply validation targets or an empty-result explanation.");
 return {data:{focus,triples},message,description,radar};
}
