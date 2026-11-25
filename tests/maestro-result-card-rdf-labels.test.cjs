const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const route = fs.readFileSync('src/app/proxy/api/fct/route.ts', 'utf8');
const reader = fs.readFileSync('src/canvas/utils/fct-response.ts', 'utf8');
const renderer = fs.readFileSync('src/canvas/tab/browse/results-view.tsx', 'utf8');
const cache = fs.readFileSync('src/lib/client-query-cache.ts', 'utf8');

function resolverWithMock(response) {
  const start = route.indexOf('async function resolveFctLabels(');
  const end = route.indexOf('\ntype ExecutedSparql', start);
  assert.ok(start > 0 && end > start, 'extract actual route resolver');
  const snippet = `
    const VIRTRDF_LABEL = "http://www.openlinksw.com/schemas/virtrdf#label";
    function preferredLanguages(header) { return (header ?? '').split(',').filter(Boolean); }
    function labelLanguage(term) { return (term['xml:lang'] ?? '').toLowerCase(); }
    const parseResults = text => JSON.parse(text);
    const executeSparql = async (_endpoint, query) => {
      module.exports.query = query;
      return { response: { ok: true, status: 200 }, text: JSON.stringify(module.exports.response), key: 'fixture' };
    };
    const setQueryCache = () => {};
    const isVirtuosoAnytime = () => false;
    ${route.slice(start, end)}
    module.exports.resolve = resolveFctLabels;
  `;
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: { response } };
  new Function('module', 'exports', transpiled)(module, module.exports);
  return module.exports;
}

function binding(uri, label, predicate = 'http://www.w3.org/2000/01/rdf-schema#label') {
  return {
    s: { type: 'uri', value: uri },
    p: { type: 'uri', value: predicate },
    label: { type: 'literal', value: label, 'xml:lang': 'en' },
  };
}

const URI = 'http://data.europa.eu/s66/resource/projects/679f4f57-a048-35c5-b992-7ff301789d5a';

test('FCT resource labels resolve from the existing page without an endpoint-specific inference rule set', async () => {
  const testHarness = resolverWithMock({ head: { vars: ['s', 'p', 'label'] }, results: { bindings: [binding(URI, 'Project protein title')] } });
  const labels = await testHarness.resolve('https://cordis.europa.eu/datalab/sparql', [{ c1: { type: 'uri', value: URI } }], 'en', 10000);
  assert.equal(labels.get(URI), 'Project protein title');
  assert.doesNotMatch(testHarness.query, /DEFINE\s+input:inference/i);
  assert.match(testHarness.query, /VALUES \?s/);
  assert.match(testHarness.query, /VALUES \?p/);
  assert.ok(testHarness.query.includes(`<${URI}>`));
  assert.ok(testHarness.query.includes('<http://www.w3.org/2000/01/rdf-schema#label>'));
});

test('EURIO title is a fallback when rdfs:label is absent, but rdfs:label takes priority', async () => {
  const title = 'http://data.europa.eu/s66#title';
  const testHarness = resolverWithMock({ head: { vars: ['s', 'p', 'label'] }, results: { bindings: [binding(URI, 'Ontology title', title)] } });
  const rows = [{ c1: { type: 'uri', value: URI } }];
  assert.equal((await testHarness.resolve('endpoint', rows, 'en', 10000)).get(URI), 'Ontology title');
  testHarness.response.results.bindings.push(binding(URI, 'Preferred rdfs label'));
  assert.equal((await testHarness.resolve('endpoint', rows, 'en', 10000)).get(URI), 'Preferred rdfs label');
});

test('FCT text result parser and Browse card both honor the resolved c1 label attribute', () => {
  assert.match(reader, /first\.label\s*\|\|\s*labelColumn\?\.value/);
  assert.match(renderer, /item\.title\s*\|\|\s*\(item\.termType === "uri"/);
  assert.match(route, /fctColumn\(binding\[name\], labelFor\(binding\[name\]\), extraAttrs\)/);
});

test('new FCT response version invalidates server cache and browser IndexedDB without deleting user data', () => {
  assert.match(route, /fct-response-page-labels-v2/);
  assert.match(cache, /responseRevision = url\.includes\("\/proxy\/api\/fct"\)/);
  assert.match(cache, /fct-labels-v4/);
});
