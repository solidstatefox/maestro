const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {runActorQuery,inheritActorQueryAuthority,getActorQueryAuthority,actorQueryAllowed}=require('./actor-query-authority-test-loader.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('actor authority is scoped to the live invocation, including derived authenticated and Request signals',async()=>{
 const controller=new AbortController(); const unowned=new AbortController();
 assert.equal(getActorQueryAuthority(unowned.signal),undefined);
 let derived,request;
 await runActorQuery('query-context',controller.signal,async signal=>{
  derived=AbortSignal.any([signal,unowned.signal]);inheritActorQueryAuthority(signal,derived);
  request=new Request('https://maestro.invalid',{signal:derived});inheritActorQueryAuthority(derived,request.signal);
  assert.equal(getActorQueryAuthority(request.signal),'query-context');
  assert.equal(getActorQueryAuthority(unowned.signal),undefined);
 });
 assert.throws(()=>getActorQueryAuthority(derived),{name:'AbortError'});
 assert.throws(()=>getActorQueryAuthority(request.signal),{name:'AbortError'});
 const aborted=new AbortController();await assert.rejects(runActorQuery('analysis-discovery',aborted.signal,async signal=>{aborted.abort();assert.throws(()=>getActorQueryAuthority(signal),{name:'AbortError'});}),{name:'AbortError'});
});
test('only named prerequisite owners can enter the corresponding discovery zone',()=>{
 for(const tab of ['browse','view','analyze']){
  const selection={tab,viewPanel:'perspectives'};
  assert.equal(actorQueryAllowed('query-context',selection),tab!=='browse');
  assert.equal(actorQueryAllowed('analysis-discovery',selection),tab==='analyze');
  assert.equal(actorQueryAllowed('perspective-discovery',selection),tab==='view');
 }
 assert.equal(actorQueryAllowed('perspective-discovery',{tab:'view',viewPanel:'providers'}),false);
});
test('Kinds cannot start until Browse foreground is ready; the only error affordance is a hazard popover',()=>{
 const configure=read('src/canvas/left/configure-pane.tsx');
 assert.match(configure,/const kindKey = workspace\.sharedExecutionReady/);
 assert.match(configure,/ErrorDetails prefix="Kinds unavailable" error=\{kindState\.error\} iconOnly onRetry=\{retryKinds\}/);
 assert.doesNotMatch(configure,/Retry \$\{group\} Kinds discovery/);
 const details=read('src/components/ui/error-details.tsx');
 assert.match(details,/!iconOnly && <span/);assert.match(details,/<pre[^>]*>\{fullDiagnostic\}<\/pre>/);assert.match(details,/onRetry && \(iconOnly \|\| isRetryableGatewayError\(error\)\)/);
});
test('prerequisites have explicit invocation authority and ordinary FCT projections retain exact view/ribbon claims',()=>{
 const paths={'query-context':'query-context','access':'bookmark-verification','pending-approvals':'pending-approvals','provider-validation':'provider-policy','navigation-transaction':'history-navigation','bookmark-metadata':'bookmark-metadata'};
 for(const [file,owner] of Object.entries(paths))assert.ok(read(`src/lib/app-lifecycle/${file}.ts`).includes(`runActorQuery("${owner}"`),file);
 assert.match(read('src/lib/client-personal-request.ts'),/inheritActorQueryAuthority\(init.signal, signal\)/);
 assert.match(read('src/lib/client-query-favorites.ts'),/inheritActorQueryAuthority\(init.signal, request.signal\)/);
 assert.match(read('src/canvas/controllers/view.ts'),/"maestro-view-discovery", "perspective-discovery"/);
 assert.match(read('src/lib/app-lifecycle/provider-discovery-supervisor.ts'),/makeDiscoveryMachine<T>\(`\$\{id\}-lane`, "analysis-discovery"\)/);
 assert.match(read('src/lib/provider-catalog-items.ts'),/ribbon:`providers:\$\{providerKind\}`/);
 assert.match(read('src/lib/client-perspective-collections.ts'),/ribbon:`perspectives:\$\{provider.uri\}`/);
 assert.match(read('src/lib/client-endpoint-discovery.ts'),/perspectives:gttp:\/\/ggg.maestro.ecosys\/shacl\/provider\/entrypoint/);
});
