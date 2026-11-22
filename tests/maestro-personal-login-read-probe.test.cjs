const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('src/lib/client-auth-probe.ts','utf8');
function fixture(fetchImpl, opts={}) {
  const calls=[];
  const session={authType:'sparql-auth',graphStore:'https://example.com/sparql',
    graphPrefix:'https://example.com/ods/home/test',userName:'acme',password:'secret',authHeader:'Basic TEST'};
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const mocks={
    '@/lib/personal-auth':{
      personalReadEndpoint:s=>s.graphStore,
      personalWriteEndpoint:s=>s.graphStore.replace(/\/sparql$/,'/sparql-auth'),
    },
    '@/lib/client-auth-bootstrap':{
      authBootstrapSelect:()=>`SELECT ?section WHERE { BIND("probe" AS ?section) } LIMIT 3000`,
    },
    '@/lib/client-personal-request':{
      personalRequestHeaders:()=>({'x-personal-graph-store':session.graphStore,
        'x-personal-graph':session.graphPrefix,'x-personal-auth-type':session.authType,
        'x-personal-auth':session.authHeader}),
    },
    '@/lib/client-http-forward':{forwardHttp:()=>{throw Error('unrelated profile read');}},
  };
  vm.runInNewContext(output,{module,exports:module.exports,URL,Promise,AbortSignal:opts.abortSignal??AbortSignal,
    fetch:async (url,init)=>{calls.push({url,init});return fetchImpl(url,init);},
    require:(id)=>{if(!mocks[id])throw Error(`Unexpected import ${id}`);return mocks[id];}},
  {filename:'src/lib/client-auth-probe.ts'});
  return {testPersonalGraph:module.exports.testPersonalGraph,session,calls};
}
const valid=()=>({ok:true,status:200,json:async()=>({head:{vars:['section']},
  results:{bindings:[{section:{type:'literal',value:'probe'}}]}})});

test('login handshake sends scoped credentials to /sparql-auth and returns bootstrap rows',async()=>{
  const app=fixture(valid);const result=await app.testPersonalGraph(app.session);
  assert.equal(result.connected,true);assert.equal(result.bootstrap?.length,1);
  assert.equal(app.calls.length,1);assert.equal(app.calls[0].url,'/proxy/api/sparql');
  const body=JSON.parse(app.calls[0].init.body);
  assert.equal(body.personalRead,true);
  assert.equal(body.addr,'https://example.com/ods/home/test/query@https://example.com/sparql-auth');
  assert.match(body.query,/BIND\("probe" AS \?section\)/);
  assert.equal(app.calls[0].init.headers['x-personal-auth'],'Basic TEST');
  assert.doesNotMatch(source,/setMaestroSessionCookie|document\.cookie|maestro_session/);
});
test('credential failure is not concealed by a Maestro cookie',async()=>{
  const app=fixture(async()=>({ok:false,status:401}));const result=await app.testPersonalGraph(app.session);
  assert.equal(result.connected,false);assert.equal(result.status,401);assert.match(result.error,/Authentication was rejected/);
});
test('HTML 200 does not count as authentication success',async()=>{
  const app=fixture(async()=>({ok:true,status:200,json:async()=>({})}));const result=await app.testPersonalGraph(app.session);
  assert.equal(result.connected,false);assert.match(result.error,/invalid SELECT result/);
});
test('login cancellation sends no request',async()=>{
  const app=fixture(valid);const controller=new AbortController();controller.abort();
  const result=await app.testPersonalGraph(app.session,controller.signal);
  assert.equal(result.connected,false);assert.match(result.error,/cancelled/);assert.equal(app.calls.length,0);
});
test('timed-out challenge is surfaced without invalidating persistent credentials',async()=>{
  const controller=new AbortController();const abortSignal={
    timeout(ms){assert.equal(ms,15000);queueMicrotask(()=>controller.abort(new DOMException('Timeout','TimeoutError')));return controller.signal;},
    any:AbortSignal.any.bind(AbortSignal),
  };
  const app=fixture((_,init)=>new Promise((_,reject)=>{
    if(init.signal.aborted)return reject(init.signal.reason);
    init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }),{abortSignal});
  const result=await app.testPersonalGraph(app.session);
  assert.equal(result.connected,false);assert.match(result.error,/timed out after 15 seconds/);
});
test('graph seeding and XState readiness remain downstream of authenticated bootstrap',()=>{
  const auth=fs.readFileSync('src/canvas/controllers/authentication.ts','utf8');
  const seed=fs.readFileSync('src/lib/client-graph-seed.ts','utf8');
  assert.match(auth,/await testPersonalGraph\(session\)/);
  assert.match(auth,/hydrateAuthBootstrap\(session, data\.bootstrap/);
  assert.match(auth,/setPersonalPoliciesReady\(false\)/);
  assert.match(auth,/await seedPersonalGraphs\(attempt\.signal\)/);
  assert.match(auth,/setPersonalPoliciesReady\(true\)/);
  assert.match(seed,/destinationSeedDigest\(/);
});
