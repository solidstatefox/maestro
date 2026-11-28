import test from 'node:test';
import assert from 'node:assert/strict';
import { FCT_VIEW_TYPES, isFctViewType } from '../src/lib/fct-view-types';
import { compileFctXmlToSparql } from '../src/lib/fct-sparql-translator';
import {
  analyzePredicateCounts, predicateAnalysisPage, predicatePresenceEntropy,
  MAX_PREDICATE_ANALYSIS_CANDIDATES,
} from '../src/lib/fct-predicate-analytics';

const BASE = 'http://example.org/';
const xml = (view: string, focus = false, graph = '$ALL$') => `<query xmlns="http://openlinksw.com/services/facets/1.0" id="a"
  addr="${graph}@https://example.org/sparql">
  <class iri="${BASE}Film" id="b"/>
  ${focus ? `<property iri="${BASE}director" id="c"><view type="${view}" limit="2" offset="4"/></property>`
    : `<view type="${view}" limit="2" offset="4"/>`}
</query>`;

test('the only new FCT types are the agreed properties-rank, properties-cluster, and clusters', () => {
  for (const v of ['properties-rank', 'properties-cluster', 'clusters']) assert.ok(isFctViewType(v));
  assert.equal(isFctViewType('properties-clusters'), false);
  assert.equal(isFctViewType('properties-cluster-count'), false);
  assert.equal(FCT_VIEW_TYPES.CLUSTERS, 'clusters');
});

test('all three FCT views compile the same bounded incidence page, not remote aggregates', () => {
  for (const view of ['properties-rank', 'properties-cluster', 'clusters']) {
    const result = compileFctXmlToSparql(xml(view));
    assert.equal(result.view, view);
    assert.equal(result.limit, 2);
    assert.equal(result.offset, 4);
    assert.match(result.query, /SELECT DISTINCT/);
    assert.match(result.query, /\?s1/);
    assert.match(result.query, /\?maestroPredicate/);
    assert.match(result.query, /ORDER BY/);
    assert.match(result.query, /LIMIT 500/);
    assert.match(result.query, /<http:\/\/example\.org\/Film>/);
    assert.doesNotMatch(result.query, /COUNT\(|GROUP BY|VALUES \?maestroPredicate|VALUES \?maestroP[12]/);
    assert.doesNotMatch(result.query, /OFFSET 4/);
  }
});

test('incidence pages are deterministic and preserve the exact FCT scope', () => {
  const doc = xml('properties-rank');
  const first = compileFctXmlToSparql(doc, undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:0,limit:250});
  const next = compileFctXmlToSparql(doc, undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:250,limit:250});
  assert.match(first.query,/SELECT DISTINCT/);
  assert.match(first.query,/ORDER BY ASC \(\?s1\) ASC \(\?maestroPredicate\)/);
  assert.match(first.query,/LIMIT 250/);
  assert.match(next.query,/OFFSET 250/);
  assert.match(first.query,/<http:\/\/example\.org\/Film>/);
  assert.equal((first.query.match(/<http:\/\/example\.org\/Film>/g) ?? []).length,1);
  for (const q of [first.query,next.query]) {
    assert.doesNotMatch(q,/VALUES \?maestroPredicate|VALUES \?maestroP[12]|GROUP BY|COUNT\(/);
    assert.ok(q.length < 4000,'the query must not scale with the number of discovered IRIs');
  }
});

test('nested-focus analytics preserve its breadcrumb path and graph scope', () => {
  const q = compileFctXmlToSparql(xml('properties-cluster', true, `${BASE}graph`));
  assert.match(q.query, /GRAPH <http:\/\/example\.org\/graph>/);
  assert.match(q.query, /<http:\/\/example\.org\/director>/);
  assert.match(q.query, /\?s2 \?maestroPredicate \?maestroPropertyObject/);
});

test('nested focus retains its graph and breadcrumb in every incidence page', () => {
  const doc = xml('clusters',true,`${BASE}graph`);
  const one = compileFctXmlToSparql(doc,undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:300,limit:100});
  assert.match(one.query,/GRAPH <http:\/\/example\.org\/graph>/);
  assert.match(one.query,/<http:\/\/example\.org\/director>/);
  assert.match(one.query,/\?s2 \?maestroPredicate \?maestroPropertyObject/);
  assert.match(one.query,/OFFSET 300/);
  assert.doesNotMatch(one.query,/VALUES \?maestroPredicate|VALUES \?maestroP[12]|GROUP BY|COUNT\(/);
});

test('compiler never serializes a candidate list or quadratic predicate self join', () => {
  const doc = xml('properties-cluster');
  const compiled = compileFctXmlToSparql(doc,undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:0,limit:500});
  assert.doesNotMatch(compiled.query,/VALUES \?maestroP1|VALUES \?maestroP2|maestroObject1|maestroObject2/);
  assert.equal((compiled.query.match(/\?maestroPredicate \?maestroPropertyObject/g) ?? []).length,1);
  assert.throws(() => compileFctXmlToSparql(doc,undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:-1,limit:500}),/bounds/);
  assert.throws(() => compileFctXmlToSparql(doc,undefined,false,false,false,false,undefined,'en',undefined,
    {kind:'incidence',offset:0,limit:1001}),/bounds/);
});

test('AHC groups identical incidence, isolates disjoint predicates, and assigns global ordinal rank', () => {
  const input = [
    {uri:'urn:p:a',subjects:3}, {uri:'urn:p:b',subjects:3}, {uri:'urn:p:c',subjects:2},
  ];
  const result = analyzePredicateCounts(input,[{left:'urn:p:a',right:'urn:p:b',sharedSubjects:3}],5,0.55);
  assert.deepEqual(result.clusters.map(c => c.count),[2,1]);
  assert.deepEqual(result.assignments.filter(r=>r.cluster==='C1').map(r=>r.property).sort(),['urn:p:a','urn:p:b']);
  assert.deepEqual(result.ranks.map(r=>r.rank),[1,2,3]);
  assert.equal(result.clusters[0].sample, result.ranks[0].property);
  assert.deepEqual(predicateAnalysisPage(result,'properties-rank',1,1),[result.ranks[1]]);
  assert.deepEqual(predicateAnalysisPage(result,'clusters',1,1),[result.clusters[1]]);
});

test('average linkage is size-weighted and singletons remain valid', () => {
  const result = analyzePredicateCounts([
    {uri:'urn:a',subjects:4},{uri:'urn:b',subjects:4},{uri:'urn:c',subjects:4}
  ],[
    {left:'urn:a',right:'urn:b',sharedSubjects:4},
    {left:'urn:a',right:'urn:c',sharedSubjects:3},
    {left:'urn:b',right:'urn:c',sharedSubjects:1},
  ], 8, 0.45);
  assert.deepEqual(result.clusters.map(c=>c.count),[2,1]);
  assert.equal(analyzePredicateCounts([{uri:'urn:a',subjects:1}],[],1).clusters[0].count,1);
  assert.equal(analyzePredicateCounts([],[],0).clusters.length,0);
});

test('entropy, invalid inputs, duplicate pairs, and the candidate limit', () => {
  assert.equal(predicatePresenceEntropy(0),0);
  assert.equal(predicatePresenceEntropy(1),0);
  assert.equal(predicatePresenceEntropy(0.5),1);
  assert.throws(()=>analyzePredicateCounts([{uri:'p',subjects:5}],[],4),/Invalid/);
  assert.throws(()=>analyzePredicateCounts([{uri:'p',subjects:1},{uri:'q',subjects:1}],
    [{left:'p',right:'q',sharedSubjects:1},{left:'q',right:'p',sharedSubjects:1}],3),/Duplicate/);
  const tooMany = Array.from({length:MAX_PREDICATE_ANALYSIS_CANDIDATES+1},(_,i)=>({uri:`urn:${i}`,subjects:1}));
  assert.throws(()=>analyzePredicateCounts(tooMany,[],1),/exceeds/);
});

test('provider-owned candidate and incidence budgets are independent of FCT result pagination', () => {
  const configured = xml('properties-cluster').replace('<view type=', '<view max-candidates="650" max-incidence-rows="75000" type=')
    .replace(' id="a"', ' id="a" timeout="180000"');
  const compiled = compileFctXmlToSparql(configured);
  assert.equal(compiled.timeoutMs, 180000);
  assert.equal(compiled.maxPredicateCandidates, 650);
  assert.equal(compiled.maxPredicateIncidenceRows, 75000);
  assert.equal(compiled.limit, 2);
  assert.match(compiled.query, /LIMIT 500/);
  assert.doesNotMatch(compiled.query,/LIMIT 2|VALUES \?maestroPredicate|GROUP BY/);
  assert.throws(() => compileFctXmlToSparql(configured.replace('650','1001')),/max-candidates/);
  assert.throws(() => compileFctXmlToSparql(configured.replace('75000','500001')),/max-incidence-rows/);
  assert.throws(() => compileFctXmlToSparql(configured.replace('75000','0')),/max-incidence-rows/);
});
