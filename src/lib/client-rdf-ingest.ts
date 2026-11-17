"use client";
/** Browser-side RDF parser/serializer for named-graph imports.  The hosting
 * process only forwards requested bytes; it never parses RDF or writes data. */
import { Parser } from "n3";
import { createBlankNodeLabelAllocator } from "@/lib/bnode";

type Term={termType:"NamedNode"|"BlankNode"|"Literal";value:string;language?:string;datatype?:{value:string}};
export type ClientRdfTriple={subject:Term;predicate:Term;object:Term};
const RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#",XSD="http://www.w3.org/2001/XMLSchema#";
const XML="http://www.w3.org/XML/1998/namespace";
const node=(value:string):Term=>({termType:"NamedNode",value});
const bnode=(value:string):Term=>({termType:"BlankNode",value});
const literal=(value:string,datatype?:string,language?:string):Term=>({termType:"Literal",value,
  ...(language?{language}:{}),datatype:{value:datatype??(language?`${RDF}langString`:`${XSD}string`)}});
function parseRdfXml(xml:string,baseUrl:string):ClientRdfTriple[]{
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.querySelector("parsererror"))throw new Error("Invalid RDF/XML document.");
  const root=doc.documentElement;
  if(root.namespaceURI!==RDF||root.localName!=="RDF")throw new Error("RDF/XML document requires rdf:RDF root.");
  const triples:ClientRdfTriple[]=[];
  let counter=0;
  const blank=()=>bnode(`maestro_xml_${++counter}`);
  const idMap=new Map<string,Term>();
  const named=(raw:string,base:string)=>node(new URL(raw,base).href);
  const resolveBase=(element:Element,base:string)=>element.hasAttributeNS(XML,"base")?
    new URL(element.getAttributeNS(XML,"base")!,base).href:base;
  const id=(value:string)=>{
    if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value))throw new Error("Invalid rdf:nodeID.");
    let term=idMap.get(value);if(!term){term=blank();idMap.set(value,term);}return term;
  };
  const subject=(el:Element,base:string):Term=>{
    const about=el.getAttributeNS(RDF,"about");if(about!==null)return named(about,base);
    const refId=el.getAttributeNS(RDF,"ID");if(refId!==null)return named(`#${refId}`,base);
    const nodeId=el.getAttributeNS(RDF,"nodeID");return nodeId!==null?id(nodeId):blank();
  };
  const add=(s:Term,p:Term,o:Term)=>triples.push({subject:s,predicate:p,object:o});
  function parseNode(el:Element,base:string,lang:string):Term{
    const localBase=resolveBase(el,base),localLang=el.getAttributeNS(XML,"lang")??lang;
    const term=subject(el,localBase);
    if(!(el.namespaceURI===RDF&&el.localName==="Description")){
      if(!el.namespaceURI)throw new Error("Unqualified RDF/XML node name.");
      add(term,node(`${RDF}type`),node(el.namespaceURI+el.localName));
    }
    for(const attr of Array.from(el.attributes)){
      if(attr.namespaceURI===RDF&&["about","ID","nodeID"].includes(attr.localName))continue;
      if(attr.namespaceURI===XML||attr.name==="xmlns"||attr.prefix==="xmlns")continue;
      if(attr.namespaceURI&&attr.namespaceURI!==RDF) add(term,node(attr.namespaceURI+attr.localName),literal(attr.value,undefined,localLang));
      else if(attr.namespaceURI===RDF&&attr.localName==="type")add(term,node(`${RDF}type`),named(attr.value,localBase));
      else throw new Error(`Unsupported RDF/XML node attribute ${attr.name}.`);
    }
    let li=0;
    for(const property of Array.from(el.children)){
      const propertyBase=resolveBase(property,localBase),propertyLang=property.getAttributeNS(XML,"lang")??localLang;
      if(!property.namespaceURI)throw new Error("Unqualified RDF/XML property name.");
      const pred=property.namespaceURI===RDF&&property.localName==="li"
        ? node(`${RDF}_${++li}`):node(property.namespaceURI+property.localName);
      if(property.hasAttributeNS(RDF,"ID"))throw new Error("RDF/XML statement reification is not supported.");
      const resource=property.getAttributeNS(RDF,"resource"),nodeId=property.getAttributeNS(RDF,"nodeID");
      const parseType=property.getAttributeNS(RDF,"parseType");
      if(resource!==null&&nodeId!==null)throw new Error("Ambiguous RDF/XML property resource and nodeID.");
      if(parseType){
        if(parseType==="Resource"){
          const b=blank();add(term,pred,b);
          // Build a synthetic RDF Description but preserve the contained XML.
          const clone=doc.createElementNS(RDF,"rdf:Description");
          for(const child of Array.from(property.children))clone.appendChild(child.cloneNode(true));
          // Read the blank node's nested predicates without emitting another subject.
          const scoped=parseNode(clone,propertyBase,propertyLang);
          for(const triple of triples)if(triple.subject===scoped)triple.subject=b;
        }else if(parseType==="Collection"){
          const items=Array.from(property.children).map(child=>parseNode(child,propertyBase,propertyLang));
          if(!items.length){add(term,pred,node(`${RDF}nil`));continue;}
          const list=items.map(()=>blank());add(term,pred,list[0]);
          for(let i=0;i<items.length;i++){
            add(list[i],node(`${RDF}first`),items[i]);add(list[i],node(`${RDF}rest`),i===items.length-1?node(`${RDF}nil`):list[i+1]);
          }
        }else if(parseType==="Literal"){
          const content=Array.from(property.childNodes).map(n=>new XMLSerializer().serializeToString(n)).join("");
          add(term,pred,literal(content,`${RDF}XMLLiteral`));
        }else throw new Error(`Unsupported RDF/XML parseType ${parseType}.`);
        continue;
      }
      if(resource!==null){add(term,pred,named(resource,propertyBase));continue;}
      if(nodeId!==null){add(term,pred,id(nodeId));continue;}
      const children=Array.from(property.children);
      if(children.length){
        if(children.length!==1||Array.from(property.childNodes).some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()))
          throw new Error("RDF/XML property contains ambiguous mixed RDF/XML content.");
        add(term,pred,parseNode(children[0],propertyBase,propertyLang));
        continue;
      }
      const datatype=property.getAttributeNS(RDF,"datatype");
      add(term,pred,literal(property.textContent??"",datatype?new URL(datatype,propertyBase).href:undefined,propertyLang));
    }
    return term;
  }
  const startBase=resolveBase(root,baseUrl),startLang=root.getAttributeNS(XML,"lang")??"";
  for(const child of Array.from(root.children))parseNode(child,startBase,startLang);
  return triples;
}
export async function parseClientRdf(content:string,extension:string,base:string):Promise<ClientRdfTriple[]>{
  if(content.length>800_000)throw new Error("RDF document exceeds safe parser limit.");
  if([".rdf",".owl",".rdfs",".xml"].includes(extension))return parseRdfXml(content,base);
  if(extension===".jsonld"){
    const jsonld=(await import("jsonld")).default;
    const nquads=await jsonld.toRDF(JSON.parse(content),{base,format:"application/n-quads",
      documentLoader:async()=>{throw new Error("External JSON-LD contexts are disabled.");}});
    return parseClientRdf(String(nquads),".nq",base);
  }
  const format=({".ttl":"Turtle",".nt":"N-Triples",".n3":"N3",".trig":"TriG",".nq":"N-Quads"} as Record<string,string>)[extension];
  if(!format)throw new Error(`Unsupported RDF source type ${extension}.`);
  return new Parser({format,baseIRI:base}).parse(content).map(quad=>({
    subject:{termType:quad.subject.termType as Term["termType"],value:quad.subject.value},
    predicate:{termType:"NamedNode",value:quad.predicate.value},
    object:{termType:quad.object.termType as Term["termType"],value:quad.object.value,
      ...(quad.object.termType==="Literal"?{language:quad.object.language,datatype:{value:quad.object.datatype.value}}:{})},
  }));
}
const hex4=(char:string)=>`\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4,"0")}`;
const escapedIri=(uri:string)=>`<${uri.replace(/[\u0000-\u0020<>"{}|^`\\]/g,hex4)}>`;
const escapedLiteral=(t:Term)=>{
  const value=t.value.replace(/[\\"\n\r\t\u0000-\u001f\u007f]/g,char=>({"\\":"\\\\",'"':'\\"',"\n":"\\n","\r":"\\r","\t":"\\t"} as Record<string,string>)[char]??hex4(char));
  return `"${value}"${t.language?`@${t.language}`:t.datatype?.value&&t.datatype.value!==`${XSD}string`&&t.datatype.value!==`${RDF}langString`?`^^${escapedIri(t.datatype.value)}`:""}`;
};
export function clientRdfInsert(graph:string,triples:ClientRdfTriple[]):string{
  const blank=createBlankNodeLabelAllocator("rdf");
  const term=(t:Term)=>t.termType==="BlankNode"?`_:${blank(t.value)}`:t.termType==="Literal"?escapedLiteral(t):escapedIri(t.value);
  return `INSERT DATA { GRAPH ${escapedIri(graph)} { ${triples.map(t=>`${term(t.subject)} ${term(t.predicate)} ${term(t.object)} .`).join("\n")} } }`;
}
