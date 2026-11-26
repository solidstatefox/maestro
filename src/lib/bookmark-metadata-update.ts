import { isValidRdfIri } from "./rdf-iri";

export type BookmarkMetadata = {title:string; description:string; tags:string[]; tagVocabulary:"skos"|"dcterms"|"scot"};
const DCT="http://purl.org/dc/terms/";
const RDFS="http://www.w3.org/2000/01/rdf-schema#";
const BOOKMARK="http://www.w3.org/2002/01/bookmark#Bookmark";
const tags={skos:"http://www.w3.org/2004/02/skos/core#prefLabel",dcterms:DCT+"subject",scot:"http://rdfs.org/scot/ns#has_tag"} as const;
/** Never rewrite query identity, URL, recalls, timestamps, lineage or appbar registration. */
export function bookmarkMetadataUpdate(graph:string,id:string,metadata:BookmarkMetadata):string{
 if(!isValidRdfIri(graph)||!isValidRdfIri(id))throw new Error("Invalid Bookmark graph or identity.");
 const title=metadata.title.trim();const description=metadata.description.trim();
 if(!title||title.length>300||description.length>5000||!Object.hasOwn(tags,metadata.tagVocabulary))throw new Error("Invalid Bookmark metadata.");
 const values=[...new Set(metadata.tags.map(tag=>tag.trim()).filter(Boolean))];
 if(values.length>50||values.some(tag=>tag.length>200))throw new Error("Too many or oversized tags.");
 const fields=[DCT+"title",RDFS+"label",DCT+"description",...Object.values(tags)];
 const triples=[[DCT+"title",title],[RDFS+"label",title],...(description?[[DCT+"description",description]]:[]),...values.map(tag=>[tags[metadata.tagVocabulary],tag])];
 return `DELETE { GRAPH <${graph}> { <${id}> ?p ?o } }
INSERT { GRAPH <${graph}> { ${triples.map(([p,o])=>`<${id}> <${p}> ${JSON.stringify(o)} .`).join("\n")} } }
WHERE { GRAPH <${graph}> { <${id}> a <${BOOKMARK}> . OPTIONAL { <${id}> ?p ?o . FILTER(?p IN (${fields.map(p=>`<${p}>`).join(", ")})) } } }`;
}
