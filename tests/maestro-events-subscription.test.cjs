const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(stream) {
  const code = fs.readFileSync(path.join(__dirname,'../src/lib/client-query-events.ts'),'utf8');
  const js = ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  let started=0, completed=0;
  const calls=[];
  vm.runInNewContext(js, {
    module:mod,exports:mod.exports,require(name) {
      if (name.endsWith('maestro-query-execution-clock')) return {
        beginMaestroQueryExecution: () => {started++; return () => {completed++;};}
      };
      throw Error(`Unexpected dependency ${name}`);
    },
    fetch: async (url, options) => { calls.push({url, options}); return new Response(stream,{headers:{'content-type':'text/event-stream'}}); },
    TextDecoder, TextEncoder, ReadableStream, Response, Headers, DOMException,
    AbortController, AbortSignal, Map, Set, Promise, JSON, setTimeout, clearTimeout,
  });
  return {subscribe:mod.exports.subscribeMaestroQueryEvents, calls, counts:()=>[started,completed]};
}

test('telemetry handshake precedes POST; queue and clock events parse CRLF across chunks', async () => {
  const frame = [
    ['ready',{}],
    ['queue-position',{queryId:0, queueIndex:2,server:'local'}],
    ['dispatched',{queryId:1}],
    ['completed',{queryId:1,elapsedMs:85}],
    ['finished',{}],
  ].map(([event,data])=>`event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`).join('');
  const bytes=new TextEncoder().encode(frame);
  const cut=frame.indexOf('\r\n')+1;
  const stream=new ReadableStream({start(controller) {
    controller.enqueue(bytes.slice(0,cut));
    controller.enqueue(bytes.slice(cut,cut+9));
    controller.enqueue(bytes.slice(cut+9));
    controller.close();
  }});
  const {subscribe,calls,counts}=harness(stream);
  const positions=[];
  const sub=await subscribe('123e4567-e89b-42d3-a456-426614174001','results',undefined,(n,server)=>positions.push([n,server]));
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/proxy/api/service');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers.Accept,'text/event-stream');
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    service:'maestroTransport', operationId:'subscribeQueryEvents',
    parameters:{id:'123e4567-e89b-42d3-a456-426614174001'},
  });
  assert.equal(JSON.stringify(positions),'[[2,"local"]]');
  assert.equal(JSON.stringify(counts()),'[1,1]');
  sub.close();
});
