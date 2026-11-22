const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function readTS(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = {exports:{}};
  vm.runInNewContext(js, {
    module:mod, exports:mod.exports,
    require(name) { if (Object.hasOwn(mocks,name)) return mocks[name]; throw new Error(name); },
    Request, Response, ReadableStream, AbortController, AbortSignal, DOMException,
    TextEncoder, TextDecoder, URL, Map, Set, Promise, JSON, setInterval, clearInterval, setTimeout, clearTimeout,
  }, {filename:file});
  return mod.exports;
}

test('OpenAPI event operation carries queue and timing frames, while FCT returns native XML and headers', async () => {
  let boundSink = null;
  const api = readTS('src/lib/proxy-query-telemetry.ts', {
    './proxy-query-events': {withProxyQueryEventSink: async (sink, run) => {
      boundSink = sink;
      try { return await run(); } finally { boundSink = null; }
    }},
  });
  const id = '123e4567-e89b-42d3-a456-426614174001';
  const stop = new AbortController();
  const subscription = api.openProxyQueryTelemetry(new Request('https://localhost/proxy/api/service',{method:'POST',signal:stop.signal}), id);
  assert.equal(subscription.headers.get('content-type'),'text/event-stream; charset=utf-8');
  const reader = subscription.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: ready/);
  const response = await api.withProxyQueryTelemetry(new Request('https://localhost/proxy/api/fct', {
    method:'POST', headers:{'x-maestro-telemetry-id':id}, body:'<query/>'
  }),async () => {
    boundSink('queue-position',{queryId:0,queueIndex:2,server:'https://cordis.europa.eu/datalab/sparql'});
    boundSink('dispatched',{queryId:1});
    boundSink('completed',{queryId:1,elapsedMs:229});
    return new Response('<fct:facets xmlns:fct="http://openlinksw.com/services/facets/1.0/"/>',{
      status:200, headers:{'content-type':'application/xml; charset=utf-8'}
    });
  });
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/application\/xml/);
  assert.equal(await response.text(),'<fct:facets xmlns:fct="http://openlinksw.com/services/facets/1.0/"/>');
  let frames = '';
  while(true) {const {done,value}=await reader.read(); if(done)break; frames+=new TextDecoder().decode(value);}
  assert.match(frames,/event: queue-position/);
  assert.match(frames,/event: dispatched/);
  assert.match(frames,/event: completed/);
  assert.match(frames,/event: finished/);
  assert.doesNotMatch(frames,/event: result/);
  stop.abort();
});

test('ordinary uninstrumented FCT POST preserves its native response', async () => {
  const api = readTS('src/lib/proxy-query-telemetry.ts', {
    './proxy-query-events': {withProxyQueryEventSink: async (sink,run)=>run()},
  });
  const expected = new Response('<fct:facets/>',{status:200,headers:{'content-type':'application/xml'}});
  const actual = await api.withProxyQueryTelemetry(new Request('https://localhost/proxy/api/fct',{
    method:'POST',body:'<query/>'
  }),async()=>expected);
  assert.equal(actual,expected);
});

test('proxy FCT and SPARQL no longer serve SSE-wrapped query results, native telemetry is separate', () => {
  const root = path.join(__dirname, '..');
  for (const kind of ['fct','sparql']) {
    const src = fs.readFileSync(path.join(root, `src/app/proxy/api/${kind}/route.ts`),'utf8');
    assert.match(src,/withProxyQueryTelemetry/);
    assert.doesNotMatch(src,/streamProxyQuery|MAESTRO_EVENT_HEADER/);
  }
  const cache = fs.readFileSync(path.join(root,'src/lib/client-query-cache.ts'),'utf8');
  assert.match(cache,/subscribeMaestroQueryEvents/);
  assert.doesNotMatch(cache,/unwrapMaestroQueryEvents/);
  const service = fs.readFileSync(path.join(root,'src/app/proxy/api/service/route.ts'),'utf8');
  assert.match(service,/openProxyQueryTelemetry/);
  assert.match(fs.readFileSync(path.join(root,'src/lib/client-query-events.ts'),'utf8'),/operationId: "subscribeQueryEvents"/);
  assert.ok(!fs.existsSync(path.join(root,'src/lib/proxy-query-stream.ts')));
});

test('EURIO project formatter keeps status and acronym out of Details and formats monthly duration and participants',()=>{
  const root=path.join(__dirname,'..');
  const xsl=fs.readFileSync(path.join(root,'graph/eu-data/record.xsl'),'utf8');
  assert.match(xsl,/concat\(\$eu,'projectStatus'\)/);
  assert.match(xsl,/concat\(\$eu,'hasAcronym'\)/);
  assert.match(xsl,/id="eu-project-acronym"/);
  // EURIO durations are stored as months, but the formatter now displays
  // human-readable years/months (and approximate weeks/days if fractional).
  assert.match(xsl, /<xsl:function name="fmt:months"/);
  assert.match(xsl, /if \(\$years = 1\) then 'year' else 'years'/);
  assert.match(xsl, /if \(\$remaining = 1\) then 'month' else 'months'/);
  assert.match(xsl, /fmt:months\(string\(\$durationRow\/fct:column\[3\]\)\)/);
  // The pin follows start + project duration, not today's progress.
  assert.match(xsl, /name="durationEnd"/);
  assert.match(xsl, /\$durationEnd - xs:date\(substring\(\$startValue/);
  assert.match(xsl,/name="project-involved-party"/);
  assert.match(xsl,/xsl:text> \| P-<\/xsl:text>/);
  assert.match(xsl,/name="project-status-svg"/);
});
