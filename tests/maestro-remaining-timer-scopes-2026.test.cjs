const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('Graphs, Role values, and Configure Kinds show real dispatch clock not spinner-only animation',()=>{
 const filter=read('src/canvas/left/filter-pane.tsx'), configure=read('src/canvas/left/configure-pane.tsx'), clock=read('src/lib/maestro-query-execution-clock.ts');
 assert.match(filter,/<ElapsedStatus label="Updating…" category="roles" clockScope="personal"/);
 assert.match(filter,/<ElapsedStatus label="Updating…" category="graphs" clockScope="graphs"/);
 assert.match(filter,/<ElapsedStatus label="Loading graphs" category="graphs" clockScope="graphs"/);
 assert.match(configure,/<ElapsedStatus label="Kinds" category="kinds" clockScope="component:kinds"/);
 assert.match(configure,/proxyDebugHeaders\("Configure:Kinds", `ConfigureKind:\$\{direction\}`\)/);
 assert.match(clock,/label\.includes\("configure:kinds"\)\) return "component:kinds"/);
});
