const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const ts=require('typescript');const read=p=>fs.readFileSync(p,'utf8');
const {observeQueryQueueAdmission,inheritQueryQueueObservation,observeAdmittedQuery}=require('./query-queue-observation-test-loader.cjs');
test('admission observation follows real derived signals once, is isolated, and is revocable',()=>{
 const a=new AbortController(),b=new AbortController(),other=new AbortController(),derived=new AbortController();
 let count=0;const close=observeQueryQueueAdmission(a.signal,()=>count++);
 inheritQueryQueueObservation(a.signal,b.signal);inheritQueryQueueObservation(b.signal,derived.signal);
 observeAdmittedQuery(other.signal);assert.equal(count,0);observeAdmittedQuery(derived.signal);observeAdmittedQuery(a.signal);assert.equal(count,1);close();
 const c=new AbortController(),d=new AbortController();let late=0;const end=observeQueryQueueAdmission(c.signal,()=>late++);inheritQueryQueueObservation(c.signal,d.signal);end();observeAdmittedQuery(d.signal);assert.equal(late,0);
 const e=new AbortController(),f=new AbortController();observeQueryQueueAdmission(e.signal,()=>late++);inheritQueryQueueObservation(e.signal,f.signal);e.abort();observeAdmittedQuery(f.signal);assert.equal(late,0);
 const g=new AbortController();observeQueryQueueAdmission(g.signal,()=>{throw Error('observer failed')});assert.doesNotThrow(()=>observeAdmittedQuery(g.signal));
});
test('actual browser scheduler admits before dispatch and authenticated composition preserves observer without new headers',()=>{
 const cache=read('src/lib/client-query-cache.ts'),auth=read('src/lib/client-personal-request.ts');
 assert.match(cache,/inheritQueryQueueObservation\(signal, combinedSignal\)/);assert.match(auth,/inheritQueryQueueObservation\(init.signal, signal\)/);
 const start=cache.indexOf('if (background) requestQueue.push(job);');const queue=cache.slice(start,cache.indexOf('/** A fresh FCT',start));
 assert.ok(queue.indexOf('observeAdmittedQuery(init?.signal)')>queue.indexOf('requestQueue.splice'));assert.ok(queue.indexOf('observeAdmittedQuery(init?.signal)')<queue.indexOf('dispatchScheduledRequests()'));
 assert.doesNotMatch(read('src/lib/query-queue-observation.ts'),/fetch\(|Headers\(|setTimeout\(/);
});
test('only Categories and Personal participating headers display the XState progress glyph; no Graphs or tray changes',()=>{
 const pane=read('src/canvas/left/filter-pane.tsx'),cards=read('src/canvas/left/personal-widget-cards.tsx'),progress=read('src/canvas/diagnostics/facet-provider-progress.tsx');
 assert.match(pane,/Categories<\/button>\s*<FacetProviderIndicator\s*\/>\s*<LeftWidgetButtonTray/);
 assert.match(cards,/<FacetProviderProgress key=\{widgetKey\}/);assert.match(cards,/temporal.participating\?\.has\(widget.uri\)/);assert.match(cards,/<FacetProviderIndicator\s*\/>\s*\{autoConfiguredFacetKeys/);
 assert.equal((pane.match(/<FacetProviderIndicator\s*\/>/g)||[]).length,1);assert.equal((cards.match(/<FacetProviderIndicator\s*\/>/g)||[]).length,1);
 assert.match(progress,/snapshot.matches\("animating"\)/);assert.match(progress,/motion-reduce:hidden/);assert.match(progress,/motion-reduce:block/);assert.doesNotMatch(progress,/setInterval|setTimeout|requestAnimationFrame/);
});
test('renderer completion is observed after commit, with exact current XSLT, calendar, numeric and tag scopes',()=>{
 const progress=read('src/canvas/diagnostics/facet-provider-progress.tsx'),date=read('src/canvas/left/personal-date-facet.tsx'),numeric=read('src/canvas/left/personal-numeric-facet.tsx'),tag=read('src/canvas/left/personal-tag-cloud.tsx'),category=read('src/canvas/left/facet-presentation.tsx');
 assert.match(progress,/useLayoutEffect\(\(\) => \{\s*if \(!identity \|\| !report\) return;\s*report\(\{ identity, ready \}\)/);
 assert.match(category,/useFacetProviderRendered\(Boolean\(result.key===key && \(!storage \|\| dimensionStorageReady===storage\)\)\)/);
 assert.match(date,/settledDomain.request === domainRequest/);assert.match(date,/settledBuckets.query === query && !domainLoading && !fetching/);
 assert.match(numeric,/useFacetProviderRendered\(!loading && settledDomainKey === scopeKey\)/);assert.match(tag,/useFacetProviderRendered\(!busy && \(!cooccurrenceKey \|\| cooccurring !== null/);
});
test('all new and changed source modules parse',()=>{
 for(const file of ['src/lib/app-lifecycle/facet-provider-progress.ts','src/lib/app-lifecycle/providers.ts','src/lib/query-queue-observation.ts','src/lib/client-query-cache.ts','src/lib/client-personal-request.ts','src/lib/client-facet-providers.ts','src/canvas/diagnostics/facet-provider-progress.tsx','src/canvas/left/facet-presentation.tsx','src/canvas/left/filter-pane.tsx','src/canvas/left/personal-widget-cards.tsx','src/canvas/left/personal-date-facet.tsx','src/canvas/left/personal-numeric-facet.tsx','src/canvas/left/personal-tag-cloud.tsx','tests/maestro-facet-provider-progress.test.ts']){
  const ast=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file);
 }
});

test('the requested sparkle and sparkles sequence preserves the exact transform order, including the final four-corner composite',()=>{
 const source=read('src/lib/app-lifecycle/facet-provider-progress.ts');
 const frames=[...source.matchAll(/\{ icon: "(sparkles?)", transform: "([^"]+)" \}/g)].map(m=>[m[1],m[2]]);
 assert.deepEqual(frames,[['sparkle','none'],['sparkles','none'],['sparkles','matrix(0,1,1,0,0,0)'],['sparkle','none'],['sparkles','scaleX(-1)'],['sparkles','matrix(0,-1,-1,0,0,0)'],['sparkle','none'],['sparkles','none'],['sparkles','scaleX(-1)']]);
 assert.match(source,/\{ layers: \[\s*\{ icon: "sparkles", transform: "none" \},\s*\{ icon: "sparkles", transform: "scaleX\(-1\)" \},\s*\] \}/m);
});
test('the stable progress wrapper fades through the full spectrum without restarting on glyph changes',()=>{
 const progress=read('src/canvas/diagnostics/facet-provider-progress.tsx'),css=read('src/app/globals.css');
 assert.match(progress,/<span className="maestro-facet-provider-spectrum[^"\n]*" role="status"/);
 assert.match(progress,/frame\.layers\.map\(\(layer, index\) => \{/);
 assert.match(progress,/className="absolute inset-0 size-full" style=\{\{ transform: layer.transform, transformOrigin: "center" \}\}/);
 assert.match(css,/animation: maestro-facet-provider-spectrum 3600ms linear infinite/);
 const keyframes=css.slice(css.indexOf('@keyframes maestro-facet-provider-spectrum'),css.indexOf('@media (prefers-reduced-motion: reduce)',css.indexOf('@keyframes maestro-facet-provider-spectrum')));
 assert.deepEqual([...keyframes.matchAll(/color: var\(--spectrum-([a-z]+)\)/g)].map(m=>m[1]),['red','orange','yellow','green','cyan','blue','violet']);
 assert.match(keyframes,/0%, 100% \{ color: var\(--spectrum-red\); \}/);
 assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{\s*\.maestro-facet-provider-spectrum \{ animation: none; \}/);
 assert.match(css,/\.dark \.maestro-facet-provider-spectrum/);
});
