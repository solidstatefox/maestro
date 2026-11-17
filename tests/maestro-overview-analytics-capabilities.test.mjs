import { test } from 'node:test';
import assert from 'node:assert/strict';
import { virtuosoAnalyticsCapabilities, makeNodeAnalyticsQuery, readNodeAnalytics } from '../src/lib/overview-node-metrics.ts';

const sample={uris:['https://example.org/A','https://example.org/B'],predicate:'http://example.org/knows',graph:'urn:test',direction:'property',nativeEnabled:false};
test('Graph Server st_dbms_ver 07.20.build is Virtuoso 7.2, not a native graph analytics release',()=>{
  const capabilities=virtuosoAnalyticsCapabilities('OpenLink Virtuoso Universal Server','07.20.3243');
  assert.equal(capabilities.bi,true);
  assert.equal(capabilities.native,false);
});
test('native functions never run without affirmative, release-aware capability',()=>{
  assert.equal(virtuosoAnalyticsCapabilities('Virtuoso','7.2.17').native,false);
  assert.equal(virtuosoAnalyticsCapabilities('Virtuoso','7.2.18').native,true);
  assert.equal(virtuosoAnalyticsCapabilities('Virtuoso','7.1.0').native,false);
  assert.equal(virtuosoAnalyticsCapabilities('Unknown','7.2.18').bi,false);
  assert.equal(virtuosoAnalyticsCapabilities('Virtuoso','unknown').bi,false);
  assert.equal(virtuosoAnalyticsCapabilities('Virtuoso','6.1.8').bi,false);
});
test('portable scoped degree counts active FCT URI members on chosen graph',()=>{
  const q=makeNodeAnalyticsQuery({...sample,metric:'degree'});
  assert.match(q,/VALUES \?node \{ <https:\/\/example.org\/A> <https:\/\/example.org\/B> \}/);
  assert.match(q,/GRAPH <urn:test>/);
  assert.match(q,/COUNT\(DISTINCT \?other\)/);
  assert.match(q,/LIMIT 30/);
  assert.doesNotMatch(q,/bif:pagerank/);
});
test('Roles reverse edge direction, while native PageRank is strictly gated',()=>{
  assert.equal(makeNodeAnalyticsQuery({...sample,metric:'pagerank'}),null);
  const q=makeNodeAnalyticsQuery({...sample,metric:'pagerank',nativeEnabled:true,direction:'role'});
  assert.match(q,/\?other <http:\/\/example.org\/knows> \?node/);
  assert.match(q,/bif:pagerank/);
  assert.match(q,/FROM <urn:test>/);
  assert.doesNotMatch(q,/GRAPH <urn:test>/);
  assert.match(q,/OPTION \(edges \(\?other, \?node\)\)/);
});
test('invalid member IRIs and invalid relation are not interpolated',()=>{
  assert.equal(makeNodeAnalyticsQuery({...sample,metric:'degree',predicate:'https://x.org/> SERVICE ?s'}),null);
  assert.equal(makeNodeAnalyticsQuery({...sample,metric:'degree',uris:['https://x.org/> DELETE {}']}),null);
});
test('node scores parse finite numbers only',()=>{
  const result=readNodeAnalytics({results:{bindings:[
    {node:{value:'https://x.org/A'},score:{value:'2.75'}},
    {node:{value:'https://x.org/B'},score:{value:'NaN'}},
  ]}});
  assert.equal(result.length,1);
  assert.equal(result[0].score,2.75);
});

test('native metric choices follow OpenLink edges option syntax and rank group memberships up to the population cap',()=>{
  const degree=makeNodeAnalyticsQuery({...sample,metric:'degree_native',nativeEnabled:true,direction:'role'});
  assert.match(degree,/bif:degree_centrality/);
  assert.match(degree,/direction "in"/);
  assert.match(makeNodeAnalyticsQuery({...sample,metric:'eigenvector',nativeEnabled:true}),/bif:eigenvector/);
  const scc=makeNodeAnalyticsQuery({...sample,metric:'scc',nativeEnabled:true});
  assert.match(scc,/bif:scc/);
  assert.match(scc,/LIMIT 120/);
});
