const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');

test('transported facets terminate after a bounded personal-widget deadline with diagnostic attribution',()=>{
 const source=read('src/canvas/left/filter.tsx');
 assert.match(source,/watchPersonalFacetDeadline\(clockScope, queryTimeoutMs/);
 assert.match(source,/timeoutReason = reason;[\s\S]*?controller\.abort\(new DOMException/);
 assert.match(source,/stopDeadline\(\)/);
 assert.match(source,/timeout: String\(queryTimeoutMs\)/);
 assert.match(source,/`Cloned FCT XML \(verbatim\):/);
 assert.match(source,/anchorId \? activeTransportedFacets\(tree\)/);
 assert.match(source,/"X-Maestro-Clock-Component": `component:personal:/);
});
