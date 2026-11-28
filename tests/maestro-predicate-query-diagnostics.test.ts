import test from "node:test";
import assert from "node:assert/strict";
import { predicateAnalyticsUpstreamFailure } from "../src/lib/predicate-analytics-upstream";
import { appendPredicateQueryTrace, tracePredicateResponse } from "../src/lib/predicate-query-trace";
import { analyticalFctError, traceFromFct } from "../src/lib/predicate-query-diagnostics";
import { probeRuleAlignCapability, SYNSET_VERSION_QUERY } from "../src/lib/predicate-synset";

for (const status of [500,504,206]) test(`synset ${status} preserves status, phase, full body and attempted query order`,async()=>{
  const body = `<html>Gateway or Virtuoso diagnostic & detail</html>\n${"long detail ".repeat(600)}END`;
  const q1="SELECT ?x WHERE { ?x <urn:predicate> ?y }";
  const q2="SELECT ?y WHERE { ?x <urn:predicate> ?y FILTER(?y < 10) }";
  const fct='<query><view type="properties-synset"/></query>';
  const result=await tracePredicateResponse(predicateAnalyticsUpstreamFailure({phase:"synset-rule-budget",response:new Response(body,{status,headers:{"X-SQL-State":"S1000","X-SQL-Message":"diagnostic","Set-Cookie":"private=hidden"}}),body,query:q2,endpoint:"https://example.org/sparql?timeout=12345"}).toResponse(),fct,[{label:"synset-candidate-budget",query:q1,language:"sparql"},{label:"synset-rule-budget",query:q2,language:"sparql"}]);
  assert.equal(result.status,status);
  assert.equal(result.headers.get("X-Maestro-Upstream-Status"),String(status));
  const xml=await result.text();
  assert.match(xml,/long detail END/);assert.doesNotMatch(xml,/private=hidden/);
  assert.match(xml,/phase="synset-rule-budget"/);
  assert.match(xml,/&lt;html&gt;Gateway or Virtuoso diagnostic &amp; detail&lt;\/html&gt;/);
  assert.ok(xml.indexOf('label="FCT (effective request)"') < xml.indexOf('label="synset-candidate-budget"'));
  assert.ok(xml.indexOf('label="synset-candidate-budget"') < xml.indexOf('label="synset-rule-budget"'));
  assert.match(xml,/FILTER\(\?y &lt; 10\)/);
  assert.match(xml,/<\/fct:query-trace><\/fct:facets>$/);
});
test("trace also exists for local proxy deadline errors without an upstream response",()=>{
  const xml=appendPredicateQueryTrace('<fct:facets xmlns:fct="urn:fct"><fct:error>deadline</fct:error></fct:facets>',"<query/>",[{label:"synset-scoring",query:"SELECT ...",language:"sparql"}]);
  assert.match(xml,/deadline/);assert.match(xml,/synset-scoring/);
});
test("capability read failures propagate the original upstream error to the executor",async()=>{
  const err=new Error("HTTP 504 gateway body");
  await assert.rejects(probeRuleAlignCapability(async q=>{assert.equal(q,SYNSET_VERSION_QUERY);throw err;},new AbortController().signal,undefined,true),e=>e===err);
  const ui=await probeRuleAlignCapability(async()=>{throw err;},new AbortController().signal);
  assert.equal(ui.rulealign,false);assert.equal(ui.reason,err.message);
});
// Supply a DOM-like fixture to test the browser consumer without pretending to run a browser.
test("browser error/copy string retains decoded body, SQL headers, phase and complete proxy XML",()=>{
  const node=(localName:string,textContent="",children:unknown[]=[],attrs:Record<string,string>={})=>({localName,textContent,children,getAttribute:(key:string)=>attrs[key]??null});
  const full="original upstream message\n"+"d".repeat(10000)+"END";
  const root=node("facets","",[node("error","synset-rule-budget: Virtuoso HTTP 504"),node("upstream","",[node("headers","",[node("header","S1TAT",[],{name:"x-sql-state"})]),node("body",full)],{phase:"synset-rule-budget",endpoint:"https://example.org/sparql",status:"504","status-text":"Gateway Time-out"}),node("sparql","SELECT ..."),node("query-trace","",[node("request","<query/>",[],{label:"FCT",language:"xml"}),node("request","SELECT ...",[],{label:"Score",language:"sparql"})])]);
  const original=globalThis.DOMParser;
  Object.defineProperty(globalThis,"DOMParser",{configurable:true,value:class {parseFromString(){return {documentElement:root};}}});
  try {
    const diagnostic=analyticalFctError(504,"<original XML/>","Synset").message;
    assert.ok(diagnostic.includes(full));assert.match(diagnostic,/x-sql-state: S1TAT/);assert.match(diagnostic,/synset-rule-budget/);assert.match(diagnostic,/<original XML\/>/);
    assert.deepEqual(traceFromFct("<original XML/>",[]).map(entry=>entry.query),["<query/>","SELECT ..."]);
  } finally {Object.defineProperty(globalThis,"DOMParser",{configurable:true,writable:true,value:original});}
});
