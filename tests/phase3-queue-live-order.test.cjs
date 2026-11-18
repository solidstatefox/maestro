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
  const mock={
    './maestro-language': {maestroLanguageHeader: ()=>'en'},
    './maestro-concurrency': {readMaestroConcurrency: () =>({proxyConnections:1})},
    './maestro-query-execution-clock': {maestroQueryClockScope:()=>null},
    './client-query-events': {unwrapMaestroQueryEvents: async res=>res},
    './maestro-incomplete-results': {setMaestroIncompleteResults:()=>{}},
    './maestro-query-timeouts': {applyFctQueryTimeout:(source,xml)=>xml,configuredTimeoutMs:()=>0},
  };
  const mod={exports:{}};
  vm.runInNewContext(code, {
    module:mod, exports:mod.exports,
    require(id){if(id in mock)return mock[id];throw new Error(`Unexpected dependency ${id}`)},
    fetch: async (...args) => new Promise((resolve,reject)=>{
      holds.push({resolve,reject,args});
    }),
    Request, Response, Headers, AbortController, AbortSignal, DOMException, URL,
    Map, Set, WeakMap, Promise, JSON, TextDecoder, TextEncoder
  },{filename:'client-query-cache.js'});
  return {cache:mod.exports,holds};
}
test('browser queue indexes remain unique in priority order and reindex immediately on cancel',async()=>{
  const {cache,holds}=harness();
  let pending=[];
  cache.subscribePendingMaestroQueryDetails(items=>{pending=items.map(x=>({...x}))});
  const req=(label)=>cache.maestroQueryFetch('/proxy/api/sparql', {
    method:'POST',body:'ASK {}',headers:{'X-Maestro-Debug-Source':label}
  });
  const a=req('interactive-a');
  const b=req('count-b');
  const c=req('interactive-c');
  await Promise.resolve();
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
  await Promise.resolve();
  assert.equal(holds.length,2,'next queued request is dispatched');
  holds[1].resolve(new Response('done',{status:200}));
  await b;
  assert.equal(pending.length,0,'all pending requests clear on completion');
});
