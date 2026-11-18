/** Executable regression for RDF-term DISTINCT semantics used by Country,
 * Language, Role facets and Tag Cloud. Only these pure functions are compiled:
 * the browser's DOM/React modules are deliberately not loaded in Node. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
let ts;
try { ts = require('typescript'); } catch { /* npm install is required for these executable tests. */ }
function loadPureFns() {
  const code = readFileSync(require('node:path').join(__dirname, '../src/canvas/utils/fct-response.ts'), 'utf8');
  const file = ts.createSourceFile('fct-response.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const methods = ['fctTermKey', 'groupValueBinding', 'facetValueKey', 'distinctFacetValues'];
  const selected = file.statements.filter(node => ts.isFunctionDeclaration(node) && methods.includes(node.name?.text));
  assert.equal(selected.length, methods.length);
  const selectedCode = selected.map(node => node.getText(file)).join('\n');
  const js = ts.transpileModule(selectedCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = { exports: {} }; vm.runInNewContext(js, context);
  return context.exports;
}
const literal = (uri, datatype, lang, title) => ({ uri, termType: 'literal', ...(datatype ? { datatype } : {}), ...(lang ? { lang } : {}), title: title || uri, matches: [], columns: [{ value: uri }, { value: '35' }] });
const uri = (uri) => ({ uri, termType: 'uri', title: uri, matches: [] });

test('Country, Language and TagCloud collapse duplicate identical RDF terms, never summing counts', { skip: !ts }, () => {
  const { distinctFacetValues } = loadPureFns();
  const list = [uri('http://dbpedia.org/resource/Scotland'),uri('http://dbpedia.org/resource/Scotland'),
    literal('en','string'),literal('en','string'),literal('en','string')];
  const result = distinctFacetValues(list);
  assert.equal(result.length, 2);
  assert.equal(result[0].uri, 'http://dbpedia.org/resource/Scotland');
  assert.equal(result[1].columns[1].value, '35', 'Do not sum duplicate grouped counts');
});

test('RDF term distinctness preserves language, URI/literal and numeric datatype', { skip: !ts }, () => {
  const { distinctFacetValues, facetValueKey, fctTermKey } = loadPureFns();
  const values = [literal('color',undefined,'en'),literal('color',undefined,'EN'),literal('color',undefined,'fr'),
    literal('color','string'),literal('color','http://www.w3.org/2001/XMLSchema#string'),
    literal('1','http://www.w3.org/2001/XMLSchema#int'),literal('1','string'),uri('color')];
  const result = distinctFacetValues(values);
  assert.equal(result.length, 6);
  assert.notEqual(facetValueKey(values[0]), facetValueKey(values[2]));
  assert.equal(facetValueKey(values[0]), facetValueKey(values[1]));
  assert.equal(facetValueKey(values[3]), facetValueKey(values[4]));
  assert.equal(fctTermKey('color', 'string'), facetValueKey(values[3]));
  assert.notEqual(facetValueKey(values[3]), facetValueKey(values[7]));
});

test('rdf:langString and implicit language-tagged FCT literals are one RDF term', { skip: !ts }, () => {
  const { distinctFacetValues, facetValueKey, fctTermKey } = loadPureFns();
  const langString = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
  const a = literal('fr', undefined, 'EN');
  const b = literal('fr', langString, 'en');
  assert.equal(facetValueKey(a), facetValueKey(b));
  assert.equal(fctTermKey('fr', langString, 'en'), fctTermKey('fr', undefined, 'en'));
  assert.equal(distinctFacetValues([a,b]).length, 1);
  assert.notEqual(facetValueKey(b), facetValueKey(literal('fr', undefined, 'fr')));
});

test('First-seen value order is stable, a later legitimate display label can be used', { skip: !ts }, () => {
  const { distinctFacetValues } = loadPureFns();
  const first = uri('urn:example:A'), second = uri('urn:example:B');
  const rows = distinctFacetValues([first,second,{ ...first, title: 'Named A' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Named A');
  assert.equal(rows[1].uri, second.uri);
});

test('Breadcrumb receives bound value nodes, not a boolean', () => {
  const code = readFileSync(require('node:path').join(__dirname, '../src/canvas/top/breadcrumb-renderers.tsx'), 'utf8');
  assert.match(code, /renderBreadcrumbMenuHeader\(summary,[\s\S]{0,250}breadcrumbBoundValues\)/);
  assert.doesNotMatch(code, /renderBreadcrumbMenuHeader\(summary,[\s\S]{0,250}breadcrumbBoundValues\.length > 0\)/);
});
