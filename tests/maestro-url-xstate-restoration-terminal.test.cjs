const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(base, relative), 'utf8');
const controller = read('src/canvas/utils/workspace-controller.tsx');
const startup = read('src/lib/graph-server-startup.ts');
const operations = read('src/lib/app-lifecycle/operations.ts');
const hook = read('src/canvas/diagnostics/use-maestro-operations.ts');
const session = read('src/canvas/controllers/query-session.ts');
const workspace = read('src/canvas/workspace.tsx');

const start = controller.indexOf('  // URL startup is a two-stage synchronous conveyor');
const end = controller.indexOf('  // One authoritative serializer for the address bar', start);
const init = controller.slice(start, end);

test('URL loading is one synchronous q -> addr -> canonical commit conveyor', () => {
  assert(start >= 0 && end > start);
  assert.match(init, /const supplied = params\.get\("q"\)/);
  assert.match(init, /supplied\?\.trim\(\) \? parseFctQueryXml\(supplied\) : createBlankStartupQuery\(\)/);
  assert.match(init, /const explicitServer =/);
  assert.match(init, /if \(!explicitServer\)/);
  assert.match(init, /chooseStartupGraphServer\(/);
  assert.match(init, /prepareInitialFctQuery\(parsed, selected\.url\)/);
  assert.match(init, /restoreQueryAndUiState\(initialXml, initialUiState, params\.get\("history"\), true\)/);
  assert.match(init, /setUrlStateInitialized\(true\)/);
  assert.doesNotMatch(init, /await\s|initializeMaestroStorage\(|authRestoreComplete|setSelectedEndpointId\(|history\.replaceState|setTimeout\(/);
  assert.match(init, /\}, \[\]\);/);
});

test('URL startup is independent of personal-server seeding and preserves q with explicit addr', () => {
  assert.match(init, /let prepared = parsed;/);
  assert.match(init, /if \(!explicitServer\) \{/);
  assert.match(init, /if \(selected\.addedDefault\) collectSharedGraphServer\(selected\.url\)/);
  assert.doesNotMatch(init, /listPersonalGraphServers\(|ensureLoggedInPersonalServer\(|await\s|setSelectedEndpointId\(/);
  assert.match(controller, /useLayoutEffect\(\(\) => \{ observeGraphServerQuery\(authoritativeServerUrl\); \}, \[authoritativeServerUrl, observeGraphServerQuery\]\)/);
});

test('the URL has a terminal state for malformed nonempty q or failed query commit', () => {
  assert.match(init, /if \(!parsed\) throw new Error\(/);
  assert.match(init, /setUrlRestoreError\(message\)/);
  assert.match(operations, /type: "QUERY_RESTORE_FAILED"/);
  assert.match(operations, /restoreFailed: \{\}/);
  assert.match(hook, /controller\.send\(\{ type: "QUERY_RESTORE_FAILED"/);
  assert.match(session, /urlRestoreError,\s*setUrlRestoreError/);
  assert.match(workspace, /!urlStateInitialized && urlRestoreError/);
  assert.match(workspace, /window\.location\.reload\(\)/);
});

test('blank query contains no addr; only missing server gets filled; valid explicit addr survives', () => {
  const module = { exports: {} };
  const directory = { groups: { Shared: [] } };
  const util = {
    validGraphServerUrl(value) { try { const u = new URL(value.trim()); return ['https:', 'http:'].includes(u.protocol) && !u.hash && !u.password && !u.username ? u.toString() : null; } catch { return null; } },
    flattenGraphServerDirectory(dir) { return Object.entries(dir.groups).flatMap(([group, rows]) => rows.map(x => ({ ...x, group }))); },
  };
  const sandbox = { module, exports: module.exports, URL, require(name) {
    if (name === '@/lib/graph-address-mode') return { ALL_GRAPHS: '$ALL$' };
    if (name === '@/lib/graph-server-health') return { graphServerUrlMatches: (a, b) => a === b };
    if (name === '@/lib/graph-server-directory') return util;
    if (name === '@/lib/maestro-storage') return { maestroStorageGet: () => null, maestroStorageSet: () => {} };
    return {};
  } };
  const compiled = ts.transpileModule(startup, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }}).outputText;
  vm.runInNewContext(compiled, sandbox);
  const api = sandbox.module.exports;
  const blank = api.createBlankStartupQuery();
  assert.equal(blank.name, 'query');
  assert.equal(Object.prototype.hasOwnProperty.call(blank.attributes, 'addr'), false);
  assert(blank.children.some(n => n.name === 'view'));
  assert.equal(api.chooseStartupGraphServer({ preferredUrl: '', personalEndpoints: [], directory }).url, 'https://dbpedia.org/sparql');
  const address = '$ALL$@https://cordis.europa.eu/datalab/sparql';
  const complex = { ...blank, attributes: { ...blank.attributes, addr: address }, children: [...blank.children, { name: 'class', id: 'a3', attributes: { iri: 'urn:test' }, children: [] }] };
  assert.equal(api.prepareInitialFctQuery(complex, 'https://dbpedia.org/sparql'), complex);
  const partial = { ...complex, attributes: { ...complex.attributes, addr: '$ALL$@' } };
  const repaired = api.prepareInitialFctQuery(partial, 'https://dbpedia.org/sparql');
  assert.equal(repaired.attributes.addr, '$ALL$@https://dbpedia.org/sparql');
  assert.strictEqual(repaired.children, partial.children);
  assert.equal(api.prepareInitialFctQuery(blank, 'https://dbpedia.org/sparql').attributes.addr, '$ALL$@https://dbpedia.org/sparql');
  const configured = { groups: { Personal: [{ id: 'personal', url: 'https://alice.example/sparql', label: 'Alice' }] } };
  assert.equal(api.chooseStartupGraphServer({ preferredUrl: '', personalEndpoints: [], directory: configured }).url, 'https://alice.example/sparql');
});

test('all modified TypeScript and TSX files have valid syntax', () => {
  for (const file of [
    'src/lib/graph-server-startup.ts', 'src/canvas/utils/workspace-controller.tsx',
    'src/canvas/controllers/query-session.ts', 'src/lib/app-lifecycle/operations.ts',
    'src/canvas/diagnostics/use-maestro-operations.ts', 'src/canvas/workspace.tsx',
  ]) {
    const content = read(file);
    const syntax = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(syntax.parseDiagnostics.length, 0, `${file}: ${syntax.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))}`);
  }
});
