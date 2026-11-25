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
  const network = ()=>new Promise(resolve=>pendingNetwork.push(resolve));
  const observation = require('./transport-test-loader.cjs').loadTransportObservation({fetch:network});
  const attribution={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,"../src/lib/sparql-request-attribution.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:attribution.exports,Headers,Request,URL,require:id=>{assert.equal(id,'./proxy-transport-observation');return observation;}});
  const mocks = {
    "@/lib/sparql-request-attribution":attribution.exports,
    "@/lib/proxy-transport-observation":observation,
    '@/lib/client-personal-request': { withPersonalProxyCredentials: async (_url,init)=>({init,authenticated:false}) },
    '@/lib/personal-session-hint': { observePersonalAuthResponse: response => response },
    './maestro-language': { maestroLanguageHeader: () => 'en' },
    './maestro-concurrency': { readMaestroConcurrency: () => ({proxyConnections:1}) },
    './maestro-query-execution-clock': { maestroQueryClockScope:()=>null },
    './client-query-events': { subscribeMaestroQueryEvents: async (id, scope, signal, notify) => {telemetryCallbacks.push(notify); return {close(){}}} },
    './maestro-incomplete-results': { setMaestroIncompleteResults:()=>{} },
     './virtuoso-anytime': (()=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/virtuoso-anytime.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:mod.exports});return mod.exports;})(),
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
  const send=(label)=>client.maestroQueryFetch('/proxy/api/sparql',{method:'POST',body:'ASK {}',headers:{'x-maestro-debug-source':`urn:maestro:component:${label}`,'x-maestro-debug-component':label}});
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


test('Record SELECT preserves incoming blank-node subjects and empty/language-tagged literal values', async () => {
  const focus = 'http://dbpedia.org/resource/India';
  const predicate = 'urn:example:related';
  const result = { results: { bindings: [
    { subject: { type: 'bnode', value: 'node42' }, predicate: { type: 'uri', value: predicate }, object: { type: 'uri', value: focus } },
    { subject: { type: 'uri', value: focus }, predicate: { type: 'uri', value: predicate }, object: { type: 'literal', value: '  India  ', 'xml:lang': 'en' } },
    { subject: { type: 'uri', value: focus }, predicate: { type: 'uri', value: predicate }, object: { type: 'literal', value: '' } },
  ] } };
  const code = ts.transpileModule(read('src/canvas/controllers/record-description-loader.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require(name) {
    if (name === '@/lib/client-query-cache') return { cachedFetchFct: async () => new Response(JSON.stringify(result)) };
    if (name === '@/lib/proxy-debug') return { proxyDebugHeaders: () => ({}) };
    if (name === '@/lib/maestro-component-retry') return { componentRetryHeaders: () => ({}) };
    throw Error(name);
  }, Response, AbortController, JSON, Map, Set, Promise });
  const record = await mod.exports.loadRecordDescription({ queryXml: '<query/>', value: focus, termType: 'uri', limit: 100, preferredLanguage: 'en', signal: new AbortController().signal });
  assert.match(record.xml, /termType="bnode">_:node42</);
  assert.match(record.xml, /termType="literal" xml:lang="en">  India  </);
  assert.match(record.xml, /termType="literal"><\/fct:column>/);
  assert.equal(record.rows.find(r => r.direction === 'property-of').termType, 'bnode');
  assert.equal(record.rows.find(r => r.direction === 'property-of').value, '_:node42');
  assert.equal(record.rows.length, 3);
  const validator = read('src/canvas/right/validator.tsx');
  assert.match(validator, /subjectType = subjectCell.getAttribute\("termType"\)/);
  assert.match(validator, /objectCell.getAttributeNS\("http:\/\/www.w3.org\/XML\/1998\/namespace", "lang"\)/);
  assert.doesNotMatch(validator, /textContent\?\.trim\(/);
  const shacl = read('src/lib/client-record-shacl.ts');
  assert.match(shacl, /Record RDF triple \$\{index \+ 1\}/);
});
