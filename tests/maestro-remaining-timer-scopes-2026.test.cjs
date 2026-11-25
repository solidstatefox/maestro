const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('Graphs, Role values, and Configure Kinds show real dispatch clock not spinner-only animation',()=>{
 const filter=read('src/canvas/left/filter-pane.tsx'), configure=read('src/canvas/left/configure-pane.tsx'), clock=read('src/lib/maestro-query-execution-clock.ts');
 assert.match(filter,/<ElapsedStatus label="Updating…" category="roles" clockScope="personal"/);
 assert.match(filter,/<ElapsedStatus label="Updating…" category="graphs" clockScope="graphs"/);
 assert.doesNotMatch(filter,/<ElapsedStatus label="Loading graphs" category="graphs" clockScope="graphs"/);
 assert.match(configure,/resetMaestroQueryExecutionScope\(clockScope\)/);
 assert.match(configure,/<ElapsedStatus label="Kinds" category="kinds" clockScope=\{`component:kinds:\$\{direction\}`\}/);
 assert.match(configure,/proxyDebugHeaders\("Configure:Kinds",`ConfigureKind:\$\{direction\}`\)/);
 assert.match(clock,/return "component:kinds:property"/);
 assert.match(clock,/return "component:kinds:role"/);
});
