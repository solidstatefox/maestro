const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
function loadTs(file, dependencies, extra = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports,
    require: key => { if (!(key in dependencies)) throw Error(`Unexpected import: ${key}`); return dependencies[key]; },
    URL, encodeURIComponent, console, process, Set, Map, JSON, Error, Object, Number, String, Array, TextEncoder, ...extra }, { filename: file });
  return module.exports;
}

test('Shared servers persist when the proxy courtesy list digest changes, with grouped schema', () => {
  const memory = new Map();
  const dir = loadTs('src/lib/graph-server-directory.ts', {
    '@/lib/maestro-storage': {
      maestroStorageGet: key => memory.get(key) ?? null,
      maestroStorageSet: (key, value) => memory.set(key, value),
    },
  });
  const cordis = 'https://cordis.europa.eu/datalab/sparql';
  const own = 'https://example.org/sparql';
  dir.collectSharedGraphServer(cordis);
  dir.collectSharedGraphServer(own);
  dir.collectSharedGraphServer(cordis);
  const d1 = 'sha256:' + 'a'.repeat(64), d2 = 'sha256:' + 'b'.repeat(64);
  dir.replaceCourtesyGraphServers(d1, [{ id:'dbpedia', label:'DBpedia', url:'https://dbpedia.org/sparql', group:'Public' }]);
  const next = dir.replaceCourtesyGraphServers(d2, [{ id:'europe', label:'EU', url:'https://data.europa.eu/sparql', group:'European' }]);
  assert.equal(next.courtesyDigest, d2);
  assert.equal(next.groups.Shared.length, 2);
  assert.equal(next.groups.Shared[0].url, cordis);
  assert.equal(next.groups.Public, undefined);
  assert.equal(next.groups.European.length, 1);
  const list = dir.flattenGraphServerDirectory(next);
  assert.equal(list[0].group, 'Shared');
  assert.equal(list[1].group, 'Shared');
  assert.equal(list[2].group, 'European');
  assert.equal(JSON.parse(memory.get(dir.GRAPH_SERVER_DIRECTORY_KEY)).groups.Shared.length, 2);
});

test('an explicitly addressed unlisted server resolves as Shared rather than falling back', () => {
  const actor = loadTs('src/lib/app-lifecycle/graph-server-selection-actor.ts', {
    xstate: { assign: x => x, createActor: () => ({}), setup: () => ({createMachine: () => ({})}) },
    '@/lib/graph-server-health': { graphServerUrlMatches: (a,b) => a === b },
  });
  const cordis = 'https://cordis.europa.eu/datalab/sparql';
  const publicEndpoint = { id:'dbpedia',url:'https://dbpedia.org/sparql',group:'Public' };
  assert.equal(actor.resolveGraphServerId([publicEndpoint],cordis,''), `shared:${encodeURIComponent(cordis)}`);
  assert.equal(actor.resolveGraphServerId([publicEndpoint],'',publicEndpoint.url),'dbpedia');
  assert.equal(actor.resolveGraphServerId([publicEndpoint],publicEndpoint.url,cordis),'dbpedia');
});

test('read-only FCT and SPARQL proxy dispatch use addr, not registered membership or session', () => {
  const fct=read('src/app/proxy/api/fct/route.ts');
  const sparql=read('src/app/proxy/api/sparql/route.ts');
  assert.match(fct,/const serverAddress = normalizeGraphServerUri\(address\.slice\(delimiter \+ 1\)/);
  assert.match(fct,/if \(!permittedGraphServerTarget\(serverAddress\)\)/);
  assert.doesNotMatch(fct,/The graph server in query addr is not configured/);
  assert.match(sparql,/resolveFctEndpointFromAddr\(\[\], explicitAddr\)/);
  assert.doesNotMatch(sparql,/const endpointList = await getConfiguredFctEndpoints\(request\)/);
  assert.match(sparql,/if \(!permittedGraphServerTarget\(server\)\)/);
});

test('courtesy digest handshake only downloads list on a change and is independent of authentication', () => {
  const host=read('src/canvas/utils/workspace-controller.tsx');
  const proxy=read('src/app/proxy/api/fct/route.ts');
  const registry=read('src/lib/personal-sparql.ts');
  assert.match(host,/operationId:"courtesyGraphServers"/);
  assert.match(host,/version\?\.changed===false && hasCourtesy/);
  assert.match(host,/replaceCourtesyGraphServers\(data\.digest,data\.endpoints\)/);
  const service=read('src/app/proxy/api/service/route.ts');
  assert.match(service,/getCourtesyGraphServerDigest/);
  assert.match(service,/changed:digest!==current/);
  assert.doesNotMatch(proxy,/graphServerDigest/);
  assert.match(registry,/for \(const \{file,content\} of sources\) hasher\.update/);
  assert.doesNotMatch(registry,/getConfiguredFctEndpoints\(request\?: Request\)[\s\S]*?queryPersonalSparql\(query/);
  assert.match(host,/const graphRegistryReady = Boolean\(/);
  assert.doesNotMatch(host,/const graphRegistryReady = authRestoreComplete/);
});

test('provider seeding never clears browser-owned Shared or imports the courtesy flatfile', () => {
  const seed=read('src/lib/client-graph-seed.ts');
  assert.match(seed,/"dataserver-seed.ttl","eu-data\/endpoints.ttl"/);
  assert.doesNotMatch(seed,/entry\.file === "dataserver-seed\.ttl"/);
  assert.match(seed,/destinationSeedDigest\(/);
});

test('the proxy rejects local/metadata targets in production but permits public URLs', () => {
  const source=read('src/lib/graph-server-target.ts');
  assert.match(source,/lookup\(hostname, \{ all: true \}\)/);
  const guard=loadTs('src/lib/graph-server-target.ts', {
    'node:net': require('node:net'),
    'node:dns/promises': { lookup: async () => [{address:'93.184.215.14',family:4}] },
  }, { process: {env:{ NODE_ENV:'production' }} });
  assert.equal(guard.permittedGraphServerTarget('https://cordis.europa.eu/datalab/sparql'),true);
  for (const url of ['http://127.0.0.1/sparql','http://192.168.1.1/sparql','http://169.254.169.254/latest/meta-data','ftp://example.com/sparql','http://user:pass@example.com/sparql']) {
    assert.equal(guard.permittedGraphServerTarget(url),false,url);
  }
});

test('all changed TS and TSX parse without syntax errors', () => {
  for (const file of [
    'src/lib/graph-server-directory.ts','src/lib/graph-server-target.ts','src/lib/personal-sparql.ts',
    'src/lib/client-graph-seed.ts','src/lib/app-lifecycle/graph-server-selection-actor.ts',
    'src/canvas/controllers/graph-servers.ts','src/canvas/utils/workspace-controller.tsx',
    'src/app/proxy/api/fct/route.ts','src/app/proxy/api/sparql/route.ts',
  ]) {
    const src=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(src.parseDiagnostics.length,0,file + ': ' + src.parseDiagnostics.map(x => x.messageText).join(','));
  }
});
