/**
 * Render the same list-values projection SELECT as the FCT proxy's
 * expandListValues stage. Unlike a plain FCT list view, the projection is
 * evaluated against a page of already-selected RDF resources.
 */
export type ProjectionColumn = { property: string; direction: "forward" | "reverse"; path?: string[] };
export type ProjectionTerm = { value: string; type: "uri" | "literal"; datatype?: string; lang?: string };
const iri = (s: string) => /^(?:https?:|gttp:|gttps:|urn:)[^\s<>"{}|^`\\]+$/i.test(s);
const sparqlTerm = (term: ProjectionTerm): string => {
  if (term.type === "uri") return iri(term.value) ? `<${term.value}>` : "";
  const value = JSON.stringify(term.value);
  if (term.datatype && iri(term.datatype)) return `${value}^^<${term.datatype}>`;
  if (term.lang && /^[A-Za-z0-9-]+$/.test(term.lang)) return `${value}@${term.lang}`;
  return value;
};
export function listValuesProjectionSparql(resources: ProjectionTerm[], columns: ProjectionColumn[], graph: string): string {
  const subjectValues = [...new Set(resources.map(sparqlTerm).filter(Boolean))].join(" ");
  const branches = columns.slice(0, 24).filter(col => iri(col.property)).map((col, index) => {
    const path = col.path?.length ? col.path : [col.property];
    if (!path.every(iri)) return "";
    const predicate = path.map(p => `<${p}>`).join("/");
    const triple = col.direction === "reverse" ? `?value ${predicate} ?resource .` : `?resource ${predicate} ?value .`;
    const scope = graph && iri(graph) ? `GRAPH <${graph}> { ${triple} }` : triple;
    return `{ VALUES ?resource { ${subjectValues} } VALUES ?column { ${index} } ${scope} }`;
  }).filter(Boolean);
  return `SELECT ?resource ?column ?value WHERE { ${branches.join(" UNION ")} }`;
}
