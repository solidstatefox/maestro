'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('Categories tree is requested by RDF provider, without overriding manual disable',()=>{
  const host=read('src/canvas/left/facet-presentation.tsx');
  const filters=read('src/canvas/left/filter-pane.tsx');
  assert.match(host,/\?requestsClassTree/);
  assert.match(host,/wantsClassTree:active && Boolean\(provider\?\.requestsClassTree\)/);
  assert.match(filters,/manualTreeOverride\.current\.has\(classTreeScope\)/);
  assert.match(filters,/setQueryAttribute\("classTree", "true"\)/);
  for(const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl'])
    assert.match(read(file),/mui:requestsClassTree true/);
});
test('sunburst bounds resize locally without FCT or XSLT rerun',()=>{
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(host,/svg\.getBBox\(\)/);
  assert.match(host,/svg\.setAttribute\("viewBox"/);
  assert.match(host,/if\(!select\(event\.target\)\)setResizeActive\(true\)/);
  assert.match(host,/aria-label="Resize Sunburst"/);
  assert.match(host,/setPointerCapture\(event\.pointerId\)/);
  assert.match(host,/changeWidth\(Math\.max\(100/);
  assert.match(host,/width:`\$\{resizeWidth\?\?naturalWidth\}px`/);
  assert.doesNotMatch(host,/Maximum sunburst radius|import \{ Slider \}/);
  assert.match(host,/\[presentation\.active,provider,key,source\]\)/);
});
