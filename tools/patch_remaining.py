from pathlib import Path
root=Path('/mnt/data/maestro-pending-work')
source=root/'graph/maestro-personal-perspectives.ttl'
s=source.read_text()
anchor='# Reusable temporal Personal-facet formatter.'
assert anchor in s
addition='''# Generic temporal facet policy: SHACL, not hard-coded property names,
# determines eligibility from the current FCT facet's observed RDF datatypes.
# This complements the two explicitly path-bound temporal policies below.
# Provider acceptance remains an independent user/curator decision.
<gttp://ggg.maestro.ecosys/shacl/provider/temporal-inferred> a mui:Provider ;
  rdfs:label "Calendar (typed date/time)"@en ;
  mui:accepts <gttp://ggg.maestro.ecosys/shacl/provider/temporal-inferred-input> ;
  mui:widget <gttp://ggg.maestro.ecosys/shacl/widget#TemporalFacet> .
<gttp://ggg.maestro.ecosys/shacl/provider/temporal-inferred-input> a mui:InputShape, sh:NodeShape ;
  sh:property [
    sh:path mui:inferredDatatype ;
    sh:qualifiedValueShape [ sh:in (
      xsd:date xsd:dateTime xsd:dateTimeStamp xsd:gYear xsd:gYearMonth
    ) ] ;
    sh:qualifiedMinCount 1
  ] .

'''
s=s.replace(anchor,addition+anchor)
source.write_text(s)

curator=root/'graph/maestro-curation-providers.ttl'
s=curator.read_text()
anchor='_:curatedProviderList28 rdf:first <gttp://ggg.maestro.ecosys/analyze/spider> ;\n    rdf:rest rdf:nil .'
assert anchor in s
s=s.replace(anchor,'_:curatedProviderList28 rdf:first <gttp://ggg.maestro.ecosys/analyze/spider> ;\n    rdf:rest _:curatedProviderList29 .\n_:curatedProviderList29 rdf:first <gttp://ggg.maestro.ecosys/shacl/provider/temporal-inferred> ;\n    rdf:rest rdf:nil .')
curator.write_text(s)

file=root/'src/lib/client-facet-providers.ts'
s=file.read_text()
needle='''  const numericRows=await selectPersonal('''
assert needle in s
insertion='''  // Generic Calendar providers define SHACL datatype constraints instead of
  // naming particular properties. Materialize actual current-scope datatype
  // evidence and validate it against the provider's RDF shape in the browser.
  // Missing evidence never authorizes a widget. The user's approval gate below
  // remains mandatory, exactly as for Numeric and Tag Cloud.
  const inferredDateRows=await selectPersonal(`${prefixes} SELECT DISTINCT ?provider ?shape ?label WHERE {
    GRAPH <${graph}> {
      ?provider a mui:Provider ; mui:accepts ?shape ; mui:widget ?widget .
      ?widget a mui:DateRangeFacetWidget .
      ?shape a mui:InputShape ; sh:property/sh:path mui:inferredDatatype .
      OPTIONAL { ?widget rdfs:label ?label }
    }
  } LIMIT 30`,ctx,signal);
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
'''
s=s.replace(needle,insertion+needle)
file.write_text(s)
print('patched generic calendar discovery, validation and curator RDF')
