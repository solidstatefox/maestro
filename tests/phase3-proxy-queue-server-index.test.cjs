const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScheduler() {
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/graph-server-query-scheduler.ts'), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const events = [];
  const mod = {exports: {}};
  vm.runInNewContext(js, {
    exports: mod.exports, module: mod,
    require(name) {
      if (name.endsWith('maestro-proxy-client-preferences')) return {
        currentProxyClient: () => 'test',
        getProxyClientPreferences: () => ({lightPerServer: 1, heavyPerServer: 1}),
      };
      if (name.endsWith('proxy-query-events')) return {
        proxyQueuePositionNotifier: () => (position, server) => events.push({position, server}),
      };
      throw Error(`Unexpected import ${name}`);
    },
    DOMException, AbortController, Headers, URL, Promise, Map, Set,
  }, {filename: 'graph-server-query-scheduler.js'});
  return {schedule: mod.exports.scheduleMaestroQuery, reschedule: mod.exports.rescheduleMaestroQueries, events};
}

test('server scheduler issues one-based positions across heavy/light and reindexes after cancellation', async () => {
  const {schedule, events} = loadScheduler();
  let finishRunning;
  const running = schedule('https://dbpedia.org/sparql', 'interactive', undefined,
    () => new Promise(resolve => { finishRunning = resolve; }), 'heavy');
  const cancel = new AbortController();
  const canceled = schedule('https://dbpedia.org/sparql', 'interactive', cancel.signal, async () => 'cancelled', 'heavy');
  const second = schedule('https://dbpedia.org/sparql', 'count', undefined, async () => 'second', 'heavy');
  assert.ok(events.some(e => e.position === 1));
  assert.ok(events.some(e => e.position === 2));
  cancel.abort();
  await assert.rejects(canceled, /canceled/i);
  // The remaining queued task moves to the front of the authoritative queue.
  assert.equal(events.at(-1).position, 1);
  finishRunning('running');
  assert.equal(await running, 'running');
  assert.equal(await second, 'second');
});

test('multi-server pending positions are unique, regardless of lane', async () => {
  const {schedule, events} = loadScheduler();
  const release = [];
  const block = server => schedule(server, 'interactive', undefined,
    () => new Promise(resolve => release.push(resolve)), 'light');
  const a = block('https://a.example/sparql');
  const b = block('https://b.example/sparql');
  const first = schedule('https://a.example/sparql', 'count', undefined, async () => 'first', 'light');
  const second = schedule('https://b.example/sparql', 'facet', undefined, async () => 'second', 'light');
  assert.ok(events.some(e => e.position === 1 && e.server === 'https://a.example/sparql'));
  assert.ok(events.some(e => e.position === 2 && e.server === 'https://b.example/sparql'));
  release.forEach(done => done('done'));
  await Promise.all([a,b,first,second]);
});

test('existing proxy SSE stream forwards scheduler position changes to the browser without polling', async () => {
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/client-query-events.ts'), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports: {}};
  vm.runInNewContext(js, {
    exports: mod.exports, module: mod, require: name => {
      if (name.includes('maestro-query-execution-clock')) return {beginMaestroQueryExecution: () => () => {}};
      throw Error(name);
    }, TextDecoder, TextEncoder, Response, ReadableStream, Headers, DOMException, JSON, Set, Map,
  });
  const frames = [
    ['queued', {}], ['queue-position', {queryId: 0, queueIndex: 4, server: 'https://dbpedia.org/sparql'}],
    ['queue-position', {queryId: 0, queueIndex: 2, server: 'https://dbpedia.org/sparql'}],
    ['queue-position', {queryId: 0, queueIndex: 0, server: 'https://dbpedia.org/sparql'}],
    ['result', {status: 200, statusText: 'OK', headers: [['Content-Type', 'application/json']], body: '{"ok":true}'}],
  ].map(([event,data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const positions = [];
  const response = new Response(frames, {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}});
  const result = await mod.exports.unwrapMaestroQueryEvents(response, null, undefined,
    (position, server) => positions.push([position,server]));
  assert.deepEqual(positions.map(([position]) => position), [4,2,0]);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {ok: true});
});
