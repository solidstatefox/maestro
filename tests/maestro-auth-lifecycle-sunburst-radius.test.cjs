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
test('sunburst maximum radius slider resizes locally without FCT or XSLT rerun',()=>{
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(host,/Maximum sunburst radius/);
  assert.match(host,/const \[maxRadius,setMaxRadius\]=useState\(200\)/);
  assert.match(host,/onValueChange=\{values=>setMaxRadius/);
  assert.match(host,/style=\{\{maxWidth:`\$\{maxRadius\*2\+20\}px`\}\}/);
  assert.doesNotMatch(host,/\$\{maxRadius\}[^;]*transformWithMaestroSaxon/);
});
