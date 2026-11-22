const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Alphabet makes one XML FCT request, not ASK + 26 scalar counts', () => {
  const host = read('src/canvas/utils/workspace-controller.tsx');
  const center = read('src/canvas/center/pane.tsx');
  const alphabet = host.slice(host.indexOf('  // A single grouped FCT alphabet request'), host.indexOf("  useEffect(() => {\n    // Keep the view's persisted index"));
  assert.match(alphabet, /body: alphabetQueryXml/);
  assert.match(alphabet, /FCT_VIEW_TYPES\.ALPHABET/);
  assert.match(alphabet, /readFctResponse\(response\)/);
  assert.doesNotMatch(alphabet, /Promise\.all|countLetter\(|alphabetCountQueryForLetter|alphabetAskQueryXml/);
  assert.match(center, /clockScope="alphabet" requestWaves=\{1\}/);
  const translator = read('src/lib/fct-sparql-translator.ts');
  const grouped = translator.slice(translator.indexOf('} else if (view === FCT_VIEW_TYPES.ALPHABET)'), translator.indexOf('} else if (view === FCT_VIEW_TYPES.YEARS'));
  assert.match(grouped, /name: "UCASE"/);
  assert.match(grouped, /name: "SUBSTR"/);
  assert.match(grouped, /kind: "bind", expression: firstUpper, as: letter/);
  assert.match(grouped, /groupBy: \[termExpr\(letter\)\]/);
  assert.match(grouped, /distinct: true, expression: termExpr\(target\)/);
});

function loadScheduler() {
  const source = read('src/lib/graph-server-query-scheduler.ts');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const events = new Map();
  let nextId = 0;
  const mod = {exports: {}};
  vm.runInNewContext(js, {
    exports: mod.exports, module: mod,
    require(name) {
      if (name.endsWith('maestro-proxy-client-preferences')) return {
        currentProxyClient: () => 'test',
        getProxyClientPreferences: () => ({lightPerServer: 2, heavyPerServer: 2}),
      };
      if (name.endsWith('proxy-query-events')) return {
        proxyQueuePositionNotifier: () => {
          const id = ++nextId;
          events.set(id, []);
          return (...args) => events.get(id).push(args);
        },
      };
      throw Error(`Unexpected import ${name}`);
    },
    DOMException, AbortController, Headers, URL, Promise, Map, Set,
  }, {filename: 'graph-server-query-scheduler.js'});
  return {schedule: mod.exports.scheduleMaestroQuery, events};
}

test('queue addresses are numbered by configured lanes and local item positions', async () => {
  const {schedule, events} = loadScheduler();
  const runningResolvers = [];
  const running = [0, 1].map(() => schedule('https://example.org/sparql', 'interactive', undefined,
    () => new Promise(resolve => runningResolvers.push(resolve)), 'heavy'));
  assert.equal(runningResolvers.length, 2);
  const queuedSignals = Array.from({length: 5}, () => new AbortController());
  const queued = queuedSignals.map(signal => schedule('https://example.org/sparql', 'count', signal.signal, async () => 'work', 'heavy'));
  // Each queued job has a stable registration ID. IDs 1 and 2 are running.
  for (let ordinal = 1; ordinal <= 5; ordinal++) {
    const last = events.get(ordinal + 2).filter(e => e[0] > 0).at(-1);
    assert.ok(last, `queued job ${ordinal} received position`);
    const [globalIndex, server, weight, categoryIndex, lane, laneItem] = last;
    assert.equal(globalIndex, ordinal);
    assert.equal(server, 'https://example.org/sparql');
    assert.equal(weight, 'heavy');
    assert.equal(categoryIndex, ordinal);
    assert.equal(lane, (ordinal - 1) % 2 + 1);
    assert.equal(laneItem, Math.floor((ordinal - 1) / 2) + 1);
  }
  queuedSignals.forEach(controller => controller.abort());
  await Promise.all(queued.map(promise => assert.rejects(promise, /canceled/i)));
  runningResolvers.forEach(resolve => resolve('complete'));
  assert.deepEqual(await Promise.all(running), ['complete', 'complete']);
});

test('queue SSE carries projected lane numbers all the way to Refresh tooltip', () => {
  const scheduler = read('src/lib/graph-server-query-scheduler.ts');
  const sink = read('src/lib/proxy-query-events.ts');
  const sub = read('src/lib/client-query-events.ts');
  const cache = read('src/lib/client-query-cache.ts');
  const appbar = read('src/canvas/top/appbar-pane.tsx');
  assert.match(scheduler, /task\.queuePosition\?\.\(index, server, lane, laneIndex, laneNumber, lanePosition\)/);
  assert.match(sink, /laneNumber, lanePosition \}\)/);
  assert.match(sub, /data\.laneNumber/);
  assert.match(cache, /serverQueueLaneNumber: laneNumber, serverQueueLanePosition: lanePosition/);
  assert.match(cache, /item\.serverQueueLaneNumber === b\[index\]\.serverQueueLaneNumber/);
  assert.match(appbar, /`\$\{lane\}\$\{query\.serverQueueLaneNumber\}:\$\{query\.serverQueueLanePosition\} · \$\{query\.serverQueueLane\}`/);
});
