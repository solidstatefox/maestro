const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');
function moduleFrom(rel, dependencies = {}, globals = {}) {
  const holder = { exports: {} };
  const code = ts.transpileModule(source(rel), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code, { module:holder, exports:holder.exports, require:id=>{
    if(id==='./proxy-transport-observation') return require('./transport-test-loader.cjs').loadTransportObservation(globals);
    if(id==='@/lib/sparql-request-attribution') return moduleFrom('src/lib/sparql-request-attribution.ts',{},globals);
    assert.ok(id in dependencies,`unexpected dependency ${id}`);return dependencies[id];
  }, URL, Request, Headers, AbortController, setTimeout, clearTimeout, ...globals }, {filename:rel});
  return holder.exports;
}
const records = moduleFrom('src/lib/digest-session-record.ts');
const fixture = {username:'test-user',graphStore:'https://example.test/sparql',graphPrefix:'https://example.test/users/test-user',ha1:'0123456789abcdef0123456789abcdef',realm:'SPARQL',algorithm:'MD5',qop:'auth',nonce:'server-nonce',cnonce:'client-nonce',opaque:null,nc:10};
test('startup and Connect use one IndexedDB user-session restoration path; dialog is user-opened', async()=>{
  const controller=source('src/canvas/controllers/authentication.ts');
  assert.match(controller,/await restoreDigestSession\(attempt.signal\)/);
  assert.match(controller,/if\(!session\)\{deps.setAuthRestoreComplete\(true\);return false;\}/);
  assert.ok(controller.indexOf('deps.setAuthSession(session)')<controller.indexOf('await refreshAuthBootstrap(session,attempt.signal)'));
  assert.ok(controller.indexOf('await listPersonalGraphServers(attempt.signal)')<controller.indexOf('deps.setPersonalPoliciesReady(true)'));
  assert.match(controller,/handleLoginSubmit: async[\s\S]*?event\.preventDefault\(\)/);
  assert.match(controller,/await preparePersonalSeed\([\s\S]*?await ensureDigestSession\([\s\S]*?initializeUserSession\(deps,attempt,bindings \? plan : undefined,bindings\)/);
  assert.match(controller,/void restoreUserSession\(deps,attempt\)/);
  assert.doesNotMatch(controller,/setLoginDialogOpen\(true\)/);
  assert.ok(controller.indexOf("await seedPersonalGraphs(")<controller.indexOf("await refreshAuthBootstrap("));
  const ui=source('src/canvas/top/appbar-pane.tsx');
  assert.match(ui,/<form onSubmit=\{handleLoginSubmit\}/);
  assert.match(ui,/onClick=\{\(\) => setLoginDialogOpen\(true\)\}/);
  const store=moduleFrom('src/lib/client-digest-session.ts',{'./digest-session-record':records});
  assert.equal(await store.restoreDigestSession(new AbortController().signal),null);
  assert.equal(store.restoredDigestSession(),null);
  assert.equal(records.DIGEST_SESSION_KEY,'personal-sparql-auth');
  assert.equal(records.parseDigestSession({...fixture,ha1:'password'}),null);
  assert.equal(records.parseDigestSession({...fixture,realm:'wrong'}),null);
  assert.equal(records.parseDigestSession({...fixture,nonce:''}),null);
  assert.equal(records.parseDigestSession(fixture).nc,10);
  assert.equal(records.digestEndpoint(fixture),'https://example.test/sparql-auth');
});
test('nonce count reservation is atomic; only Connect creates credentials and public requests remain anonymous',()=>{
  const store=source('src/lib/client-digest-session.ts');
  assert.match(store,/transaction\(DIGEST_SESSION_STORE,"readwrite"\)/);
  assert.match(store,/reserved=\{\.\.\.record,nc:record.nc\+1\}/);
  assert.match(store,/store.put\(\{\.\.\.req.result,\.\.\.reserved,generation:current.generation\},DIGEST_SESSION_KEY\)/);
  assert.match(store,/if\(existing\)return;/);
  assert.match(store,/if\(!parseDigestSession\(req.result\)\)\{store.put\(\{\.\.\.\(refreshedDigestRecord\(record,response\)\?\?record\)/);
  assert.match(store,/\.delete\(DIGEST_SESSION_KEY\)/);
  assert.match(source('src/canvas/top/appbar-pane.tsx'),/await clearPersonalAuthSession\(\); erased=true;/);
  assert.match(store,/tx.oncomplete=.*resolve\(reserved\)/);
  const transport=source('src/lib/client-personal-request.ts');
  assert.match(transport,/body.personalRead===true && typeof body.query==="string"/);
  assert.match(transport,/body.personalWrite===true && typeof body.update==="string"/);
  assert.match(transport,/url!=="\/proxy\/api\/sparql"/);
  assert.match(transport,/DIGEST_SESSION_SCHEME\+encodeURIComponent/);
  const route=source('src/app/proxy/api/sparql/route.ts');
  assert.match(route,/body\?\.operation === "auth-probe"/);
  assert.match(route,/typeof body\?\.update === "string"/);
  assert.match(route,/if\(body\?\.personalRead===true \|\| body\?\.personalWrite===true\)/);
  assert.match(route,/restoredDigestAuthorization\(request,endpoint\)/);
  assert.match(route,/redirect: "manual"/);
  assert.doesNotMatch(source('src/lib/client-auth-bootstrap.ts'),/updatePersonal\(|seedPersonalGraphs\(/);
  assert.ok(!fs.existsSync(path.join(root,'src/lib/client-auth-probe.ts')));
  assert.ok(!fs.existsSync(path.join(root,'src/lib/personal-session-store.ts')));
});
test('installed devfans builds the real precomputed MD5 Digest header using hexadecimal nonce count',async()=>{
  const library=await import('digest-fetch');
  const adapter=moduleFrom('src/lib/digest-auth.ts',{'digest-fetch':library,'./digest-session-record':records});
  const endpoint=records.digestEndpoint(fixture);
  const req=new Request('https://maestro.example.test/proxy/api/sparql',{headers:{Authorization:records.DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(fixture))}});
  const header=adapter.restoredDigestAuthorization(req,endpoint);
  assert.ok(header);
  assert.match(header,/^Digest /);
  assert.match(header,/nc=0000000a(?:,|$)/);
  const md5=s=>createHash('md5').update(s).digest('hex');
  const expected=md5(`${fixture.ha1}:${fixture.nonce}:0000000a:${fixture.cnonce}:auth:${md5('POST:/sparql-auth')}`);
  assert.ok(header.includes(`response="${expected}"`));
  assert.ok(!header.includes(fixture.ha1));
  assert.equal(adapter.restoredDigestAuthorization(req,'https://other.example.test/sparql-auth'),null);
  const renewed=adapter.staleDigestRecord(req,endpoint,'Digest realm="SPARQL", nonce="new-nonce", algorithm=MD5, qop="auth", stale=true');
  assert.ok(renewed);assert.equal(renewed.nc,1);assert.equal(renewed.nonce,'new-nonce');
  assert.equal(adapter.staleDigestRecord(req,endpoint,'Digest realm="SPARQL", nonce="new-nonce", algorithm=MD5, qop="auth"'),null);
});


// In-memory IndexedDB test double: the application still uses real browser
// IndexedDB, including its readwrite transaction and key deletion semantics.
function memoryIndexedDb() {
  const map=new Map();
  const keys=[];
  let created=false;
  const db={objectStoreNames:{contains:()=>created},createObjectStore:()=>{created=true;},close(){},
    transaction(name,mode){
      assert.equal(name,records.DIGEST_SESSION_STORE);
      let aborted=false;
      const pending=[];
      const tx={abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {
        get(key){const req={};keys.push(['get',key]);pending.push(()=>{req.result=map.get(key);req.onsuccess?.();});return req;},
        put(value,key){assert.equal(mode,'readwrite');keys.push(['put',key]);pending.push(()=>map.set(key,structuredClone(value)));},
        delete(key){assert.equal(mode,'readwrite');keys.push(['delete',key]);pending.push(()=>map.delete(key));},
      };}};
      queueMicrotask(()=>{while(pending.length&&!aborted)pending.shift()();if(!aborted)tx.oncomplete?.();});
      return tx;
    }};
  return {map,keys,indexedDB:{open(name,version){assert.equal(name,records.DIGEST_SESSION_DB);assert.equal(version,1);
    const req={result:db};queueMicrotask(()=>{if(!created)req.onupgradeneeded?.();req.onsuccess?.();});return req;}}};
}
function storeFixture(network) {
  const db=memoryIndexedDb();
  // Mock only the hashing library boundary for the storage tests. The separate
  // installed-library integration test below exercises the real devfans package.
  let hashCalls=0;
  const library={DigestClient:class{computeHash(user,realm,password){hashCalls++;return createHash('md5').update(`${user}:${realm}:${password}`).digest('hex');}}};
  const api=moduleFrom('src/lib/client-digest-session.ts',{'./digest-session-record':records,'digest-fetch':library},
    {indexedDB:db.indexedDB,location:{protocol:'https:',hostname:'maestro.example.test'},AbortSignal,navigator:{locks:{request:(_key,_options,fn)=>fn()}},fetch:network});
  return {...db,api,hashCalls:()=>hashCalls};
}
const loginInput={username:fixture.username,graphStore:fixture.graphStore,graphPrefix:fixture.graphPrefix,password:'not-persisted-example-password'};
const bootstrapQuery='SELECT ?section WHERE { BIND("probe" AS ?section) } LIMIT 3000';
const bootstrapBindings=[{section:{type:'literal',value:'probe'}}];
const bootstrapResult=()=>Response.json({head:{vars:['section']},results:{bindings:bootstrapBindings}});
const seedQuery=`SELECT ?graph ?digest WHERE { VALUES ?graph { <${fixture.graphPrefix}/query/shacl/policies> } OPTIONAL { GRAPH ?graph { ?graph <gttp://ggg.maestro.ecosys/ns/ui#seedDigest> ?digest } } }`;
const seedBindings=[{graph:{type:'uri',value:fixture.graphPrefix+'/query/shacl/policies'}}];
const seedResult=()=>Response.json({head:{vars:['graph','digest']},results:{bindings:seedBindings}});
const loginNonce={realm:'SPARQL',algorithm:'MD5',qop:'auth',nonce:'first-nonce',cnonce:'first-cnonce',opaque:null,nc:1};
test('Connect ensures the same record, never resets nc, and Disconnect removes the key',async()=>{
  let requests=0;
  const ctx=storeFixture(async(url,init)=>{
    requests++;
    assert.equal(url,'/proxy/api/sparql');
    assert.equal(init.cache,'no-store');
    assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);
    assert.equal(body.query,seedQuery);
    assert.equal(requests===1?body.operation:body.personalRead,requests===1?'auth-probe':true);
    const carrier=init.headers.Authorization;
    assert.ok(carrier.startsWith(records.DIGEST_SESSION_SCHEME));
    assert.ok(!JSON.stringify(init.headers).includes(loginInput.password));
    const identity=JSON.parse(decodeURIComponent(carrier.slice(records.DIGEST_SESSION_SCHEME.length)));
    assert.equal(identity.ha1,createHash('md5').update(`${fixture.username}:SPARQL:${loginInput.password}`).digest('hex'));
    if(requests===1){assert.deepEqual(Object.keys(identity).sort(),['graphPrefix','graphStore','ha1','username']);return Response.json(loginNonce,{status:401});}
    assert.equal(identity.nonce,loginNonce.nonce);assert.equal(identity.nc,1);return seedResult();
  });
  const signal=new AbortController().signal;
  assert.equal(await ctx.api.restoreDigestSession(signal),null);
  assert.equal(requests,0);
  assert.equal(ctx.map.size,0);
  const observed=[];
  const result=await ctx.api.ensureDigestSession(loginInput,signal,status=>observed.push(status),seedQuery,()=>observed.push('challenge sent'));
  assert.deepEqual(JSON.parse(JSON.stringify(result)),seedBindings);
  assert.deepEqual(observed,['challenge sent',200]);
  assert.equal(requests,2);
  assert.equal(ctx.hashCalls(),1);
  assert.equal(ctx.api.restoredDigestSession(),null,'ensure must not establish the user session itself');
  const record=ctx.map.get(records.DIGEST_SESSION_KEY);
  assert.equal(record.nc,1);
  assert.equal(record.nonce,loginNonce.nonce);
  assert.ok(!Object.hasOwn(record,'password'));
  assert.ok(!JSON.stringify(record).includes(loginInput.password));
  const session=await ctx.api.restoreDigestSession(signal);
  assert.equal(session.username,fixture.username);
  assert.equal(ctx.api.restoredDigestSession(),session);
  const reserved=await ctx.api.reserveDigestRequest(session);
  assert.equal(reserved.nc,2);
  await ctx.api.ensureDigestSession({...loginInput,password:''},signal,status=>observed.push(status),seedQuery);
  assert.deepEqual(observed,['challenge sent',200], 'reuse does not invent an HTTP response');
  assert.equal(requests,2);
  assert.equal(ctx.hashCalls(),1);
  assert.equal(ctx.map.get(records.DIGEST_SESSION_KEY).nc,2);
  await ctx.api.forgetDigestSession();
  assert.equal(ctx.map.has(records.DIGEST_SESSION_KEY),false);
  assert.equal(ctx.api.restoredDigestSession(),null);
  assert.equal(await ctx.api.restoreDigestSession(signal),null);
  await assert.rejects(ctx.api.reserveDigestRequest(session),/No restored/);
});
test('A failed or cancelled Connect never stores a Digest record',async()=>{
  const observed=[];
  for(const status of [401,504]){
    const denied=storeFixture(async()=>new Response('',{status}));
    await assert.rejects(denied.api.ensureDigestSession(loginInput,new AbortController().signal,status=>observed.push(status),bootstrapQuery),new RegExp(`HTTP ${status}`));
    assert.equal(denied.map.size,0);
  }
  assert.deepEqual(observed,[401,504]);
  const protectedFailure=[];
  let step=0;
  const timedOut=storeFixture(async()=>++step===1?Response.json(loginNonce,{status:401}):new Response('',{status:504}));
  await assert.rejects(timedOut.api.ensureDigestSession(loginInput,new AbortController().signal,status=>protectedFailure.push(status),bootstrapQuery,()=>{assert.equal(step,2);protectedFailure.push('challenge sent');}),/HTTP 504/);
  assert.deepEqual(protectedFailure,['challenge sent',504]);
  assert.equal(timedOut.map.size,0);
  const abort=new AbortController();
  const cancelled=storeFixture(async()=>{abort.abort();return Response.json(loginNonce);});
  await assert.rejects(cancelled.api.ensureDigestSession(loginInput,abort.signal,status=>observed.push(status),bootstrapQuery));
  assert.deepEqual(observed,[401,504]);
  assert.equal(cancelled.map.size,0);
});
test('URL load and Connect invoke the same restoration and graph hydration routine',async()=>{
  const calls=[];
  let stored=false, snapshot, changed=false, failed=false;
  const session={authType:'sparql-auth',graphStore:fixture.graphStore,graphPrefix:fixture.graphPrefix,username:fixture.username,rememberMe:true};
  const init=moduleFrom('src/lib/personal-initialization.ts');
  const controller=moduleFrom('src/canvas/controllers/authentication.ts',{
    react:{useEffect(fn){fn();},useState(){throw Error('not used');}},
    '@/lib/client-digest-session':{
      restoreDigestSession:async()=>{calls.push('restore');return stored?session:null;},
      withSessionInitializationLock:(_signal,fn)=>fn(),readSessionHydration:async()=>({snapshot,bootstrapBindings}),commitSessionSnapshot:async(_session,value)=>{calls.push('commit');snapshot=value;},restoredDigestSession:()=>stored?session:null,
      ensureDigestSession:async(_input,_signal,_status,query)=>{assert.equal(query,seedQuery);calls.push('ensure');stored=true;return seedBindings;},disconnectDigestSession:()=>{},subscribeDigestSessionChanges:()=>()=>{},requestDigestPersistence:()=>{}},
    '@/lib/personal-initialization':init,
    '@/lib/client-graph-seed':{preparePersonalSeed:async()=>{calls.push('prepare');return {query:seedQuery};},seedPersonalGraphs:async(_signal,plan,rows)=>{calls.push('seed');if(plan)assert.equal(rows,seedBindings);if(failed)throw Error('seed failed');return {revision:'seed1',changedGraphs:changed?['policies']:[]};}},
    '@/lib/client-auth-bootstrap':{authBootstrapSelect:()=>bootstrapQuery,hydrateAuthBootstrap:(_session,bindings)=>{assert.equal(bindings,bootstrapBindings);calls.push('hydrate');},refreshAuthBootstrap:async()=>{calls.push('bootstrap');return bootstrapBindings;}},
    '@/lib/client-kinds':{loadMaestroKinds:async()=>{calls.push('kinds');},resetMaestroKinds:()=>{},currentSessionKinds:()=>[{id:'x',pattern:'x'}],restoreSessionKinds:()=>calls.push('restore kinds')},
    '@/lib/personal-auth':{graphForPrefix:p=>`${p}/query`,personalWriteEndpoint:()=>records.digestEndpoint(fixture)},
    '@/lib/personal-session-hint':{hydratePersonalHttpOutcome:()=>{}},
    '@/lib/client-personal-graph-servers':{listPersonalGraphServers:async()=>{calls.push('directory');return [];},asEndpointOption:x=>x},
    '@/lib/graph-server-startup':{rememberPersonalGraphServers:()=>{}},
  });
  const deps={loginTab:'sparql-auth',loginGraphStore:fixture.graphStore,loginGraphPrefix:fixture.graphPrefix,loginUsername:fixture.username,loginPassword:loginInput.password};
  for(const key of ['setAuthRestoreComplete','setPersonalPoliciesSeedError','setLoginGraphStore','setLoginGraphPrefix','setLoginUsername','setPersonalSparqlEndpoint','setManagedEndpoints','setLoginTesting','setLoginError','setLoginPassword','setLoginDialogOpen'])deps[key]=()=>{};
  deps.setAuthSession=value=>{assert.equal(value,session);calls.push('session');};
  deps.setPersonalPoliciesReady=value=>calls.push(value?'ready':'loading');
  // Start empty, then use the form action and finally simulate a URL reload.
  controller.useAuthenticationSessionLifecycle(deps);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['restore']);
  calls.length=0;
  const action=controller.createAuthenticationActions(deps);
  await action.handleLoginSubmit({preventDefault(){calls.push('preventDefault');}});
  assert.deepEqual(calls,['preventDefault','prepare','ensure','restore','loading','session','seed','bootstrap','kinds','directory','commit','ready']);
  calls.length=0;
  controller.useAuthenticationSessionLifecycle(deps);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['restore','loading','session','seed','hydrate','restore kinds','ready']);
  calls.length=0;changed=true;
  await controller.restoreUserSession(deps,init.beginPersonalInitialization());
  assert.deepEqual(calls,['restore','loading','session','seed','bootstrap','kinds','directory','commit','ready']);
  calls.length=0;failed=true;
  assert.equal(await controller.restoreUserSession(deps,init.beginPersonalInitialization()),false);
  assert.deepEqual(calls,['restore','loading','session','seed','loading']);
});
test('installed devfans acquires the initial Digest challenge and generates the first verified nonce count',async()=>{
  const library=await import('digest-fetch');
  const adapter=moduleFrom('src/lib/digest-auth.ts',{'digest-fetch':library,'./digest-session-record':records});
  const identity=records.parseDigestIdentity(fixture);
  const record=adapter.initialDigestRecord(identity,'Digest realm="SPARQL", nonce="server-nonce", algorithm=MD5, qop="auth", opaque=""');
  assert.ok(record);
  assert.equal(record.nc,1);
  assert.equal(record.nonce,'server-nonce');
  assert.ok(record.cnonce);
  const header=adapter.digestRecordAuthorization(record,records.digestEndpoint(record));
  assert.match(header,/nc=00000001(?:,|$)/);
  const md5=s=>createHash('md5').update(s).digest('hex');
  const expected=md5(`${record.ha1}:${record.nonce}:00000001:${record.cnonce}:auth:${md5('POST:/sparql-auth')}`);
  assert.ok(header.includes(`response="${expected}"`));
  assert.ok(!header.includes(record.ha1));
  assert.equal(adapter.initialDigestRecord(identity,'Basic realm="SPARQL"'),null);
  assert.equal(adapter.initialDigestRecord(identity,'Digest realm="other", nonce="server-nonce", algorithm=MD5, qop="auth"'),null);
  assert.equal(adapter.initialDigestRecord(identity,'Digest realm="SPARQL", nonce="server-nonce", algorithm=MD5-sess, qop="auth"'),null);
  assert.equal(adapter.initialDigestRecord(identity,'Digest realm="SPARQL", nonce="server-nonce", algorithm=MD5, qop="auth-int"'),null);
  const client=new library.DigestClient(fixture.username,loginInput.password,{algorithm:'MD5'});
  assert.equal(client.computeHash(fixture.username,'SPARQL',loginInput.password),md5(`${fixture.username}:SPARQL:${loginInput.password}`));
});

// Test the actual SPARQL route with a transport double; no real credentials or
// remote endpoint are needed. Digest generation itself is verified separately
// with the installed library above.
test('Connect proxy returns challenge metadata and sends the actual authenticated bootstrap without forwarding HA1',async()=>{
  const identity=records.parseDigestIdentity(fixture);
  const endpoint=records.digestEndpoint(identity);
  const request=(authenticated=false,writeBody)=>new Request('https://maestro.example.test/proxy/api/sparql',{method:'POST',headers:{'Content-Type':'application/json',Authorization:records.DIGEST_SESSION_SCHEME+encodeURIComponent(JSON.stringify(authenticated?{...identity,...loginNonce}:identity))},body:JSON.stringify(writeBody??(authenticated?{personalRead:true,addr:`${identity.graphPrefix}/query@${endpoint}`,query:bootstrapQuery}:{operation:'auth-probe',query:bootstrapQuery}))});
  const validJson=bootstrapResult;
  const denied=()=>new Response('',{status:401,headers:{'WWW-Authenticate':'Digest realm="SPARQL", nonce="server-nonce", qop="auth"'}});
  async function run(responses,authenticated=false,stale=false,writeBody){
    const calls=[];
    // The unused general SPARQL imports are not part of this fixed SELECT.
    const modules={};
    for(const m of source('src/app/proxy/api/sparql/route.ts').matchAll(/from\s+"([^"]+)"/g))modules[m[1]]={};
    Object.assign(modules,{
      '@/lib/upstream-error':moduleFrom('src/lib/upstream-error.ts',{}, {Error}),
      '@/lib/personal-update-graph-guard':moduleFrom('src/lib/personal-update-graph-guard.ts'),
      '@/lib/constants/graphs':{GRAPH:{STATUS:'status'},resolveGraph:(key,base)=>`${base}#${key}`},
      '@/lib/digest-auth':{restoredDigestRecord:()=>authenticated?{...identity,...loginNonce}:null,initialDigestIdentity:()=>identity,initialDigestRecord:()=>({...identity,...loginNonce}),restoredDigestAuthorization:()=> 'Digest test-authorization',staleDigestRecord:()=>stale?{...identity,...loginNonce,nonce:'renewed-nonce'}:null,digestRecordAuthorization:()=> 'Digest test-authorization'},
      '@/lib/digest-session-record':records,
      '@/lib/maestro-proxy-client-preferences':{currentProxyClient:()=> 'test',withProxyClient:(_req,fn)=>fn()},
      '@/lib/proxy-query-telemetry':{withProxyQueryTelemetry:(_req,fn)=>fn()},
      '@/lib/proxy-query-events':{traceVirtuosoDispatch:fn=>fn()},
      '@/lib/proxy-debug-server':{logProxyCaller:()=>{}},
      'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
      '@/lib/server-query-scheduler':{withGraphServerSlot:(_ep,_priority,_signal,fn)=>fn()},
      '@/lib/graph-server-query-scheduler':{weightMaestroQuery:()=>1},
      '@/lib/query-cache':{queryCacheKey:()=> 'test',getQueryCache:()=>{throw Error('authentication must bypass cache');},setQueryCache:()=>{throw Error('authentication must not populate cache');}},
      '@/lib/graph-server-target':{permittedGraphServerTarget:ep=>ep===endpoint,checkGraphServerDestination:async ep=>assert.equal(ep,endpoint)},
      '@/lib/maestro-logger':{proxyLog:()=>{},proxyFailure:(_req,_route,error)=>{throw error;}},
      '@/lib/virtuoso-anytime':moduleFrom('src/lib/virtuoso-anytime.ts'),
      '@/lib/sparql-read-guard':{isBoundedReadOnlySparql:q=>q===bootstrapQuery},
    });
    const route=moduleFrom('src/app/proxy/api/sparql/route.ts',modules,{AbortSignal,Response,URLSearchParams,fetch:async(url,init)=>{
      calls.push({url,init});return responses.shift();
    }});
    const response=await route.POST(request(authenticated,writeBody));
    return {response,calls};
  }
  const challenge=await run([denied()]);
  assert.equal(challenge.response.status,401);
  assert.deepEqual(await challenge.response.json(),loginNonce);
  assert.equal(challenge.calls.length,1);
  const success=await run([validJson()],true);
  assert.equal(success.response.status,200);
  assert.equal(success.response.headers.get('x-maestro-upstream-source'),'network');
  assert.equal(success.response.headers.get('x-maestro-upstream-status'),'200');
  assert.deepEqual((await success.response.json()).results.bindings,bootstrapBindings);
  assert.equal(success.calls.length,1);
  for(const {url,init} of [...challenge.calls,...success.calls]){
    assert.equal(url,endpoint);
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'manual');
    assert.equal(init.cache,'no-store');
    assert.equal(new URLSearchParams(init.body).get('query'),bootstrapQuery);
    assert.ok(!JSON.stringify(init.headers).includes(identity.ha1));
  }
  assert.equal(challenge.calls[0].init.headers.Authorization,undefined);
  assert.equal(success.calls[0].init.headers.Authorization,'Digest test-authorization');
  const rejected=await run([denied()],true);
  assert.equal(rejected.response.status,401);
  assert.equal(rejected.response.headers.get('x-maestro-upstream-status'),'401');
  assert.equal(rejected.calls.length,1);
  assert.ok(!Object.hasOwn(await rejected.response.json(),'nonce'));
  const recovered=await run([denied(),validJson()],true,true);
  assert.equal(recovered.response.status,200);assert.equal(recovered.calls.length,2);
  assert.equal(recovered.response.headers.get('x-maestro-upstream-status'),'200','only final Digest result is authoritative');
  const metadata=JSON.parse(decodeURIComponent(recovered.response.headers.get('x-maestro-digest-refresh')));
  assert.equal(metadata.nonce,'renewed-nonce');assert.equal(metadata.nc,1);assert.ok(!Object.hasOwn(metadata,'ha1'));
  const exhausted=await run([denied(),denied()],true,true);
  assert.equal(exhausted.response.status,401);assert.equal(exhausted.calls.length,2);assert.equal(exhausted.response.headers.get('x-maestro-digest-refresh'),null);
  const base=`${identity.graphPrefix}/query`, addr=`${base}@${endpoint}`;
  const update=`INSERT DATA { GRAPH <${base}#policy-approvals> { <urn:record> <urn:predicate> "value" } }`;
  const write={personalWrite:true,addr,update};
  const written=await run([new Response(null,{status:204})],true,false,write);
  assert.equal(written.response.status,204);assert.equal(written.calls.length,1);
  assert.equal(written.calls[0].init.body,update);
  assert.equal(written.calls[0].init.headers['Content-Type'],'application/sparql-update');
  assert.equal(written.calls[0].init.headers.Authorization,'Digest test-authorization');
  const renewedWrite=await run([denied(),new Response(null,{status:204})],true,true,write);
  assert.equal(renewedWrite.response.status,204);assert.equal(renewedWrite.calls.length,2);
  assert.ok(renewedWrite.response.headers.get('x-maestro-digest-refresh'));
  for(const bad of [update.replace(base,'https://other.test/query'),`INSERT DATA { <urn:s> <urn:p> <urn:o> . GRAPH <${base}> { <urn:s> <urn:p> <urn:o> } }`,`${update}; CLEAR ALL`]){
    const rejectedWrite=await run([],true,false,{...write,update:bad});
    assert.equal(rejectedWrite.response.status,400);assert.equal(rejectedWrite.calls.length,0);
  }
  const unauthWrite=await run([],false,false,write);assert.equal(unauthWrite.response.status,401);assert.equal(unauthWrite.calls.length,0);
  assert.equal(unauthWrite.response.headers.get('x-maestro-upstream-status'),null,'proxy-generated 401 is not upstream authentication evidence');
  const anonymous=await run([validJson()]);
  assert.equal(anonymous.response.status,502);
  assert.equal(anonymous.calls.length,1);
});

 test('two tabs serialize first Connect and nonce use, receive committed login/logout and retain no credential in broadcasts',async()=>{
  const db=memoryIndexedDb(), messages=[], channels=new Set();
  class Channel {
    constructor(name){this.name=name;this.listeners=new Set();channels.add(this);}
    addEventListener(_type,fn){this.listeners.add(fn);}
    removeEventListener(_type,fn){this.listeners.delete(fn);}
    postMessage(data){messages.push(data);for(const other of channels)if(other!==this && other.name===this.name)for(const fn of other.listeners)queueMicrotask(()=>fn({data}));}
    close(){channels.delete(this);}
  }
  let tail=Promise.resolve(), requests=0, hashCalls=0, persists=0;
  const locks={request(_key,options,fn){const next=tail.then(()=>{options.signal?.throwIfAborted();return fn();});tail=next.catch(()=>{});return next;}};
  const library={DigestClient:class{computeHash(user,realm,password){hashCalls++;return createHash('md5').update(`${user}:${realm}:${password}`).digest('hex');}}};
  const deps={'./digest-session-record':records,'digest-fetch':library};
  const globals={indexedDB:db.indexedDB,location:{protocol:'https:',hostname:'maestro.example.test'},AbortSignal,BroadcastChannel:Channel,
    navigator:{locks,storage:{persist:async()=>{persists++;return false;}}},fetch:async(_url,init)=>{
      requests++;const body=JSON.parse(init.body);
      return body.operation==='auth-probe'?Response.json(loginNonce,{status:401}):bootstrapResult();
    }};
  const a=moduleFrom('src/lib/client-digest-session.ts',deps,globals),b=moduleFrom('src/lib/client-digest-session.ts',deps,globals);
  const signal=new AbortController().signal;
  let tabAEvents=0,tabBEvents=0;
  const closeA=a.subscribeDigestSessionChanges(()=>tabAEvents++);
  const closeB=b.subscribeDigestSessionChanges(()=>{tabBEvents++;b.disconnectDigestSession();});
  a.requestDigestPersistence();assert.equal(persists,1);
  await Promise.all([a.ensureDigestSession(loginInput,signal,undefined,bootstrapQuery),b.ensureDigestSession(loginInput,signal,undefined,bootstrapQuery)]);
  assert.equal(requests,2,'only one challenge and one authenticated bootstrap');assert.equal(hashCalls,1);
  assert.equal(tabAEvents,0);assert.equal(tabBEvents,1);
  const sa=await a.restoreDigestSession(signal),sb=await b.restoreDigestSession(signal);
  const counts=[];
  await Promise.all([a.withDigestSessionLock(signal,async()=>{const r=await a.reserveDigestRequest(sa);await new Promise(r=>setTimeout(r,5));counts.push(r.nc);}),b.withDigestSessionLock(signal,async()=>{const r=await b.reserveDigestRequest(sb);counts.push(r.nc);})]);
  assert.deepEqual(counts,[2,3]);
  const current=await a.reserveDigestRequest(sa);
  const newMetadata={...loginNonce,nonce:'renewed-nonce',cnonce:'renewed-cnonce',nc:1};
  await a.commitRefreshedDigest(sa,current,new Response('{}',{headers:{'x-maestro-digest-refresh':encodeURIComponent(JSON.stringify(newMetadata))}}));
  const next=await b.reserveDigestRequest(sb);assert.equal(next.nonce,'renewed-nonce');assert.equal(next.nc,2);
  const pending=b.digestSessionSignal(sb);
  await a.forgetDigestSession();
  assert.equal(db.map.size,0);assert.equal(tabBEvents,2);assert.equal(b.restoredDigestSession(),null);assert.equal(pending.aborted,true);
  assert.equal(await b.restoreDigestSession(signal),null);assert.deepEqual(messages,['changed','changed']);
  closeA();closeB();assert.equal(channels.size,0);
 });

 test('initialized snapshot survives nonce reservation, renewal and new-tab restoration; Disconnect deletes all',async()=>{
   const ctx=storeFixture(async(_url,init)=>JSON.parse(init.body).operation==='auth-probe'?Response.json(loginNonce,{status:401}):bootstrapResult());
   const signal=new AbortController().signal;
   await ctx.api.ensureDigestSession(loginInput,signal,undefined,bootstrapQuery);
   const session=await ctx.api.restoreDigestSession(signal);
   const snapshot={bindings:bootstrapBindings,kinds:[{id:'x',pattern:'x'}],servers:[],completedAt:100,seedRevision:'seed1'};
   await ctx.api.commitSessionSnapshot(session,snapshot,signal);
   assert.equal(ctx.map.get(records.DIGEST_SESSION_KEY).bootstrapBindings,undefined);
   const reserved=await ctx.api.reserveDigestRequest(session);
   assert.ok(!Object.hasOwn(reserved,'snapshot'));
   await ctx.api.commitRefreshedDigest(session,reserved,new Response(null,{status:204,headers:{'x-maestro-digest-refresh':encodeURIComponent(JSON.stringify({...loginNonce,nonce:'new',cnonce:'new',nc:1}))}}));
   await ctx.api.rememberDigestHttpOutcome(session,204,Date.now()+1000);
   const other=moduleFrom('src/lib/client-digest-session.ts',{'./digest-session-record':records},{indexedDB:ctx.indexedDB});
   const otherSession=await other.restoreDigestSession(signal);
   const read=await other.readSessionHydration(otherSession);
   assert.deepEqual(JSON.parse(JSON.stringify(read.snapshot)),snapshot);
   assert.equal(read.httpOutcome.status,204);
   await other.updateSessionSnapshot(otherSession,{buttons:[]});
   assert.deepEqual(JSON.parse(JSON.stringify((await ctx.api.readSessionHydration(session)).snapshot)),{...snapshot,buttons:[]});
   await ctx.api.forgetDigestSession();assert.equal(ctx.map.size,0);
   await assert.rejects(other.readSessionHydration(otherSession),/session changed/);
 });
