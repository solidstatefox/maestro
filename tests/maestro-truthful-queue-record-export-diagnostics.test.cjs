const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('browser indexes stay browser-local and proxy lane addresses come only from telemetry', async () => {
  const code = ts.transpileModule(read('src/lib/client-query-cache.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const mod = { exports: {} }; const pendingNetwork = []; const telemetryCallbacks=[];
  const mocks = {
    '@/lib/client-personal-request': { withPersonalProxyCredentials: async (_url,init)=>({init,authenticated:false}) },
    './maestro-language': { maestroLanguageHeader: () => 'en' },
    './maestro-concurrency': { readMaestroConcurrency: () => ({proxyConnections:1}) },
    './maestro-query-execution-clock': { maestroQueryClockScope:()=>null },
    './client-query-events': { subscribeMaestroQueryEvents: async (id, scope, signal, notify) => {telemetryCallbacks.push(notify); return {close(){}}} },
    './maestro-incomplete-results': { setMaestroIncompleteResults:()=>{} },
    './maestro-query-timeouts': { applyFctQueryTimeout:(source,xml)=>xml,configuredTimeoutMs:()=>0 },
  };
  vm.runInNewContext(code, {
    exports:mod.exports,module:mod,require(id){if(id in mocks)return mocks[id];throw Error(`unexpected mock ${id}`)},
    fetch:()=>new Promise(resolve=>pendingNetwork.push(resolve)), Request,Response,Headers,
    AbortController,AbortSignal,DOMException,URL,crypto: require('node:crypto').webcrypto,
    Map,Set,WeakMap,Promise,JSON,TextDecoder,TextEncoder
  });
  const client=mod.exports;let pending=[];
  client.subscribePendingMaestroQueryDetails(xs=>{pending=xs.map(x=>({...x}))});
  const send=(label)=>client.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:'ASK {}',headers:{'x-maestro-debug-source':label}});
  const first=send('first'),second=send('second'),third=send('count-third');
  for(let i=0;i<7;i++)await Promise.resolve();
  assert.equal(pending.find(x=>x.label==='second').queueIndex,1);
  assert.equal(pending.find(x=>x.label==='count-third').queueIndex,2);
  // First request is admitted to proxy. No proxy lane is known until SSE reports it.
  assert.equal(pending.find(x=>x.label==='first').queueIndex,0);
  assert.equal(telemetryCallbacks.length,1);
  telemetryCallbacks[0](8,'https://example.org/sparql','heavy',6,2,3);
  assert.equal(pending.find(x=>x.label==='first').queueIndex,0,'proxy queues never take a browser index');
  assert.equal(pending.find(x=>x.label==='first').serverQueueIndex,8);
  assert.equal(pending.find(x=>x.label==='first').serverQueueLaneNumber,2);
  assert.equal(pending.find(x=>x.label==='first').serverQueueLanePosition,3);
  assert.equal(pending.find(x=>x.label==='second').queueIndex,1,'browser-local indexes are not offset by proxy requests');
  telemetryCallbacks[0](0,'https://example.org/sparql','heavy',0,0,0);
  assert.equal(pending.find(x=>x.label==='first').proxyDispatchConfirmed,true);
  pendingNetwork[0](new Response('ok',{status:200})); await first;
  for(let i=0;i<7;i++)await Promise.resolve();
  pendingNetwork[1](new Response('ok',{status:200})); await second;
  for(let i=0;i<7;i++)await Promise.resolve();
  pendingNetwork[2](new Response('ok',{status:200})); await third;
});

test('Record XML serializer escapes illegal C0 characters and preserves XML entities and Unicode', async () => {
  const code=ts.transpileModule(read('src/canvas/controllers/record-description-loader.ts'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const mod={exports:{}};
  const fct = {
    results:{bindings:[{
      subject:{type:'uri',value:'http://example.org/project'},
      predicate:{type:'uri',value:'http://example.org/title'},
      object:{type:'literal',value:'A\u0019 & < B 🪐',datatype:'http://www.w3.org/2001/XMLSchema#string'}
    }]}
  };
  vm.runInNewContext(code, {module:mod,exports:mod.exports,
    require(name){
      if(name==='@/lib/client-query-cache')return {cachedFetchFct:async()=>new Response(JSON.stringify(fct),{status:200})};
      if(name==='@/lib/proxy-debug')return {proxyDebugHeaders:()=>({})};
      if(name==='@/lib/maestro-component-retry')return {componentRetryHeaders:()=>({})};
      throw Error(name);
    }, Response,AbortController,JSON,Map,Set,Promise
  });
  const result=await mod.exports.loadRecordDescription({queryXml:'<query/>', value:'http://example.org/project',termType:'uri',limit:25, preferredLanguage:'en',signal:new AbortController().signal});
  assert.doesNotMatch(result.xml,/\u0019/);
  assert.match(result.xml,/A\uFFFD &amp; &lt; B 🪐/);
  assert.match(result.xml,/termType="literal" datatype="http:\/\/www.w3.org\/2001\/XMLSchema#string"/);
  assert.doesNotMatch(result.xml,/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
});

test('Record MIME picker provides four correct RDF formats and never silently exports parsed fragments', () => {
  const source=read('src/canvas/right/record-export.ts');
  const record=read('src/canvas/right/record.tsx');
  const pane=read('src/canvas/right/pane.tsx');
  for(const mime of ['application/n-triples','text/turtle','text/n3','application/rdf+xml'])assert.ok(source.includes(mime),mime);
  assert.match(source,/if \(snapshot.incomplete\) throw new Error/);
  assert.match(source,/if \(parseError\) throw new Error/);
  assert.match(source,/const objectKind = object.getAttribute\("termType"\)/);
  assert.match(source,/const writer = new Writer\(\{ format: option \}\)/);
  assert.match(record,/snapshotRecordQuads\(snapshot\)/);
  assert.match(pane,/<Dialog open=\{recordExportOpen\}/);
  assert.match(pane,/onClick=\{\(\) => setRecordExportOpen\(true\)\}/);
  assert.match(pane,/downloadRecordDescribe\(recordExportFormat\)/);
  assert.match(pane,/<Select value=\{recordExportFormat\}/);
});

test('Personal facet failures expose a copyable hazard, HTTP status, attribution, FCT XML, and scoped retry', () => {
  const source=read('src/canvas/left/filter.tsx');
  const widget=read('src/canvas/left/personal-widget-cards.tsx');
  const error=read('src/components/ui/error-details.tsx');
  assert.match(source,/const sourceUrn = sourceNode\?\.id \? dynamicUiComponentUrn\("property", sourceNode.id\) : UI_COMPONENT.personalPane/);
  for(const required of ['x-maestro-debug-source','x-maestro-debug-component','x-maestro-debug-request','Cloned FCT XML (verbatim)','httpInfo','tree.attributes.addr'])assert.ok(source.includes(required),required);
  assert.match(widget,/<ErrorDetails prefix=\{`Personal facet /);
  assert.match(widget,/onRetry=\{\(\) => retryMaestroComponent\(`personal:\$\{widgetKey\}`\)\}/);
  assert.match(error,/fullDiagnostic/);
  assert.match(error,/navigator.clipboard.writeText\(fullDiagnostic\)/);
});

test('all changed TypeScript and TSX documents have parse-valid ASTs',()=>{
  for(const file of [
    'src/lib/client-query-cache.ts','src/canvas/top/appbar-pane.tsx','src/canvas/controllers/record-description-loader.ts',
    'src/canvas/right/validator.tsx','src/canvas/right/record-export.ts','src/canvas/right/record.tsx',
    'src/canvas/right/pane.tsx','src/canvas/utils/workspace-controller.tsx','src/canvas/controllers/record-session-controller.tsx',
    'src/canvas/left/filter.tsx','src/canvas/left/personal-widget-cards.tsx',
  ]){
    const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file);
  }
});
