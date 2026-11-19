import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const text = f=>fs.readFileSync(f,'utf8');
const manifest=JSON.parse(text('graph/manifest.json'));
const curator=text('graph/maestro-curation-providers.ttl');
const page=text('src/canvas/tab/analyze/page.tsx');
const sankey=text('src/canvas/tab/analyze/sankey.tsx');
const d3=text('src/canvas/tab/analyze/d3-sankey.tsx');

test('D3 Sankey is separate approved Analysis provider with the same scoped forward FCT projection',()=>{
  const provider=text('graph/sankey-d3/provider.ttl');
  assert.equal(manifest['sankey-d3/provider.ttl'],'/shacl/policies');
  assert.match(curator,/analyze\/sankey-d3/);
  assert.match(provider,/a mui:Provider, ma:Analysis, sh:NodeShape/);
  assert.match(provider,/renderer="d3-sankey"/);
  assert.match(page,/d3SankeySelected/);
  assert.match(text('src/canvas/utils/workspace-controller.tsx'),/selectedAnalysisUri === D3_SANKEY_ANALYSIS_URI/);
  assert.match(page,/renderer="d3"/);
  assert.match(sankey,/extendSankeyThroughQueryTree\(base,branches,currentForward.edges\)/);
  assert.match(sankey,/renderer==="d3" \? <D3SankeyDiagram data=\{data\}/);
  assert.match(sankey,/changeResultsPage\(1\)/);
  assert.match(d3,/import \{ sankey, sankeyCenter, sankeyJustify, sankeyLeft, sankeyLinkHorizontal, sankeyRight \} from "d3-sankey"/);
});

test('D3 renderer supports Observable-style node alignment and link color as well as local zoom/pan',()=>{
  for (const token of ['Node alignment','Link color','Node order','Node width','Node padding','Iterations','Ribbons:','Nodes:','Label padding','Node border','Colors by node stage','Ribbon blend mode','Chart width','Chart height','Zoom in','Zoom out','Reset zoom','setPointerCapture','onPointerMove'])
    assert.ok(d3.includes(token),token);
  assert.match(d3,/setSelectedUri|onOpenResource\(node.uri\)/);
  assert.doesNotMatch(d3,/SPARQL UPDATE|updatePersonal\(/);
});

test('Sunburst XSLT owns wedge labels and percentages and provider content fills the available pane',()=>{
  const sun=text('graph/sunburst/provider.ttl');
  assert.match(sun,/format-number\(100 \* \$span div/);
  assert.match(sun,/text-anchor="middle"/);
  assert.doesNotMatch(sun,/max-w-\[360px\]/);
  assert.match(text('src/canvas/left/facet-presentation.tsx'),/w-full min-w-0 flex-1/);
  assert.doesNotMatch(text('src/canvas/tab/analyze/spider.tsx'),/max-w-6xl space-y-4/);
  assert.doesNotMatch(sankey,/max-w-7xl space-y-4/);
});

test('Status preserves the previously working read-only FCT query transport',()=>{
  const personal=text('src/lib/personal-sparql.ts');
  const graph=text('src/lib/personal-status-graph.ts');
  const fct=text('src/app/proxy/api/fct/route.ts');
  assert.doesNotMatch(personal,/queryPersonalStatusSparql|oneReadAuthUrl/);
  assert.match(graph,/getUserGraph\(request\)\}\/status/);
  assert.match(fct,/queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
  assert.doesNotMatch(fct,/queryPersonalStatusSparql/);
});

test('D3 multicolor columns and upstream/downstream selection are presentation-only',()=>{
  const interactions=text('src/lib/sankey-stream-focus.ts');
  assert.match(d3,/Multicolor columns/);
  assert.match(d3,/traceSankeyStreams\(/);
  assert.match(d3,/Show all streams/);
  assert.match(d3,/onOpenResource\(node.uri\)/);
  assert.match(interactions,/const stack = \[focus\]/);
});
test('D3 package dependency and nested lock entries are present',()=>{
  const pkg=JSON.parse(text('package.json'));
  const lock=JSON.parse(text('package-lock.json'));
  assert.equal(pkg.dependencies['d3-sankey'],'0.12.3');
  assert.equal(lock.packages[''].dependencies['d3-sankey'],'0.12.3');
  for(const key of ['node_modules/d3-sankey','node_modules/d3-sankey/node_modules/d3-array','node_modules/d3-sankey/node_modules/d3-shape','node_modules/d3-sankey/node_modules/d3-shape/node_modules/d3-path'])
    assert.ok(lock.packages[key]?.version,key);
});
