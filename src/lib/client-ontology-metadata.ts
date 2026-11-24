"use client";
import { GRAPH, resolveGraph } from "@/lib/constants/graphs";

import { personalContext, selectPersonal } from "@/lib/client-personal-sparql";

const RDFS = "http://www.w3.org/2000/01/rdf-schema#", OWL = "http://www.w3.org/2002/07/owl#";
const safe = (iri: string) => /^https?:\/\/[^\s<>"{}|^`\\]+$/i.test(iri) && iri.length <= 4096;
export type OntologyClassMetadata = {uri:string;ontology:string;parent?:string;ontologyLabel?:string};
function namespaceFallback(uri:string):string {
  const hash=uri.lastIndexOf("#");if(hash>=0)return uri.slice(0,hash+1);
  const slash=uri.lastIndexOf("/");return slash>=0?uri.slice(0,slash+1):uri;
}
/** Read only ontology metadata already present in the personal ontology/cache
 * graphs. FCT's class-tree relationships are authoritative for the live
 * Categories widget. Navigating a facet must never automatically dereference
 * arbitrary public vocabulary IRIs or write RDF using SPARQL LOAD: public
 * vocabulary servers often redirect without CORS support and LOAD can be
 * unauthorized. Explicit, user-driven imports are a separate workflow. */
export async function readOntologyMetadata(uris: string[], signal?:AbortSignal):Promise<OntologyClassMetadata[]> {
  const requested=[...new Set(uris.filter(safe))].slice(0,100);
  if(!requested.length)return [];
  const ctx=await personalContext(),graph=`${resolveGraph(GRAPH.ONTOLOGY, ctx.base)}`,seed=`${resolveGraph(GRAPH.ONTOLOGY_CACHE, ctx.base)}`;
  const values=requested.map(uri=>`<${uri}>`).join(" ");
  const items=await selectPersonal(`PREFIX rdfs: <${RDFS}> PREFIX owl: <${OWL}>
    SELECT DISTINCT ?class ?parent ?ontology ?ontologyLabel WHERE {
      VALUES ?class { ${values} } VALUES ?g { <${graph}> <${seed}> }
      OPTIONAL { GRAPH ?g { ?class rdfs:subClassOf ?parent . FILTER(isIRI(?parent)) } }
      OPTIONAL { GRAPH ?g { ?class rdfs:isDefinedBy ?ontology . FILTER(isIRI(?ontology)) } }
      OPTIONAL { GRAPH ?g { ?ontology a owl:Ontology . OPTIONAL { ?ontology rdfs:label ?ontologyLabel } } }
    }`,ctx,signal,"client-ontology-metadata:readOntologyMetadata");
  const metadata=new Map<string,OntologyClassMetadata>();
  for (const row of items) {
    const uri=row.class?.value??"";if(!requested.includes(uri))continue;
    const item:OntologyClassMetadata=metadata.get(uri)??{uri,ontology:namespaceFallback(uri)};
    item.parent=row.parent?.value??item.parent;
    item.ontology=row.ontology?.value??item.ontology;
    item.ontologyLabel=row.ontologyLabel?.value??item.ontologyLabel;
    metadata.set(uri,item);
  }
  if(requested.length>1){
    const candidates=await selectPersonal(`PREFIX rdfs: <${RDFS}>
      SELECT DISTINCT ?class ?candidateParent WHERE {
        VALUES ?class { ${values} } VALUES ?g { <${graph}> <${seed}> } VALUES ?candidateParent { ${values} }
        FILTER(?class != ?candidateParent)
        GRAPH ?g { ?class rdfs:subClassOf+ ?candidateParent }
        FILTER NOT EXISTS {
          VALUES ?middle { ${values} }
          FILTER(?middle != ?class && ?middle != ?candidateParent)
          GRAPH ?g { ?class rdfs:subClassOf+ ?middle . ?middle rdfs:subClassOf+ ?candidateParent }
        }
      }`,ctx,signal,"client-ontology-metadata:readOntologyMetadata");
    const parents=new Map<string,string[]>();
    for(const row of candidates){const child=row.class?.value??"",parent=row.candidateParent?.value??"";
      if(!requested.includes(child)||!requested.includes(parent)||child===parent)continue;
      const choices=parents.get(child)??[];choices.push(parent);parents.set(child,choices);
    }
    for(const [child,choices] of parents){
      const item:OntologyClassMetadata=metadata.get(child)??{uri:child,ontology:namespaceFallback(child)};
      item.parent=choices.sort((a,b)=>a.localeCompare(b))[0];metadata.set(child,item);
    }
  }
  return requested.map(uri=>metadata.get(uri)??{uri,ontology:namespaceFallback(uri)});
}
