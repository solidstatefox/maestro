const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filepath = path.join(__dirname,'../src/lib/client-query-cache.ts');
function harness(){
  const code=ts.transpileModule(fs.readFileSync(filepath,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const holds=[];
  const network = async (...args) => new Promise((resolve,reject)=>{holds.push({resolve,reject,args});});
  const observation = require('./transport-test-loader.cjs').loadTransportObservation({fetch:network});
  const attribution={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,"../src/lib/sparql-request-attribution.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:attribution.exports,Headers,Request,URL,require:id=>{assert.equal(id,'./proxy-transport-observation');return observation;}});
  const mock={
    "@/lib/sparql-request-attribution":attribution.exports,
    "@/lib/app-lifecycle/query-view-ownership":require('./maestro-view-query-test-shim.cjs'),
    "./query-queue-observation":require("./query-queue-observation-test-loader.cjs"),
    "./app-lifecycle/actor-query-authority":require("./actor-query-authority-test-loader.cjs"),
    "@/lib/proxy-transport-observation":observation,
    '@/lib/client-personal-request': { withPersonalProxyCredentials: async (_url,init)=>({init,authenticated:false}) },
    '@/lib/personal-session-hint': { observePersonalAuthResponse: response => response },
    './maestro-language': {maestroLanguageHeader: ()=>'en'},
    './maestro-concurrency': {readMaestroConcurrency: () =>({proxyConnections:1})},
    './maestro-query-execution-clock': {maestroQueryClockScope:()=>null},
    './client-query-events': {subscribeMaestroQueryEvents: async () => ({close(){}})},
    './maestro-incomplete-results': {setMaestroIncompleteResults:()=>{}},
     './virtuoso-anytime': (()=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/virtuoso-anytime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:mod.exports});return mod.exports;})(),
    './maestro-query-timeouts': {resolveFctRequestTimeout:(_source,body)=>({body}),configuredTimeoutMs:()=>0},
  };
  const mod={exports:{}};
  vm.runInNewContext(code, {
    module:mod, exports:mod.exports,
    require(id){if(id in mock)return mock[id];throw new Error(`Unexpected dependency ${id}`)},
    fetch: async (...args) => new Promise((resolve,reject)=>{
      holds.push({resolve,reject,args});
    }),
    Request, Response, Headers, AbortController, AbortSignal, DOMException, URL, crypto: require("node:crypto").webcrypto,
    Map, Set, WeakMap, Promise, JSON, TextDecoder, TextEncoder
  },{filename:'client-query-cache.js'});
  const controller=require('./maestro-view-query-test-shim.cjs').createMaestroQueryViewCoordinator();
  controller.start();mod.exports.registerMaestroQueryWorkspace('test-workspace',controller);
  return {cache:mod.exports,holds,controller};
}
test('browser queue indexes remain unique in priority order and reindex immediately on cancel',async()=>{
  const {cache,holds}=harness();
  let pending=[];
  cache.subscribePendingMaestroQueryDetails(items=>{pending=items.map(x=>({...x}))});
  const req=(label)=>cache.maestroQueryFetch('/proxy/api/sparql', {
    method:'POST',body:'ASK {}',headers:{'X-Maestro-Debug-Source':`urn:maestro:component:${label}`,'X-Maestro-Debug-Component':label,'x-maestro-view-tab':'browse'}
  });
  const a=req('interactive-a');
  const b=req('count-b');
  const c=req('interactive-c');
  for(let i=0;i<18;i++) await Promise.resolve();
  assert.equal(holds.length,1,'only first request is dispatched');
  const waiting=pending.filter(x=>x.queueIndex>0);
  assert.equal(waiting.length,2);
  assert.equal(new Set(waiting.map(x=>x.queueIndex)).size,2);
  assert.equal(waiting[0].label,'interactive-c');
  assert.equal(waiting[0].queueIndex,1);
  assert.equal(waiting[1].label,'count-b');
  assert.equal(waiting[1].queueIndex,2);
  cache.cancelIndividualMaestroQuery(waiting[0].id);
  await assert.rejects(c,/abort|cancel/i);
  assert.equal(pending.find(x=>x.label==='count-b')?.queueIndex,1);
  holds[0].resolve(new Response('done',{status:200}));
  await a;
  for(let i=0;i<18;i++) await Promise.resolve();
  assert.equal(holds.length,2,'next queued request is dispatched');
  holds[1].resolve(new Response('done',{status:200}));
  await b;
  assert.equal(pending.length,0,'all pending requests clear on completion');
});


test('an offstage ribbon loses queued AND running requests; only the visible ribbon can enqueue',async()=>{
  const {cache,holds,controller}=harness();
  const selected=(tab,ribbon="",histogram=false)=>controller.select({tab,
    viewPanel:"perspectives",viewProvider:null,selectedViewUri:"",selectedAnalysisUri:ribbon,histogram});
  let rows=[];cache.subscribePendingMaestroQueryDetails(items=>{rows=items.map(x=>({...x}))});
  const req=(label,tab,ribbon="")=>cache.maestroQueryFetch('/proxy/api/sparql',{
    method:'POST',body:'ASK {}',headers:{'x-maestro-debug-source':`urn:maestro:component:${label}`, 'x-maestro-debug-component':label,
      'x-maestro-view-tab':tab,...(ribbon?{'x-maestro-view-ribbon':ribbon}:{})}
  });
  const browseRun=req('active-browse','browse');
  const browseQueued=req('queued-browse','browse');
  for(let i=0;i<18;i++)await Promise.resolve();
  assert.equal(holds.length,1);
  assert.equal(rows.length,2);
  selected('analyze','urn:analysis:first');
  assert.equal(rows.length,0,'old view activity disappears from the X/Refresh queue immediately');
  await assert.rejects(browseQueued,/abort|cancel/i);
  // VM fetch stub does not listen for AbortSignal; settle its transport to observe cancellation.
  holds[0].resolve(new Response('cancelled',{status:200}));
  await assert.rejects(browseRun,/abort|cancel/i);
  await assert.rejects(req('late-browse','browse'),/abort|offstage/i);
  assert.equal(holds.length,1,'offstage work cannot dispatch new proxy traffic');
  const first=req('analyze-first','analyze','urn:analysis:first');
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(rows.length,1);
  assert.equal(rows[0].viewOwnerKey,'analyze:urn:analysis:first');
  for(let i=0;i<24;i++)await Promise.resolve();
  assert.equal(holds.length,2);
  await assert.rejects(req('other-analysis','analyze','urn:analysis:second'),/abort|offstage/i);
  selected('analyze','urn:analysis:second');
  assert.equal(rows.length,0,'ribbon-to-ribbon movement tears down the previous analysis');
  holds[1].resolve(new Response('canceled',{status:200}));
  await assert.rejects(first,/abort|cancel/i);
  // Returning to Browse does not resume or replay any offstage queue item.
  selected('browse');
  assert.equal(rows.length,0);
});


test('View ribbon isolates Perspectives, Providers and individual selected providers',async()=>{
 const {cache,holds,controller}=harness();
 let latest=[];cache.subscribePendingMaestroQueryDetails(xs=>latest=xs);
 const select=(panel,viewUri='',provider=null)=>controller.select({tab:'view',viewPanel:panel,
   viewProvider:provider,selectedViewUri:viewUri,selectedAnalysisUri:'',histogram:false});
 const req=(label,tab,ribbon)=>cache.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:'ASK {}',
   headers:{'X-Maestro-Debug-Source':`urn:maestro:component:${label}`,'X-Maestro-Debug-Component':label,'x-maestro-view-tab':tab,'x-maestro-view-ribbon':ribbon}});
 select('perspectives','urn:perspective:one');
 const first=req('first','view','perspectives:urn:perspective:one');
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(latest.length,1);assert.equal(latest[0].viewOwnerKey,'view:perspectives:urn:perspective:one');
 select('providers','', 'formats');
 assert.equal(latest.length,0);
 holds[0].resolve(new Response('old',{status:200}));
 await assert.rejects(first,/abort|cancel/i);
 await assert.rejects(req('offstage','view','perspectives:urn:perspective:one'),/abort|offstage/i);
 const second=req('formats','view','providers:formats');
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(latest.length,1); assert.equal(holds.length,2);
 select('providers','', 'policies');
 assert.equal(latest.length,0);
 holds[1].resolve(new Response('old',{status:200}));
 await assert.rejects(second,/abort|cancel/i);
 await assert.rejects(req('inactive-formats','view','providers:formats'),/abort|offstage/i);
 const third=req('policies','view','providers:policies');
 for(let i=0;i<16;i++)await Promise.resolve();
 assert.equal(latest.length,1);assert.equal(latest[0].viewOwnerKey,'view:providers:policies');
 holds[2].resolve(new Response('done',{status:200}));
 await third;
 assert.equal(latest.length,0);
});

test('independent SHACL and discovery actors use the shared queue before foreground provider readiness; authority cannot be spoofed or reused',async()=>{
 const {cache,holds,controller}=harness();
 const {runActorQuery,inheritActorQueryAuthority}=require('./actor-query-authority-test-loader.cjs');
 controller.select({...controller.getSelection(),tab:'analyze',selectedAnalysisUri:'urn:analysis:unresolved'});
 let pending=[];cache.subscribePendingMaestroQueryDetails(xs=>{pending=xs});
 const send=(signal,body={query:'SELECT * WHERE {}'})=>cache.maestroQueryFetch('/proxy/api/sparql',{method:'POST',signal,body:JSON.stringify(body),headers:{'x-maestro-debug-source':'urn:maestro:component:QueryContextValidation','x-maestro-debug-component':'QueryContextValidation','Content-Type':'application/json'}});
 const original=new AbortController();
 await assert.rejects(send(original.signal),/no explicit active XState/);
 const actor=new AbortController();let derived;
 const query=runActorQuery('query-context',actor.signal,async signal=>{
  derived=AbortSignal.any([signal,new AbortController().signal]);inheritActorQueryAuthority(signal,derived);
  await assert.rejects(send(derived,{update:'DELETE WHERE {}',personalWrite:true}),/owns reads only/);
  return send(derived);
 });
 for(let i=0;i<30&&!holds.length;i++) await Promise.resolve();
 assert.equal(holds.length,1);assert.equal(pending[0].viewOwnerKey,'actor:query-context');
 holds[0].resolve(new Response('ok',{status:200}));await query;
 assert.equal(pending.length,0);
 await assert.rejects(send(derived),{name:'AbortError'});
 assert.equal(holds.length,1);
});

test('Perspective discovery is independent of candidate ribbon but cancelled when its zone is left',async()=>{
 const {cache,holds,controller}=harness();
 const {runActorQuery}=require('./actor-query-authority-test-loader.cjs');
 controller.select({...controller.getSelection(),tab:'view',viewPanel:'perspectives',selectedViewUri:'urn:current'});
 const actor=new AbortController();
 const send=signal=>cache.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:JSON.stringify({query:'SELECT * WHERE {}'}),signal,headers:{'x-maestro-view-tab':'view','x-maestro-view-ribbon':'perspectives:urn:candidate','x-maestro-debug-source':'urn:maestro:component:test','x-maestro-debug-component':'test'}});
 const request=runActorQuery('perspective-discovery',actor.signal,send);
 for(let i=0;i<30&&!holds.length;i++)await Promise.resolve();assert.equal(holds.length,1);
 const rejected=assert.rejects(request,{name:'AbortError'});
 controller.select({...controller.getSelection(),tab:'browse'});
 holds[0].resolve(new Response('cancelled',{status:200}));await rejected;
 await assert.rejects(runActorQuery('perspective-discovery',new AbortController().signal,send),{name:'AbortError'});
 assert.equal(holds.length,1);
});

test('shared facet queue survives tab switches while foreground and session lifetimes stay separate',async()=>{
 const {cache,holds,controller}=harness();
 controller.observeScope('shared','query-1',true);controller.observeScope('personal','account-1',true);
 let latest=[];cache.subscribePendingMaestroQueryDetails(xs=>latest=xs);
 const req=(label,tab,ribbon)=>cache.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:'ASK {}',headers:{'x-maestro-debug-source':`urn:maestro:component:${label}`,'x-maestro-debug-component':label,'x-maestro-view-tab':tab,'x-maestro-view-ribbon':ribbon}});
 const shared=req('properties','shared','query'); const history=req('history','personal','session');
 for(let i=0;i<32;i++)await Promise.resolve();
 assert.equal(latest.length,2); assert.equal(holds.length,1);
 controller.select({...controller.getSelection(),tab:'analyze',selectedAnalysisUri:'urn:analysis:one'});
 assert.deepEqual(Array.from(latest,x=>x.viewOwnerKey).sort(),['personal:session','shared:query']);
 holds[0].resolve(new Response('properties',{status:200}));await shared;
 for(let i=0;i<32;i++)await Promise.resolve();assert.equal(holds.length,2);
 assert.equal(latest.length,1);assert.equal(latest[0].viewOwnerKey,'personal:session');
 cache.abortQueryScopedMaestroQueries();assert.equal(latest.length,1);
 holds[1].resolve(new Response('history',{status:200}));await history;
 assert.equal(latest.length,0);
});


test('facet provider observation fires at real queue admission before dispatch, not at authority registration',async()=>{
  const {cache,holds,controller}=harness();
  const {observeQueryQueueAdmission,inheritQueryQueueObservation}=require('./query-queue-observation-test-loader.cjs');
  const provider=new AbortController(),auth=new AbortController(),seen=[];
  const close=observeQueryQueueAdmission(provider.signal,()=>seen.push(holds.length));
  // Model the real authentication signal composition boundary.
  inheritQueryQueueObservation(provider.signal,auth.signal);
  const send=(label,signal)=>cache.maestroQueryFetch('/proxy/api/sparql',{
    method:'POST',body:'SELECT * WHERE {}',signal,headers:{'x-maestro-view-tab':'browse',
      'x-maestro-debug-source':`urn:maestro:component:${label}`,'x-maestro-debug-component':label}
  });
  const first=send('foreground');
  for(let i=0;i<18;i++)await Promise.resolve();
  assert.equal(holds.length,1);
  const waiting=send('facet-provider',auth.signal);
  assert.deepEqual(seen,[],'proposed work has not yet entered the browser queue');
  for(let i=0;i<18;i++)await Promise.resolve();
  assert.deepEqual(seen,[1],'observed exactly once while another request holds the only slot');
  assert.equal(holds.length,1);
  holds[0].resolve(new Response('done',{status:200}));await first;
  for(let i=0;i<18;i++)await Promise.resolve();
  assert.equal(holds.length,2);holds[1].resolve(new Response('done',{status:200}));await waiting;
  const again=send('facet-provider-approval',auth.signal);
  for(let i=0;i<18;i++)await Promise.resolve();
  assert.deepEqual(seen,[1],'multi-query discovery retains one admission latch');
  holds[2].resolve(new Response('done',{status:200}));await again;close();
  controller.cancel();
  const rejected=new AbortController();let falselyAdmitted=false;
  observeQueryQueueAdmission(rejected.signal,()=>{falselyAdmitted=true});
  await assert.rejects(send('not-admitted',rejected.signal),/abort|inactive|offstage|cancel/i);
  assert.equal(falselyAdmitted,false);
});
