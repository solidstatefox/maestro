import {test} from "node:test";
import assert from "node:assert/strict";
import {
  makeOverviewConnectionQuery,readOverviewConnectionPaths,makeOverviewConnectionEdgesQuery,
  attachOverviewConnectionEdges,OVERVIEW_CONNECTION_MAX_HOPS,
} from "../src/lib/overview-connection-path.ts";
const source="http://example.org/a", intermediate="http://example.org/m", target="http://example.org/b";
const endpoint="https://dbpedia.org/sparql";
const input={source,target,endpoint,maxHops:3};
const binding=(v)=>({value:String(v)});

test("Virtuoso shortest path is bounded, scoped, read-only and accepts changing predicates",()=>{
  const query=makeOverviewConnectionQuery({...input,graph:"http://example.org/graph"});
  assert.match(query,/OPTION \(TRANSITIVE/);
  assert.match(query,/T_SHORTEST_ONLY/);
  assert.match(query,/T_MAX\(3\)/);
  assert.match(query,/GRAPH <http:\/\/example.org\/graph>/);
  assert.match(query,/SELECT \?s \?o WHERE/);
  assert.doesNotMatch(query,/INSERT|DELETE|CLEAR GRAPH/);
  assert.match(makeOverviewConnectionQuery({...input,maxHops:99}),new RegExp(`T_MAX\\(${OVERVIEW_CONNECTION_MAX_HOPS}\\)`));
  assert.match(makeOverviewConnectionQuery({...input,predicate:"http://example.org/p"}),/FILTER\(\?p = <http:\/\/example.org\/p>\)/);
});

test("invalid inputs do not issue a path query",()=>{
  assert.equal(makeOverviewConnectionQuery({...input,source:target}),null);
  assert.equal(makeOverviewConnectionQuery({...input,source:'<http://bad> UNION {?s ?p ?o}'}),null);
  assert.equal(makeOverviewConnectionQuery({...input,endpoint:'javascript:alert(1)'}),null);
  assert.equal(makeOverviewConnectionQuery({...input,predicate:'invalid <iri>'}),null);
});

test("intermediate nodes are ordered by actual Virtuoso path_id and step_no",()=>{
  const rows=[
    {link:binding(intermediate),path:binding(2),step:binding(1)},
    {link:binding(source),path:binding(2),step:binding(0)},
    {link:binding(target),path:binding(2),step:binding(2)},
  ];
  const paths=readOverviewConnectionPaths({results:{bindings:rows}},source,target);
  assert.equal(paths.length,1);
  assert.deepEqual(paths[0].nodes.map(n=>n.uri),[source,intermediate,target]);
  const query=makeOverviewConnectionEdgesQuery(paths,"http://example.org/graph");
  assert.match(query,/VALUES \(\?left \?right\)/);
  assert.match(query,/\?right \?predicate \?left/);
  assert.match(query,/GRAPH <http:\/\/example.org\/graph>/);
  const enriched=attachOverviewConnectionEdges(paths,{results:{bindings:[
    {left:binding(source),right:binding(intermediate),predicate:binding('http://example.org/knows'),direction:binding('forward')},
    {left:binding(intermediate),right:binding(target),predicate:binding('http://example.org/creator'),direction:binding('reverse')},
  ]}});
  assert.equal(enriched[0].edges.length,2);
  assert.equal(enriched[0].edges[1].direction,"reverse");
  assert.equal(enriched[0].edges[1].predicate,"http://example.org/creator");
});

test("bad rows cannot become paths and absent predicate metadata does not imply an edge",()=>{
  assert.deepEqual(readOverviewConnectionPaths({results:{bindings:[]}},source,target),[]);
  assert.deepEqual(readOverviewConnectionPaths({results:{bindings:[{link:binding('<evil>'),path:binding(1),step:binding(0)}]}},source,target),[]);
  const paths=readOverviewConnectionPaths({results:{bindings:[{link:binding(source),path:binding(1),step:binding(0)},{link:binding(target),path:binding(1),step:binding(1)}]}},source,target);
  assert.equal(attachOverviewConnectionEdges(paths,{results:{bindings:[]}})[0].edges.length,0);
});
