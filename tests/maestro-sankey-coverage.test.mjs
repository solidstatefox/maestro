import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectSankeyCoverage, SANKEY_ANALYSIS_URI } from "../src/lib/sankey-coverage.ts";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url),"utf8");
const axes = [
  {iri:"urn:location",direction:"forward",label:"Location"},
  {iri:"urn:developer",direction:"forward",label:"Developer"},
  {iri:"urn:owner",direction:"reverse",label:"Owner of"},
];
const resources = [
  {uri:"urn:one",label:"One",values:[
    {property:"urn:location",direction:"forward",values:[{value:"urn:ny",type:"uri"},{value:"urn:ny",type:"uri"}]},
    {property:"urn:developer",direction:"forward",values:[{value:"A",type:"literal"},{value:"B",type:"literal"}]},
  ]},
  {uri:"urn:two",label:"Two",values:[
    {property:"urn:location",direction:"forward",values:[{value:"urn:ny",type:"uri"}]},
    {property:"urn:owner",direction:"reverse",values:[{value:"urn:owner1",type:"uri"}]},
  ]},
];

test("Sankey graph computes per-resource coverage against all in-scope predicates",()=>{
  const graph=projectSankeyCoverage(axes,resources);
  assert.equal(graph.coverage.length,2);
  for(const coverage of graph.coverage) assert.ok(Math.abs(coverage.percent-200/3)<1e-9);
  assert.equal(graph.nodes.filter(n=>n.kind==="resource").length,2);
  assert.equal(graph.nodes.filter(n=>n.kind==="predicate").length,3);
  assert.equal(graph.nodes.filter(n=>n.kind==="value").length,4);
  assert.ok(graph.links.every(edge=>edge.value>0 && edge.source!==edge.target));
  // Sankey flow is conserved at each intermediate resource and predicate node.
  for(let index=0;index<graph.nodes.length;index++) {
    if(!["resource","predicate"].includes(graph.nodes[index].kind))continue;
    const incoming=graph.links.filter(l=>l.target===index).reduce((n,l)=>n+l.value,0);
    const outgoing=graph.links.filter(l=>l.source===index).reduce((n,l)=>n+l.value,0);
    assert.ok(Math.abs(incoming-outgoing)<1e-8);
  }
});
test("Sankey keeps URI/literal and language identities distinct, never fabricates missing values",()=>{
  const graph=projectSankeyCoverage([{iri:"urn:has",direction:"forward",label:"Has"}],[
    {uri:"urn:r",label:"R",values:[{property:"urn:has",direction:"forward",values:[
      {value:"foo",type:"uri"},{value:"foo",type:"literal"},{value:"foo",type:"literal",lang:"en"},
    ]}]},
    {uri:"urn:empty",label:"Empty",values:[]},
  ]);
  assert.equal(graph.nodes.filter(n=>n.kind==="value").length,3);
  assert.equal(graph.coverage.find(r=>r.uri==="urn:empty")?.percent,0);
  assert.equal(graph.coverage.find(r=>r.uri==="urn:r")?.percent,100);
});
test("Sankey uses the approved provider, existing list-values projection and renderer adapter",()=>{
  assert.equal(SANKEY_ANALYSIS_URI,"gttp://ggg.maestro.ecosys/analyze/sankey");
  assert.match(read("graph/sankey/provider.ttl"),/mui:accepts <gttp:\/\/ggg\.maestro\.ecosys\/analyze\/sankey\/input>/);
  assert.match(read("graph/maestro-curation-providers.ttl"),/rdf:first <gttp:\/\/ggg\.maestro\.ecosys\/analyze\/sankey>/);
  assert.match(read("src/canvas/tab/analyze/page.tsx"),/sankeySelected\) return <AnalyzeSankey workspace=\{workspace\}/);
  assert.match(read("src/canvas/utils/workspace-controller.tsx"),/selectedAnalysisUri === SANKEY_ANALYSIS_URI/);
  assert.match(read("src/canvas/tab/analyze/sankey.tsx"),/ResponsiveContainer/);
});
