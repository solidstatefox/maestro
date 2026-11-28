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
  assert.match(host,/`Resize Sunburst \$\{handle\} edge`/);
  assert.match(host,/setPointerCapture\(event\.pointerId\)/);
  assert.match(host,/resizeFrameEdge\(base,paint,handle,/);
  assert.match(host,/resizeFrameCorner\(base,dx,dy\)/);
  assert.match(host,/cursor-nwse-resize/);
  assert.match(host,/frameBounds\.right-frameBounds\.left/);
  assert.match(host,/frameBounds\.bottom-frameBounds\.top/);
  assert.doesNotMatch(host,/Maximum sunburst radius|import \{ Slider \}/);
  assert.match(host,/\[presentation\.active,provider,key,source\]\)/);
});
