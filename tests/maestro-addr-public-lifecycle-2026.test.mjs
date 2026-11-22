import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(name, 'utf8');
const w=read('src/canvas/utils/workspace-controller.tsx');
const registry=read('src/lib/personal-sparql.ts');
const fct=read('src/app/proxy/api/fct/route.ts');
const sparql=read('src/app/proxy/api/sparql/route.ts');
const manifest=JSON.parse(read('graph/manifest.json'));

test('the courtesy feed includes CORDIS and uses a stable content digest', () => {
  assert.equal(manifest['dataserver-seed.ttl'],'graphs');
  assert.equal(Object.hasOwn(manifest, 'eu-data/endpoints.ttl'), false);
  const courtesy = read('graph/dataserver-seed.ttl');
  assert.match(courtesy, /https:\/\/cordis\.europa\.eu\/datalab\/sparql/);
  assert.match(courtesy, /https:\/\/data\.europa\.eu\/data\/sparql/);
  assert.match(registry,/getCourtesyGraphServerDigest/);
  assert.match(registry,/for \(const \{file,content\} of sources\) hasher\.update/);
  assert.match(read("src/app/proxy/api/service/route.ts"),/getCourtesyGraphServerDigest/);
});

test('explicit public and Shared query servers never require registry membership or a personal store', () => {
  assert.match(registry,/return configured \? \{ \.\.\.configured, url: server \}/);
  assert.match(registry,/group: "Shared"/);
  assert.match(fct,/const endpoint = \{ url: serverAddress \}/);
  assert.doesNotMatch(fct,/The graph server in query addr is not configured/);
  assert.match(sparql,/resolveFctEndpointFromAddr\(\[\], explicitAddr\)/);
  assert.doesNotMatch(sparql,/const endpointList = await getConfiguredFctEndpoints/);
});

test('the browser persists its own Shared group and refreshes only changed courtesy lists', () => {
  const dir=read('src/lib/graph-server-directory.ts');
  const graph=read('src/canvas/controllers/graph-servers.ts');
  assert.match(dir,/groups: Record<string, EndpointOption\[\]>/);
  assert.match(dir,/Shared: \[\]/);
  assert.match(dir,/const previous = readGraphServerDirectory\(\)/);
  assert.match(graph,/collectSharedGraphServer\(normalized\)/);
  assert.match(w,/if \(cancelled \|\| version\.changed === false\) return/);
  assert.match(w,/replaceCourtesyGraphServers\(data\.digest, data\.endpoints\)/);
  assert.doesNotMatch(w,/authRestoreComplete && fctEndpoints\.length/);
});

test('XState observes addr; menu selection only commits addr', () => {
  assert.match(w,/observeGraphServerQuery\(authoritativeServerUrl\)/);
  assert.match(w,/const operationGraphKey = queryGraphServer \?\? ""/);
  assert.match(w,/setQueryAttribute\("addr", `\$\{graph\}@\$\{endpoint\.url\}`\)/);
  const choose=w.slice(w.indexOf('async function chooseFctEndpoint('), w.indexOf('// Personal View widgets subscribe'));
  assert.doesNotMatch(choose,/setSelectedEndpointId\(/);
  const history=w.slice(w.indexOf('async function synchronizeFctEndpointSelection('),w.indexOf('async function chooseFctEndpoint('));
  assert.doesNotMatch(history,/setSelectedEndpointId\(/);
});
