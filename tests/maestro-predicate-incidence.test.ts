import test from "node:test";
import assert from "node:assert/strict";
import { PredicateIncidenceAccumulator, type PredicateIncidenceRow } from "../src/lib/predicate-incidence";

const item = (s: string, p: string): PredicateIncidenceRow => ({
  subject: {type:"uri",value:s},predicate:{type:"uri",value:p},
});

test("complete incidence pages compute exact coverage and Jaccard without remote pair joins", () => {
  const accumulator = new PredicateIncidenceAccumulator(5, 20);
  assert.equal(accumulator.addPage([item("urn:s:1","urn:p:a"),item("urn:s:1","urn:p:b")],2),false);
  assert.throws(() => accumulator.result(0.55),/not complete/);
  assert.equal(accumulator.addPage([item("urn:s:2","urn:p:a"),item("urn:s:2","urn:p:b")],2),false);
  assert.equal(accumulator.addPage([item("urn:s:3","urn:p:c")],2),true);
  assert.equal(accumulator.rowsReceived,5);
  const result=accumulator.result(0.55);
  assert.deepEqual(result.clusters.map(row=>row.count),[2,1]);
  assert.deepEqual(result.assignments.filter(row=>row.cluster==="C1").map(row=>row.property).sort(),["urn:p:a","urn:p:b"]);
  assert.deepEqual(result.ranks.map(row=>row.rank),[1,2,3]);
});

test("empty terminal page, not a full page, completes an exact analysis", () => {
  const accumulator = new PredicateIncidenceAccumulator(3,5);
  assert.equal(accumulator.addPage([item("urn:s:1","urn:p:a")],1),false);
  assert.throws(()=>accumulator.result(0.5),/not complete/);
  assert.equal(accumulator.addPage([],1),true);
  assert.deepEqual(accumulator.result(0.5).clusters.map(x=>x.count),[1]);
  assert.throws(()=>accumulator.addPage([],1),/already complete/);
});

test("limits fail closed rather than silently produce clusters from a truncated population",()=>{
  const a=new PredicateIncidenceAccumulator(2,2);
  assert.equal(a.addPage([item("urn:s:1","urn:p:a"),item("urn:s:1","urn:p:b")],2),false);
  assert.throws(()=>a.addPage([item("urn:s:2","urn:p:a")],2),/configured 2 rows/);
  assert.throws(()=>a.result(0.55),/not complete/);
  const b=new PredicateIncidenceAccumulator(1,10);
  assert.throws(()=>b.addPage([item("urn:s:1","urn:p:a"),item("urn:s:1","urn:p:b")],5),/configured 1 distinct properties/);
  assert.throws(()=>b.result(0.55),/not complete/);
});

test("duplicate, out-of-order, malformed and response-local blank nodes cannot yield exact results",()=>{
  const a=new PredicateIncidenceAccumulator(5,10);
  assert.equal(a.addPage([item("urn:s:1","urn:p:a")],1),false);
  assert.throws(()=>a.addPage([item("urn:s:1","urn:p:a")],1),/duplicated or out of order/);
  for (const invalid of [
    {...item("urn:s:1","urn:p:a"),subject:{type:"bnode",value:"b123"}},
    {...item("urn:s:1","urn:p:a"),predicate:{type:"literal",value:"not a URI"}},
  ]) {
    const b=new PredicateIncidenceAccumulator(5,10);
    assert.throws(()=>b.addPage([invalid],5),/URI focus|predicate IRI/);
    assert.throws(()=>b.result(0.5),/not complete/);
  }
});

test("unusual predicate IRIs survive without serialization to SPARQL IRIREF or VALUES",()=>{
  const unusual='http://example.org/property/with|pipe"quote';
  const a=new PredicateIncidenceAccumulator(10,10);
  assert.equal(a.addPage([item("urn:s:1",unusual)],5),true);
  assert.equal(a.result(0.5).ranks[0].property,unusual);
});

test("zero incidence gives an exact empty result only after a complete empty page",()=>{
  const a=new PredicateIncidenceAccumulator(2,4);
  assert.deepEqual(a.addPage([],3),true);
  assert.deepEqual(a.result(0.5),{ranks:[],assignments:[],clusters:[]});
});
