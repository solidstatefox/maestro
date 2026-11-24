const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

test('courtesy discovery consumes the actual graphs manifest destination', () => {
  const manifest = JSON.parse(read('graph/manifest.json'));
  const graphConstants = read('src/lib/constants/graphs.ts');
  const implementation = read('src/lib/personal-sparql.ts');
  assert.equal(manifest['dataserver-seed.ttl'], 'graphs');
  assert.match(graphConstants, /GRAPHS\s*:\s*["']graphs["']/);
  assert.match(implementation, /dest\s*===\s*GRAPH\.GRAPHS\s*&&\s*\/\\\.\(\?:ttl\|n3\)/);
  assert.doesNotMatch(implementation, /dest\s*===\s*["']\/graph["']/);
  const sources = Object.entries(manifest)
    .filter(([file, dest]) => dest === 'graphs' && /\.(ttl|n3)$/i.test(file));
  assert.ok(sources.some(([file]) => file === 'dataserver-seed.ttl'));
  assert.match(read('graph/dataserver-seed.ttl'), /EntryPoint/);
  for (const [file] of sources) assert.ok(fs.statSync('graph/' + file).size > 0, file);
});

test('hydrated server menu exposes courtesy failure and retry without hiding Shared', () => {
  const ui = read('src/canvas/top/appbar-pane.tsx');
  assert.match(ui, /endpointMenuError && <div role="alert"/);
  assert.match(ui, /Retry courtesy discovery/);
  assert.match(ui, /Saved Shared servers remain usable/);
  assert.match(ui, /disabled=\{fctEndpoints\.length === 0 && !endpointMenuError\}/);
  const lifecycle = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(lifecycle, /if\(stored\.courtesyDigest && hasCourtesy\)/);
  assert.match(lifecycle, /for\(let attempt=0;attempt<2/);
  assert.match(lifecycle, /replaceCourtesyGraphServers\(data\.digest,data\.endpoints\)/);
});
