const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = f => fs.readFileSync(f,'utf8');
function load(file, mocks) {
  const source=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,
    require(id){if (Object.hasOwn(mocks,id))return mocks[id];throw Error(`Unmocked ${id}`);},
    URL,Request,Response,Headers,AbortSignal,AbortController,TransformStream,
    TextDecoder,TextEncoder,JSON,Promise,Map,Set,Number,Object,Array,String,RegExp,Date,
    fetch(){throw Error('Local Maestro operations must not fetch third-party URLs');},
  },{filename:file});
  return module.exports;
}
const registry=load('src/lib/openapi-registry.ts',{});
const operations=['courtesyGraphServers','subscribeQueryEvents','recordUriObservations'];

test('courtesy digest, SSE, and observations are registered OpenAPI operations',()=>{
  for(const op of operations){
    const result=registry.resolveOpenApiOperation('maestroTransport',op);
    assert.ok(result,op);
    assert.equal(result.serviceKey,'maestroTransport');
    assert.equal(result.operationId,op);
    assert.equal(result.base,'http://localhost');
  }
  assert.equal(registry.resolveOpenApiOperation('maestroTransport','unknown'),null);
});

test('the local OpenAPI handler checks digest without downloading data and only lists on request',async()=>{
  const digest='sha256:'+'a'.repeat(64), endpt={id:'eu',label:'CORDIS',url:'https://cordis.europa.eu/datalab/sparql',group:'EU'};
  let digestCount=0,listCount=0,observationCount=0,streams=0;
  const route=load('src/app/proxy/api/service/route.ts',{
    '@/lib/upstream-error':{describeUpstreamError:e=>String(e),sanitizeUpstreamDiagnostic:s=>s},
    'next/server':{NextResponse:{json:Response.json}},
    '@/lib/openapi-registry':registry,
    '@/lib/openai-chat-completions':{validateOpenAiChatPayload:()=>null},
    '@/lib/personal-sparql':{
      getCourtesyGraphServerDigest:async()=>{digestCount++;return digest;},
      getCourtesyGraphServerSnapshot:async()=>{listCount++;return {digest,endpoints:[endpt]};},
    },
    '@/lib/proxy-query-telemetry':{openProxyQueryTelemetry:(_request,id)=>{streams++;return new Response(`event: ready\ndata: {"id":"${id}"}\n\n`,{headers:{'Content-Type':'text/event-stream'}});}},
    '@/lib/uri-observation-service':{processUriObservationBatch:async (_request,payload)=>{observationCount++;return Response.json({accepted:payload.observations.length});}},
  });
  const make=async obj=>route.POST(new Request('https://maestro.test/proxy/api/service',{method:'POST',headers:{origin:'https://maestro.test','Content-Type':'application/json'},body:JSON.stringify({service:'maestroTransport',...obj})}));
  let res=await make({operationId:'courtesyGraphServers',payload:{action:'check',digest}});
  assert.equal(res.status,200);
  assert.equal((await res.json()).changed,false);
  assert.equal(digestCount,1);assert.equal(listCount,0);
  res=await make({operationId:'courtesyGraphServers',payload:{action:'check',digest:'sha256:'+'b'.repeat(64)}});
  assert.equal((await res.json()).changed,true);
  assert.equal(listCount,0);
  res=await make({operationId:'courtesyGraphServers',payload:{action:'list'}});
  const listing=await res.json();
  assert.equal(listing.endpoints[0].url,endpt.url);assert.equal(listing.digest,digest);
  assert.equal(listCount,1);
  res=await make({operationId:'courtesyGraphServers',payload:{action:'eraseShared'}});
  assert.equal(res.status,400);
  res=await make({operationId:'subscribeQueryEvents',parameters:{id:'123e4567-e89b-42d3-a456-426614174001'}});
  assert.equal(res.headers.get('content-type'),'text/event-stream');assert.equal(streams,1);
  res=await make({operationId:'recordUriObservations',payload:{addr:'$ALL$@https://cordis.europa.eu/datalab/sparql',observations:[{uri:'urn:example:test'}]}});
  assert.equal((await res.json()).accepted,1);assert.equal(observationCount,1);
});

test('the browser uses the three local OpenAPI operations and has no old routes',()=>{
  const client=read('src/lib/client-query-events.ts');
  assert.match(client,/operationId: "subscribeQueryEvents"/);
  assert.match(read('src/lib/uri-labels.ts'),/operationId: "recordUriObservations"/);
  const ws=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(ws,/operationId:"courtesyGraphServers"/);
  assert.doesNotMatch(ws,/graphServerDigest=/);
  for(const name of ['events','observations']) assert.equal(fs.existsSync(`src/app/proxy/api/${name}/route.ts`),false);
  assert.match(read('src/lib/proxy-query-telemetry.ts'),/openProxyQueryTelemetry\(request: Request, explicitId\?/);
  assert.doesNotMatch(read('src/canvas/controllers/authentication.ts'),/setLoginDialogOpen\(true\)/);
});

test('public Browse query identities use addr URL, not transient menu IDs',()=>{
  const ws=read('src/canvas/utils/workspace-controller.tsx');
  for(const n of ['queryIdentity','requestQueryIdentity','expectedLoadedIdentity','resultsCountRequestIdentity','recordGraphIdentity']) {
    assert.match(ws,new RegExp(`(?:const ${n} = )[^\\n]*queryGraphServer`),n);
  }
  assert.doesNotMatch(ws,/const graphRegistryReady = authRestoreComplete/);
  assert.match(ws,/setQueryAttribute\("addr", `\$\{graph\}@\$\{endpoint\.url\}`\)/);
});
