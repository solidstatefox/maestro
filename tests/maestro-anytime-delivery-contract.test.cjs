const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const { Agent } = require('undici');
const read = p => fs.readFileSync(p, 'utf8');
function load(source, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(code.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(code.outputText, { module, exports: module.exports,
    require: id => { if (Object.hasOwn(mocks,id)) return mocks[id]; throw Error(`unexpected dependency ${id}`); },
    Request, Response, Headers, URL, URLSearchParams, AbortController, AbortSignal, DOMException, Error, Map, Set, WeakMap, Promise, JSON, TextDecoder, TextEncoder, ...globals });
  return module.exports;
}
const anytime=load(read('src/lib/virtuoso-anytime.ts'));
const data={head:{vars:['c1','n']},results:{bindings:[{c1:{type:'uri',value:'urn:predicate'},n:{type:'literal',value:'7'}}]}};
const body=JSON.stringify(data);
function pause(ms){return new Promise(r=>setTimeout(r,ms));}
async function fixture(handler, run) {
 const server=http.createServer(handler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try {return await run(`http://127.0.0.1:${server.address().port}/sparql`);}
 finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
for(const partial of [false,true]) test(`delayed headers AND delayed body retain ${partial?'actual S1TAT partial':'full'} rows`,async()=>{
 let dispatcher;let dispatchOptions;const original=Agent.prototype.dispatch;
 Agent.prototype.dispatch=function(options,handler){dispatchOptions=options;return original.call(this,options,handler);};
 const {fetchVirtuosoRead}=load(read('src/lib/virtuoso-read-transport.ts'),{undici:{Agent}},{fetch});
 try{
  await fixture(async(req,res)=>{
   let request='';for await(const chunk of req) request+=chunk;
   assert.equal(new URLSearchParams(request).get('timeout'),'1');
   await pause(65);res.writeHead(200,{'Content-Type':'application/sparql-results+json',...(partial?{'X-SQL-State':'S1TAT'}:{})});
   res.write(body.slice(0,20));await pause(65);res.end(body.slice(20));
  },async url=>{
   const owner=new AbortController();
   const response=await fetchVirtuosoRead(url,{method:'POST',body:new URLSearchParams({query:'SELECT * WHERE {}',timeout:'1'}),signal:owner.signal},(u,opts)=>{dispatcher=opts.dispatcher;assert.equal(opts.signal,owner.signal);return fetch(u,opts);});
   const text=await response.text();assert.deepEqual(JSON.parse(text),data);
   assert.equal(anytime.isVirtuosoAnytime(response,text),partial);
   assert.equal(dispatchOptions.headersTimeout,0);assert.equal(dispatchOptions.bodyTimeout,0);
   assert.equal(owner.signal.aborted,false);
  });
 }finally{Agent.prototype.dispatch=original;await dispatcher?.close();}
});
test('explicit cancellation still interrupts receipt of a delayed response body',async()=>{
 let dispatcher;const {fetchVirtuosoRead}=load(read('src/lib/virtuoso-read-transport.ts'),{undici:{Agent}},{fetch});
 try {await fixture((_req,res)=>{res.writeHead(200);res.write('{');},async url=>{
  const owner=new AbortController();const response=await fetchVirtuosoRead(url,{signal:owner.signal},(u,o)=>{dispatcher=o.dispatcher;return fetch(u,o);});
  owner.abort();await assert.rejects(response.text(),{name:'AbortError'});
 });}finally{await dispatcher?.destroy();}
});
test('a real result literal is not mistaken for an Anytime diagnostic',()=>{
 const literal=JSON.stringify({head:{vars:['x']},results:{bindings:[{x:{type:'literal',value:'S1TAT ANYTIME timeout'}}]}});
 assert.equal(anytime.isVirtuosoAnytime(new Response(literal),literal),false);
 assert.equal(anytime.isVirtuosoAnytime(new Response(body,{status:206}),body),true);
 assert.equal(anytime.isVirtuosoAnytime(new Response(body,{headers:{'X-SQL-State':'S1TAT'}}),body),true);
 assert.equal(anytime.isVirtuosoAnytime(new Response('network unavailable',{status:504}),'network unavailable'),false);
 assert.equal(anytime.anytimeResponseHeaders(new Response(body,{status:206}),true)['X-Maestro-Incomplete'],'true');
});
function extracted(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
for(const kind of ['fct','sparql'])test(`${kind} route waits for queue admission and uses only the supplied cancellation signal`,async()=>{
 const source=read(`src/app/proxy/api/${kind}/route.ts`);
 const snippet=kind==='fct'?extracted(source,'async function executeSparql(','\nfunction xmlEscape('):extracted(source,'async function querySparqlTransport(','\n/** Expand Node/Undici');
 let admitted,dispatches=0,options;
 const gate=new Promise(r=>admitted=r);
 const owner=new AbortController();
 const code=`const inFlightFctSparql=new Map(),inFlightSparqlRequests=new Map();const getQueryCache=()=>undefined,queryCacheKey=()=>"key",currentProxyClient=()=>"test",checkGraphServerDestination=async()=>{},weightMaestroQuery=()=>"light",traceVirtuosoDispatch=fn=>fn(),withUpstreamTransport=fn=>fn();${snippet}\nmodule.exports.run=${kind==='fct'?'executeSparql':'querySparqlTransport'};`;
 const m=load(code,{}, { withGraphServerSlot:async(_endpoint,_priority,signal,run)=>{assert.equal(signal,owner.signal);await gate;return run();},fetchVirtuosoRead:async(_url,init)=>{dispatches++;options=init;return new Response(body,{headers:{'X-SQL-State':'S1TAT'}});},fetch:()=>{throw Error('read bypassed read transport');},AbortSignal:{any:AbortSignal.any,timeout(){throw Error('local read timeout armed');}} });
 const query='SELECT * WHERE {}';const endpoint='https://example.org/sparql';
 const run=kind==='fct'?m.run(endpoint,query,undefined,1000,owner.signal):m.run(endpoint,query,1000,owner.signal);
 await Promise.resolve();assert.equal(dispatches,0);admitted();const result=await run;
 assert.equal(dispatches,1);assert.equal(options.signal,owner.signal);assert.equal(new URLSearchParams(options.body).get('timeout'),'1000');
 assert.equal(kind==='fct'?result.text:result.responseText,body);
});
test('ordinary browser reads have no queue-plus-delivery watchdog',async()=>{
 const source=read('src/lib/client-query-cache.ts');let release,networkSignal,queued;const m=load(source,{
  '@/lib/proxy-transport-observation':{observeProxyFetch:async(_input,init)=>{networkSignal=init.signal;return new Promise(r=>release=r);},stopProxyQueryGeneration(){},resumeProxyQueryGeneration(){}},
  '@/lib/sparql-request-attribution':{requireSparqlAttribution(){}},
  '@/lib/app-lifecycle/query-view-ownership':require('./maestro-view-query-test-shim.cjs'),
    "./app-lifecycle/actor-query-authority":require("./actor-query-authority-test-loader.cjs"), './maestro-language':{maestroLanguageHeader:()=> 'en'},
  './maestro-concurrency':{readMaestroConcurrency:()=>({proxyConnections:1})},'./maestro-query-execution-clock':{maestroQueryClockScope:()=>null},
  './client-query-events':{subscribeMaestroQueryEvents:async(_id,_scope,_signal,notify)=>{queued=notify;return {close(){}}}},
  './maestro-incomplete-results':{setMaestroIncompleteResults(){}},'./maestro-query-timeouts':{configuredTimeoutMs:()=>1000,applyFctQueryTimeout:(_s,x)=>x}
 },{crypto:require('node:crypto').webcrypto,AbortSignal:{any:AbortSignal.any,timeout(){throw Error('local read watchdog armed');}}});
 const workspace=require('./maestro-view-query-test-shim.cjs').createMaestroQueryViewCoordinator();
 workspace.start();m.registerMaestroQueryWorkspace('test-workspace',workspace);
 const owner=new AbortController();const promise=m.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:'SELECT * WHERE {}',signal:owner.signal,headers:{'x-maestro-view-tab':'browse'}});
 for(let i=0;i<12&&!release;i++)await Promise.resolve();assert.ok(release);queued(0,'https://example.org/sparql','light',0,0,0);assert.equal(networkSignal.aborted,false);
 release(new Response(body,{headers:{'X-Maestro-Incomplete':'true'}}));assert.equal(await (await promise).text(),body);
});
test('invalid result documents cannot be turned into successful invented rows',()=>{
 const fct=read('src/app/proxy/api/fct/route.ts'),sparql=read('src/app/proxy/api/sparql/route.ts');
 const parse=load(extracted(fct,'function parseResults(','\nconst VIRTRDF_LABEL')+'\nmodule.exports.parse=parseResults;').parse;
 assert.equal(parse('S1TAT error without rows'),null);assert.equal(parse('{"head":{"vars":["c1"]},"results":{"bindings":[null]}}'),null);assert.equal(parse(body).results.bindings.length,1);
 assert.doesNotMatch(sparql,/parseSparqlResults\(responseText\) \?\? \(incomplete \?/);
 assert.match(fct,/if \(!parsed\) return fctUpstreamFailure\("fct-json", response, text, activeQuery, executionEndpoint/);
  assert.match(fct,/partial \? "No usable result set delivered by Virtuoso" : "Invalid SPARQL Results JSON returned by Virtuoso"/);
  assert.doesNotMatch(fct,/if \(!parsed\) return fctError\(/);
 assert.match(sparql,/if \(!parsed\) \{\s*return NextResponse.json\(\{ error: "No usable SPARQL result/);
});
test('optional datatype probe failure preserves successful primary rows and forbids caching missing evidence',async()=>{
 const source=read('src/app/proxy/api/fct/route.ts');const code=extracted(source,'    let datatypeEvidence: Array<','    const xml = fctResponseXml({');
 const m=load(`module.exports.run=async()=>{const bindings=${body}.results.bindings;const compiled={datatypeEvidenceQuery:'SELECT * WHERE {}',timeoutMs:1};const countOnly=false,partial=false,hasStatusConstraints=false,isValidate=false,componentRetry=false,executionEndpoint='urn:source';const request={signal:new AbortController().signal};${code}\nreturn {bindings,datatypeEvidenceUnavailable,datatypeEvidence};};`,{}, {executeSparql:async()=>{throw new Error('mock network loss');},proxyLog(){},describeUpstreamError:e=>String(e)});
 const out=await m.run();assert.equal(out.bindings[0].n.value,'7');assert.equal(out.datatypeEvidenceUnavailable,true);assert.equal(out.datatypeEvidence.length,0);
 assert.match(source,/!datatypeEvidenceUnavailable && !countFreeFallback/);assert.match(read('src/lib/client-query-cache.ts'),/!response.headers.has\("x-maestro-enrichment-unavailable"\)/);
});
test('no component-owned read deadline is reintroduced in common query consumers',()=>{
 for(const path of ['src/canvas/left/filter.tsx','src/lib/app-lifecycle/view-discovery.ts','src/lib/app-lifecycle/query-context.ts','src/lib/app-lifecycle/provider-validation.ts','src/lib/provider-endpoint-recipes.ts','src/canvas/utils/workspace-controller.tsx'])assert.doesNotMatch(read(path),/watchPersonalFacetDeadline|QUERY_OPERATION_WATCHDOG_MS|upstreamDeliveryTimeoutMs/,path);
 assert.match(read('src/canvas/left/filter.tsx'),/signal: controller\.signal/);
});
