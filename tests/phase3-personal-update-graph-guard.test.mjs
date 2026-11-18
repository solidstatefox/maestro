import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPersonalUpdateGraphs } from '../src/lib/personal-update-graph-guard.ts';
const base='https://personal.example/DAV/home/alice/query';
const named=`${base}#bookmarks`;
test('bookmark update ignores GRAPH text inside stored WikiPathways SPARQL',()=>{
  const source='SELECT ?x WHERE { GRAPH <http://rdf.wikipathways.org/graph/authors> { ?x ?p ?o } }';
  const update=`DELETE { GRAPH <${named}> { ?s ?p ?o } } INSERT { GRAPH <${named}> { <urn:bookmark> <urn:query> ${JSON.stringify(source)} . } } WHERE { GRAPH <${named}> { OPTIONAL { ?s ?p ?o } } }`;
  const result=inspectPersonalUpdateGraphs(update);
  assert.deepEqual(result.graphs,[named,named,named]);
  assert.equal(result.hasImplicitGraph,false);
  assert.doesNotMatch(result.clean,/wikipathways|\bFROM\b/);
});
test('foreign update graph remains exposed to namespace authorization',()=>{
  const result=inspectPersonalUpdateGraphs('DELETE { GRAPH <http://rdf.wikipathways.org/graph/authors> { ?s ?p ?o } } WHERE {}');
  assert.deepEqual(result.graphs,['http://rdf.wikipathways.org/graph/authors']);
});
test('dynamic GRAPH target is rejected, even with one explicit target',()=>{
  const result=inspectPersonalUpdateGraphs(`INSERT { GRAPH <${named}> {?s ?p ?o} } WHERE { GRAPH ?graph {?s ?p ?o} }`);
  assert.equal(result.hasImplicitGraph,true);
});
test('single, double, triple quoted strings, escaped quotes and # comments cannot add graphs',()=>{
  const update=`INSERT DATA { GRAPH <${named}> { <urn:a> <urn:b> 'GRAPH <urn:foreign>' . <urn:a> <urn:b> "GRAPH \\\"<urn:foreign>\\\"" . <urn:a> <urn:b> '''GRAPH <urn:foreign>''' . } } # GRAPH <urn:evil>`;
  const result=inspectPersonalUpdateGraphs(update);
  assert.deepEqual(result.graphs,[named]);
  assert.equal(result.hasImplicitGraph,false);
});
