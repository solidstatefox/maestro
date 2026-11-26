const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');

test('transported facets use Virtuoso execution budget and owner cancellation, not a local delivery deadline',()=>{
 const source=read('src/canvas/left/filter.tsx');
 assert.doesNotMatch(source,/watchPersonalFacetDeadline|stopDeadline\(|timeoutReason|AbortSignal\.timeout/);
 assert.match(source,/signal: controller\.signal/);
 assert.match(source,/controller\.abort\(\)/);
 assert.match(source,/timeout: String\(queryTimeoutMs\)/);
 assert.match(source,/`Cloned FCT XML \(verbatim\):/);
 assert.match(source,/anchorId \? activeTransportedFacets\(tree\)/);
 assert.match(source,/"X-Maestro-Clock-Component": `component:personal:/);
});
