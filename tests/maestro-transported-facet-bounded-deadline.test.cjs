const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');

test('transported facets terminate after a bounded personal-widget deadline with diagnostic attribution',()=>{
 const source=read('src/canvas/left/filter.tsx');
 assert.match(source,/const deadlineMs = \(configuredTimeoutMs\("personal"\) \|\| 60_000\) \+ 10_000/);
 assert.match(source,/timedOut = true;[\s\S]*?controller\.abort\(new DOMException/);
 assert.match(source,/timedOut \? `Personal facet timed out after/);
 assert.match(source,/clearTimeout\(deadline\)/);
 assert.match(source,/`Cloned FCT XML \(verbatim\):/);
 assert.match(source,/anchorId \? activeTransportedFacets\(tree\)/);
 assert.match(source,/"X-Maestro-Clock-Component": `component:personal:/);
});
