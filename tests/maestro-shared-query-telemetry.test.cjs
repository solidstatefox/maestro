const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function loadTypescript(relative, imports, globals = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  const observation = require('./transport-test-loader.cjs').loadTransportObservation(globals);
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require(name) {
      if (name === './proxy-transport-observation') return observation;
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error('Unexpected dependency: ' + name);
    },
    Request, Response, ReadableStream, AbortController, AbortSignal, DOMException,
    TextEncoder, TextDecoder, URL, Headers, crypto: require('node:crypto').webcrypto,
    Map, Set, Promise, JSON, setInterval, clearInterval, setTimeout, clearTimeout,
    ...globals,
  }, { filename: relative });
  return module.exports;
}

function harness() {
  let starts = 0;
  let completes = 0;
  let serviceCalls = 0;
  let activeService = 0;
  let maxService = 0;
  const queuePositions = [];
  const serviceControllers = [];
  const server = loadTypescript('src/lib/proxy-query-telemetry.ts', {
    './proxy-query-events': { withProxyQueryEventSink: async (sink, run) => {
      sink('queue-position', { queryId: 0, queueIndex: 2, server: 'cordis', lane: 'light', laneNumber: 1, lanePosition: 2 });
      sink('dispatched', { queryId: 1 });
      try { return await run(); }
      finally { sink('completed', { queryId: 1, elapsedMs: 17 }); }
    } },
  });
  const client = loadTypescript('src/lib/client-query-events.ts', {
    './maestro-query-execution-clock': {
      beginMaestroQueryExecution: () => { starts++; return () => { completes++; }; },
    },
  }, { fetch: async (url, init) => {
    assert.equal(url, '/proxy/api/service');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.operationId, 'subscribeQueryEvents');
    serviceCalls++;
    activeService++;
    maxService = Math.max(maxService, activeService);
    const stop = new AbortController();
    serviceControllers.push(stop);
    init.signal.addEventListener('abort', () => { stop.abort(); activeService--; }, { once: true });
    return server.openProxyQueryTelemetry(new Request('http://localhost/proxy/api/service', {
      method: 'POST', signal: stop.signal,
    }), body.parameters.id);
  } });
  return {
    client, server, queuePositions,
    clocks: () => ({ starts, completes }),
    streams: () => ({ serviceCalls, activeService, maxService }),
    closeAll: () => serviceControllers.forEach(controller => controller.abort()),
  };
}
const id = index => `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`;

async function query(h, requestId, channel) {
  return h.server.withProxyQueryTelemetry(new Request('http://localhost/proxy/api/fct', {
    method: 'POST',
    headers: { 'x-maestro-telemetry-id': requestId, 'x-maestro-telemetry-stream-id': channel.streamId },
    body: '<query/>',
  }), async () => new Response('<fct:facets/>', { headers: { 'content-type': 'application/xml' } }));
}

test('six concurrent FCT requests multiplex queue and timer events through ONE OpenAPI SSE connection', async () => {
  const h = harness();
  try {
    const ids = Array.from({ length: 6 }, (_, index) => id(index + 1));
    const positions = new Map();
    const channels = await Promise.all(ids.map(requestId => h.client.subscribeMaestroQueryEvents(
      requestId, 'results', undefined,
      (index, server, lane, laneIndex, laneNumber, lanePosition) => {
        positions.set(requestId, { index, server, lane, laneNumber, lanePosition });
      },
    )));
    assert.equal(h.streams().serviceCalls, 1, 'one SSE connection per tab, not six');
    assert.equal(new Set(channels.map(channel => channel.streamId)).size, 1);
    const responses = await Promise.all(channels.map((channel, index) => query(h, ids[index], channel)));
    assert.deepEqual(await Promise.all(responses.map(response => response.text())), Array(6).fill('<fct:facets/>'));
    // Let the SSE reader deliver the frames pushed by the mock proxy.
    for (let i = 0; i < 20 && h.clocks().completes < 6; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(positions.size, 6, 'queue positions belong to their individual requests');
    for (const position of positions.values()) {
      assert.equal(position.index, 2);
      assert.equal(position.server, 'cordis');
      assert.equal(position.lane, 'light');
      assert.equal(position.laneNumber, 1);
      assert.equal(position.lanePosition, 2);
    }
    assert.deepEqual(h.clocks(), { starts: 6, completes: 6 });
    for (const channel of channels) channel.close();
    assert.equal(h.streams().maxService, 1);
  } finally { h.closeAll(); }
});

test('cancelling one query only releases its listener; other query remains connected', async () => {
  const h = harness();
  try {
    const abort = new AbortController();
    const first = await h.client.subscribeMaestroQueryEvents(id(7), 'results', abort.signal);
    const second = await h.client.subscribeMaestroQueryEvents(id(8), 'results');
    assert.equal(first.streamId, second.streamId);
    abort.abort();
    assert.equal(h.streams().activeService, 1, 'abort must not close shared telemetry stream');
    await query(h, id(8), second);
    for (let i = 0; i < 20 && h.clocks().completes < 1; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.deepEqual(h.clocks(), { starts: 1, completes: 1 });
    second.close();
  } finally { h.closeAll(); }
});

test('native request transport sends both per-query and tab-stream UUIDs, without new routes', () => {
  const cache = fs.readFileSync(path.join(root, 'src/lib/client-query-cache.ts'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/app/proxy/api/service/route.ts'), 'utf8');
  assert.match(cache, /headers\.set\("x-maestro-telemetry-id", telemetryId\)/);
  assert.match(cache, /headers\.set\("x-maestro-telemetry-stream-id", channel\.streamId\)/);
  assert.match(service, /operation\.operationId === "subscribeQueryEvents"/);
  assert.match(service, /openProxyQueryTelemetry\(request, id\)/);
});


test('hung optional telemetry handshake fails within its deadline, without waiting for fetch to settle', async () => {
  const client = loadTypescript('src/lib/client-query-events.ts', {
    './maestro-query-execution-clock': { beginMaestroQueryExecution: () => () => {} },
  }, { fetch: () => new Promise(() => {}) });
  const started = Date.now();
  await assert.rejects(client.subscribeMaestroQueryEvents(id(9), 'results'), /Telemetry handshake timed out/);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1000 && elapsed < 4000, `optional telemetry took ${elapsed}ms`);
});

test('pre-aborted query does not open any telemetry connection', async () => {
  const h = harness();
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(h.client.subscribeMaestroQueryEvents(id(10), 'results', signal.signal), /Query canceled/);
  assert.equal(h.streams().serviceCalls, 0);
});

test('query result may arrive before its SSE completion without losing the clock', async () => {
  let started = 0;
  let completed = 0;
  let controller;
  const eventStream = new ReadableStream({ start(value) { controller = value; } });
  const encoder = new TextEncoder();
  const write = (event, data) => controller.enqueue(encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const client = loadTypescript('src/lib/client-query-events.ts', {
    './maestro-query-execution-clock': { beginMaestroQueryExecution: () => {
      started++;
      return () => completed++;
    } },
  }, { fetch: async () => new Response(eventStream, { headers: { 'content-type': 'text/event-stream' } }) });
  const requestId = id(11);
  write('ready', {});
  const channel = await client.subscribeMaestroQueryEvents(requestId, 'results');
  // The native FCT POST settled already; the browser calls close before the
  // independently delivered dispatch/completion frames arrive.
  channel.close();
  write('dispatched', { requestId, queryId: 1 });
  write('completed', { requestId, queryId: 1, elapsedMs: 22 });
  write('finished', { requestId });
  for (let i = 0; i < 20 && completed < 1; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(started, 1);
  assert.equal(completed, 1);
  controller.close();
});
