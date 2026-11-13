"use client";

/** Built-in known vocabulary labels; no HTTP request for static metadata. */
const VOCABULARIES = [
  { namespace: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", document: "https://www.w3.org/1999/02/22-rdf-syntax-ns", prefix: "rdf", label: "RDF Syntax" },
  { namespace: "http://www.w3.org/2000/01/rdf-schema#", document: "https://www.w3.org/2000/01/rdf-schema", prefix: "rdfs", label: "RDF Schema" },
  { namespace: "http://www.w3.org/2002/07/owl#", document: "https://www.w3.org/2002/07/owl", prefix: "owl", label: "Web Ontology Language" },
  { namespace: "http://www.w3.org/2001/XMLSchema#", document: "https://www.w3.org/2001/XMLSchema", prefix: "xsd", label: "XML Schema Datatypes" },
  { namespace: "http://purl.org/dc/terms/", document: "https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl", prefix: "dcterms", label: "DCMI Metadata Terms" },
  { namespace: "http://www.w3.org/2004/02/skos/core#", document: "https://www.w3.org/2009/08/skos-reference/skos.rdf", prefix: "skos", label: "SKOS Vocabulary" },
  { namespace: "http://rdfs.org/scot/ns#", document: "http://rdfs.org/scot/ns", prefix: "scot", label: "Social Semantic Cloud of Tags Ontology" },
  { namespace: "http://www.w3.org/2002/01/bookmark#", document: "https://www.w3.org/2002/01/bookmark", prefix: "bookmark", label: "Annotea Bookmark Schema" },
  { namespace: "http://www.w3.org/2000/10/annotation-ns#", document: "https://www.w3.org/2000/10/annotation-ns", prefix: "a", label: "Annotea Annotation Schema" },
  { namespace: "http://rdfs.org/sioc/ns#", document: "http://rdfs.org/sioc/ns", prefix: "sioc", label: "Semantically-Interlinked Online Communities Ontology" },
  { namespace: "https://schema.org/", document: "https://schema.org/docs/schemaorg-current-https.jsonld", prefix: "schema", label: "Schema.org Vocabulary" },
  { namespace: "http://xmlns.com/foaf/0.1/", document: "http://xmlns.com/foaf/spec/index.rdf", prefix: "foaf", label: "Friend of a Friend Vocabulary" },
  { namespace: "http://www.w3.org/2006/vcard/ns#", document: "https://www.w3.org/2006/vcard/ns", prefix: "vcard", label: "vCard Ontology" },
  { namespace: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs#", document: "https://vos.openlinksw.com/owiki/wiki/VOS/VirtFacetBrowserAPIs", prefix: "vfct", label: "Virtuoso Faceted Browser API" },
];
export const NAMESPACE_METADATA = VOCABULARIES.map(({namespace, prefix, label}) => ({namespace, prefix, label}));
