import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFctXmlToSparql, type SparqlBindingTerm, type SparqlJsonResults } from '../src/lib/fct-sparql-translator';
import { isFctViewType, predicateSynsetAlgorithm } from '../src/lib/fct-view-types';
import { SYNSET_VERSION_QUERY,SYNSET_BI_PROBE,probeRuleAlignCapability,relationAgreement,readSynsetRows } from '../src/lib/predicate-synset';
import { executePredicateSynset } from '../src/lib/predicate-synset-execution';
import { buildSynsetQuery,synsetCarrier,synsetTreeForRankedProperty,SYNSET_SETTINGS } from '../src/lib/property-synset-query';
import type { FctQueryTree } from '../src/lib/fct-query';
const xml=(algorithm='relation-agreement',reverse=false,attrs='',graph='$ALL$',filter='')=>`<query xmlns="http://openlinksw.com/services/facets/1.0" addr="${graph}@https://example.org/sparql" id="a"><class iri="urn:Person" id="b"/><${reverse?'property-of':'property'} iri="urn:reference" id="c">${filter}<view type="properties-synset" algorithm="${algorithm}" ${attrs}/></${reverse?'property-of':'property'}></query>`;
const lit=(value:string|number):SparqlBindingTerm=>({type:'literal',value:String(value)});
const uri=(value:string):SparqlBindingTerm=>({type:'uri',value});
const data=(rows:Record<string,SparqlBindingTerm>[]):SparqlJsonResults=>({head:{vars:Object.keys(rows[0]??{})},results:{bindings:rows}});
const signal=()=>new AbortController().signal;
const version=data([{product:lit('OpenLink Virtuoso'),version:lit('07.20.3243')}]);
const witness=data([{n:lit(1)}]);
const budget=data([{candidates:lit(3),pairs:lit(80)}]);
const scores=data([{c1:uri('urn:other'),similarity:lit(.5)}]);
const counts={reference:lit(100),candidate:lit(20),common:lit(20),subjectsUnion:lit(100),agreeingSubjects:lit(20)};
test('new view defaults to Relation Agreement and rejects unknown algorithms and root carriers',()=>{
 assert.ok(isFctViewType('properties-synset'));assert.equal(predicateSynsetAlgorithm(undefined),'relation-agreement');
 assert.equal(compileFctXmlToSparql(xml().replace(' algorithm="relation-agreement"','')).predicateSynset?.algorithm,'relation-agreement');
 assert.throws(()=>compileFctXmlToSparql(xml('structural')),/algorithm/);
 assert.throws(()=>compileFctXmlToSparql('<query id="a" addr="$ALL$@https://example.org/sparql"><view type="properties-synset"/></query>'),/carrier/);
});
test('Relation Agreement compiles exact tuple intersections and scoped parent statistics',()=>{
 for(const reverse of [false,true]){
  const plan=compileFctXmlToSparql(xml('relation-agreement',reverse,'limit="2" offset="4"','urn:graph'));
  assert.equal(plan.limit,2);assert.equal(plan.offset,4);assert.equal(plan.predicateSynset?.carrier,'urn:reference');
  assert.match(plan.query,/SELECT DISTINCT/);assert.match(plan.query,/GROUP BY/);assert.match(plan.query,/\?agreeingSubjects/);assert.match(plan.query,/\?subjectsUnion/);
  assert.match(plan.query,/GRAPH <urn:graph>/);assert.match(plan.query,/<urn:Person>/);
  assert.match(plan.query,reverse?/\?synObject <urn:reference> \?s1/:/\?s1 <urn:reference> \?synObject/);
  assert.match(plan.predicateSynset!.budgetQuery,/<urn:reference>/,'candidate discovery requires overlap with carrier');
  assert.match(plan.predicateSynset!.budgetQuery,/\?candidatePairs/);
  assert.match(plan.predicateSynset!.budgetQuery,/\?referencePairs/);
  assert.doesNotMatch(plan.query,/OFFSET 4/);
 }
});
test('an explicitly constrained carrier retains its FCT binding',()=>{
 const plan=compileFctXmlToSparql(xml('relation-agreement',false,'','$ALL$','<value datatype="uri" id="e">urn:chosen</value>'));
 assert.match(plan.predicateSynset!.budgetQuery,/<urn:reference>/);assert.match(plan.predicateSynset!.budgetQuery,/<urn:chosen>/);
});
test('RuleAlign returns server-side full-set Jaccard and all oriented body variants',()=>{
 const p=compileFctXmlToSparql(xml('rulealign',false,'max-rule-length="2"'));
 assert.match(p.query,/\?referenceDefinitions/);assert.match(p.query,/\?candidateDefinitions/);assert.match(p.query,/\?commonDefinitions/);
 assert.match(p.query,/ENCODE_FOR_URI/);assert.match(p.query,/\?synIntermediate/);assert.match(p.query,/\?bodySize/);assert.match(p.query,/\?headSize/);
 assert.ok(p.predicateSynset?.ruleBudgetQuery);assert.match(p.query,/"\|r:"/);
 const one=compileFctXmlToSparql(xml('rulealign',false,'max-rule-length="1"'));
 assert.doesNotMatch(one.query,/\?synIntermediate/);
 assert.throws(()=>compileFctXmlToSparql(xml('rulealign',false,'max-rule-length="3"')), /max-rule-length/);
 assert.throws(()=>compileFctXmlToSparql(xml('rulealign',false,'min-confidence="2"')), /min-confidence/);
});
test('Relation Agreement reproduces paper equations and zero overlap',()=>{
 const input={reference:100,candidate:20,common:20,subjectsUnion:100,agreeingSubjects:20};
 const expected=(1+.2)/(2*(1+Math.exp(7.5-20)));
 assert.ok(Math.abs(relationAgreement(input)-expected)<1e-12);
 assert.equal(relationAgreement({...input,common:0,agreeingSubjects:0}),0);
 assert.throws(()=>relationAgreement({...input,common:21}),/Inconsistent/);
 assert.ok(relationAgreement({reference:1,candidate:1,common:1,subjectsUnion:1,agreeingSubjects:1})<.01);
});
test('strict, deterministic result validation',()=>{
 const rows=readSynsetRows([{c1:uri('urn:b'),similarity:lit(.5)},{c1:uri('urn:a'),similarity:lit(.5)}],'urn:reference','rulealign',3,15);
 assert.deepEqual(rows.map(r=>r.c1.value),['urn:a','urn:b']);
 assert.throws(()=>readSynsetRows([{c1:uri('urn:reference'),similarity:lit(.5)}],'urn:reference','rulealign',3,15),/predicate/);
 assert.throws(()=>readSynsetRows([{c1:uri('urn:a'),similarity:lit('NaN')}],'urn:reference','rulealign',3,15),/score/);
 assert.throws(()=>readSynsetRows([{c1:uri('urn:a'),similarity:lit(.5)},{c1:uri('urn:a'),similarity:lit(.5)}],'urn:reference','rulealign',3,15),/duplicate/);
});
test('RuleAlign requires both verified Virtuoso version and actual BI witness',async()=>{
 let calls:string[]=[];
 const probe=await probeRuleAlignCapability(async q=>{calls.push(q);return q===SYNSET_VERSION_QUERY?version:witness;},signal());
 assert.equal(probe.rulealign,true);assert.deepEqual(calls,[SYNSET_VERSION_QUERY,SYNSET_BI_PROBE]);
 calls=[];
 const other=await probeRuleAlignCapability(async q=>{calls.push(q);return data([{product:lit('Other DB'),version:lit('8.0.0')}]);},signal());
 assert.equal(other.rulealign,false);assert.deepEqual(calls,[SYNSET_VERSION_QUERY]);
 assert.equal((await probeRuleAlignCapability(async q=>q===SYNSET_VERSION_QUERY?version:data([{n:lit(0)}]),signal())).rulealign,false);
 const cache=new Map<string,boolean>();await probeRuleAlignCapability(async q=>q===SYNSET_VERSION_QUERY?version:witness,signal(),cache);
 assert.equal((await probeRuleAlignCapability(async q=>{assert.equal(q,SYNSET_VERSION_QUERY);return version;},signal(),cache)).rulealign,true);
});
test('execution does not run RuleAlign mining on an unverified graph server',async()=>{
 const p=compileFctXmlToSparql(xml('rulealign'));let calls=0;
 await assert.rejects(executePredicateSynset(p,async()=>{calls++;return data([{product:lit('Unknown'),version:lit('1.0.0')}]);},signal()),/RuleAlign unavailable/);assert.equal(calls,1);
});
test('server-side RuleAlign results are consumed without raw rules or instances',async()=>{
 const p=compileFctXmlToSparql(xml('rulealign'));const calls:string[]=[];
 const rows=await executePredicateSynset(p,async q=>{calls.push(q);return q===SYNSET_VERSION_QUERY?version:q===SYNSET_BI_PROBE?witness:q===p.predicateSynset!.budgetQuery?budget:q===p.predicateSynset!.ruleBudgetQuery?data([{rules:lit(5)}]):scores;},signal());
 assert.deepEqual(calls,[SYNSET_VERSION_QUERY,SYNSET_BI_PROBE,p.predicateSynset!.budgetQuery,p.predicateSynset!.ruleBudgetQuery,p.query]);
 assert.equal(rows[0].similarity.value,'0.5');
});
test('Relation Agreement score is paged only after complete aggregates and deterministic ranking',async()=>{
 const p=compileFctXmlToSparql(xml('relation-agreement',false,'limit="1" offset="1"'));
 const rows=await executePredicateSynset(p,async q=>q===p.predicateSynset!.budgetQuery?budget:data([{c1:uri('urn:z'),...counts},{c1:uri('urn:a'),...counts}]),signal());
 assert.equal(rows[0].c1.value,'urn:z');
});
test('budgets fail closed before scoring and cancellation prevents later queries',async()=>{
 const p=compileFctXmlToSparql(xml('relation-agreement',false,'max-candidates="2"'));let calls=0;
 await assert.rejects(executePredicateSynset(p,async()=>{calls++;return budget;},signal()),/budget/);assert.equal(calls,1);
 const c=new AbortController();calls=0;
 await assert.rejects(executePredicateSynset(p,async()=>{calls++;c.abort();return budget;},c.signal),{name:'AbortError'});assert.equal(calls,1);
});
test('clone builder does not mutate the live view or constraints',()=>{
 const tree:FctQueryTree={name:'query',attributes:{addr:'$ALL$@https://example.org/sparql',id:'a'},children:[{name:'class',id:'b',attributes:{iri:'urn:Person'},children:[]},{name:'property',id:'c',attributes:{iri:'urn:reference'},children:[{name:'view',id:'d',attributes:{type:'text',limit:'30'},children:[]}]}]};
 const original=JSON.stringify(tree);assert.equal(synsetCarrier(tree)?.carrier.id,'c');
 const query=buildSynsetQuery(tree,'rulealign',SYNSET_SETTINGS);
 assert.equal(JSON.stringify(tree),original);assert.match(query,/type="properties-synset"/);assert.match(query,/algorithm="rulealign"/);assert.match(query,/<class iri="urn:Person"/);
 assert.equal(compileFctXmlToSparql(query).maxPredicateCandidates,500);
});


test('budget diagnostics report measured candidate and full argument-pair counts, not just limits',async()=>{
 const p=compileFctXmlToSparql(xml('relation-agreement',false,'max-candidates="2" max-incidence-rows="50"'));
 await assert.rejects(executePredicateSynset(p,async()=>budget,signal()),/candidates: 3 \/ 2; argument pairs including carrier: 80 \/ 50/);
});
test('no qualifying candidates means no full scoring or local mining',async()=>{
 const p=compileFctXmlToSparql(xml());let calls=0;
 const rows=await executePredicateSynset(p,async q=>{calls++;assert.equal(q,p.predicateSynset!.budgetQuery);return data([{candidates:lit(0),pairs:lit(2)}]);},signal());
 assert.deepEqual(rows,[]);assert.equal(calls,1);
});
test('RuleAlign candidate budget uses qualifying shared body keys, and rule budget reports measured support groups',async()=>{
 const p=compileFctXmlToSparql(xml('rulealign',false,'max-incidence-rows="100"'));
 const b=p.predicateSynset!.budgetQuery;assert.match(b,/\?synBodyKey/);assert.match(b,/\?headSize/);assert.match(b,/\?bodySize/);assert.match(b,/\?support/);
 const calls:string[]=[];
 await assert.rejects(executePredicateSynset(p,async q=>{calls.push(q);return q===SYNSET_VERSION_QUERY?version:q===SYNSET_BI_PROBE?witness:q===b?budget:data([{rules:lit(101)}]);},signal()),/rule support-group budget \(101 \/ 100\)/);
 assert.deepEqual(calls,[SYNSET_VERSION_QUERY,SYNSET_BI_PROBE,b,p.predicateSynset!.ruleBudgetQuery]);
});
test('ranked predicate selection projects from the analyzer focus, not the prior breadcrumb, without editing FCT',()=>{
 const view={name:'view',id:'d',attributes:{type:'text',limit:'30'},children:[]};
 const constrained={name:'property',id:'e',attributes:{iri:'urn:selected'},children:[{name:'value',id:'f',attributes:{datatype:'uri'},text:'urn:bound',children:[]}]};
 for(const nested of [false,true]){
  const tree:FctQueryTree={name:'query',attributes:{addr:'$ALL$@https://example.org/sparql',id:'a'},children:[{name:'class',id:'b',attributes:{iri:'urn:Person'},children:[]},...(nested?[{name:'property',id:'c',attributes:{iri:'urn:breadcrumb'},children:[constrained,view]}]:[constrained,view])]};
  const old=JSON.stringify(tree);const selected=synsetTreeForRankedProperty(tree,'urn:selected');assert.ok(selected);
  assert.equal(JSON.stringify(tree),old);assert.equal(synsetCarrier(selected)?.carrier.attributes.iri,'urn:selected');assert.notEqual(synsetCarrier(selected)?.carrier.id,'e');
  const q=buildSynsetQuery(selected,'relation-agreement',SYNSET_SETTINGS);assert.match(q,/<value[^>]*>urn:bound<\/value>/);assert.equal((q.match(/<view /g)||[]).length,1);
  const plan=compileFctXmlToSparql(q);assert.equal(plan.predicateSynset?.carrier,'urn:selected');assert.match(plan.query,/<urn:bound>/);
  if(nested)assert.match(plan.query,/<urn:breadcrumb>/);
 }
});
