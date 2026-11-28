const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sourceFiles=[
 'src/lib/maestro-storage.ts',
 'src/canvas/sheet/provider-properties.tsx',
 'src/canvas/sheet/settings-pane.tsx',
 'src/canvas/tab/analyze/predicate-clusters.tsx',
 'src/lib/fct-sparql-translator.ts',
 'src/app/proxy/api/fct/route.ts',
];
test('all patched files parse and the Sheet is generic rather than keyed to a particular provider',()=>{
 for(const file of sourceFiles){const src=read(file); const parsed=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.deepEqual(parsed.parseDiagnostics.map(x=>x.messageText),[],file);}
 const ui=read('src/canvas/sheet/provider-properties.tsx');
 assert.match(ui,/listProviderStorageProperties\(\)/);
 assert.match(ui,/providerStorage\(property\.providerIri, property\.accountScope\)/);
 assert.doesNotMatch(ui,/predicate-clusters|timeoutMs|maxCandidates/);
 assert.match(read('src/canvas/sheet/settings-pane.tsx'),/<ProviderProperties active=\{controlsSheetOpen\}/);
});
test('provider owns its cubby values and projects one common detached timeout/candidate limit',()=>{
 const src=read('src/canvas/tab/analyze/predicate-clusters.tsx');
 assert.match(src,/providerStorage\(definition\.uri, accountScope\)/);
 assert.match(src,/storage\.get\(key\)/);
 assert.match(src,/timeoutMs: 120000, maxCandidates: 500/);
 assert.match(src,/maxIncidenceRows: 50000/);
 assert.match(src,/views\[0\]\.setAttribute\("timeout", String\(settings\.timeoutMs\)\)/);
 assert.match(src,/views\[0\]\.setAttribute\("max-candidates", String\(settings\.maxCandidates\)\)/);
 assert.match(src,/views\[0\]\.setAttribute\("limit", String\(settings\.maxCandidates\)\)/);
 assert.match(src,/subscribeProviderStorageChanges/);
 assert.match(src,/response\.status !== 200/,'Anytime results cannot authorize exact clustering');
 const route=read('src/app/proxy/api/fct/route.ts');
 assert.match(route,/compiled\.maxPredicateCandidates/);
 assert.match(route,/compiled\.timeoutMs/);
});
