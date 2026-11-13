/** Regression tests for the shared blank-node API. Run from Maestro root:
 * node tools/test-bnode-api.cjs
 * Requires the project's existing TypeScript dependency only.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const filename = path.resolve(process.cwd(), 'src/lib/bnode.ts');
const input = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(input, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
const sandbox = { exports: moduleExports, require, JSON, Map, Error, RegExp, String, Boolean, Array, Object };
vm.runInNewContext(compiled, sandbox, { filename });
const api = moduleExports;

const role = (project) => ({ localName: 'property-of', getAttribute(name) {
  return name === 'iri' ? 'urn:parent' : name === 'project' ? project : null;
}});
assert.equal(api.isStructuralReverseRole(role(null), 'urn:parent'), true);
assert.equal(api.isStructuralReverseRole(role('yes'), 'urn:parent'), false, '87f3eff: projected role must not anchor blank node');
assert.equal(api.isStructuralReverseRole(role('no'), 'urn:parent'), true);
assert.equal(api.isStructuralReverseRole(role(null), 'urn:other'), false);
assert.equal(api.isBlankNodeLabel('_:b1'), true);
assert.equal(api.isBlankNodeLabel('nodeID://b1'), true);
assert.equal(api.isBlankNodeLabel('https://example.org/b1'), false);
assert.equal(api.rdfBindingKind('bnode'), 'bnode');
assert.equal(api.rdfBindingKind('uri'), 'uri');
assert.equal(api.rdfBindingKind('literal'), 'literal');
assert.equal(api.blankNodeDisplayLabel('b1'), '_:b1');
assert.equal(api.blankNodeDisplayLabel('_:b1'), '_:b1');

const scope = [
  { direction: 'reverse', property: 'urn:other', values: [{ type: 'uri', value: 'urn:wrong' }] },
  { direction: 'reverse', property: 'urn:parent', values: [{ type: 'uri', value: 'urn:correct' }] },
];
const anchor = api.resolveBlankNodeAnchor('bnode', scope, 'urn:parent');
assert.equal(anchor.parent, 'urn:correct');
assert.equal(anchor.predicate, 'urn:parent');
assert.equal(api.resolveBlankNodeAnchor('uri', scope, 'urn:parent'), null);
assert.equal(api.resolveBlankNodeAnchor('bnode', scope, 'urn:missing'), null);
assert.notEqual(
  api.blankNodeContextKey({ queryXml: '<query/>', graphAddress: 'urn:graph:a', parent: 'urn:correct', predicate: 'urn:parent' }),
  api.blankNodeContextKey({ queryXml: '<query/>', graphAddress: 'urn:graph:b', parent: 'urn:correct', predicate: 'urn:parent' }),
);
const allocate = api.createBlankNodeLabelAllocator('sh');
assert.equal(allocate('_:a-b'), 'sh0');
assert.equal(allocate('a-b'), 'sh0');
assert.equal(allocate('a_b'), 'sh1', 'punctuation-normalization collisions must not occur');
assert.equal(allocate('ü'), 'sh2', 'generated identifiers must remain SPARQL-safe');

const compiledSelect = 'DEFINE input:inference "facets"\nSELECT DISTINCT ?c1 WHERE { ?c1 <urn:p> ?b . } LIMIT 5';
const q = api.buildBlankNodeRecordSparql({ compiledSelect, graphs: ['urn:g'], preferredLanguage: 'en', limit: 50 });
assert.match(q, /^DEFINE input:inference "facets"\nSELECT \?node/);
assert.match(q, /BIND\(\?c1 AS \?node\)/);
assert.match(q, /FILTER\(isBlank\(\?node\)\)/);
assert.match(q, /GRAPH \?recordGraph \{ \?node \?predicate \?object/);
assert.match(q, /GRAPH \?recordGraph \{ \?object \?predicate \?node/);
assert.match(q, /LANGMATCHES\(LANG\(\?object\), "en"\)/);
assert.match(q, /LIMIT 50$/);
const local = api.buildBlankNodeRecordSparql({ compiledSelect, graphs: [], preferredLanguage: 'all', limit: 50 });
assert.doesNotMatch(local, /GRAPH \?recordGraph/);
assert.match(local, /FILTER\(true\)/);
assert.throws(() => api.buildBlankNodeRecordSparql({ compiledSelect: 'DESCRIBE ?c1', graphs: [], preferredLanguage: 'en', limit: 50 }));

const records = api.parseBlankNodeRecordBindings([
  { node: { type: 'bnode', value: 'b1' }, predicate: { type: 'uri', value: 'urn:label' }, object: { type: 'literal', value: 'A & B', 'xml:lang': 'en' }, direction: { type: 'literal', value: 'property' } },
  { node: { type: 'bnode', value: 'b1' }, predicate: { type: 'uri', value: 'urn:label' }, object: { type: 'literal', value: 'A & B', 'xml:lang': 'en' }, direction: { type: 'literal', value: 'property' } },
  { node: { type: 'bnode', value: 'b1' }, predicate: { type: 'uri', value: 'urn:reverse' }, object: { type: 'uri', value: 'urn:parent' }, direction: { type: 'literal', value: 'property-of' } },
  { node: { type: 'bnode', value: 'b2' } },
], false);
assert.equal(records.length, 2);
assert.equal(records[0].id, '_:b1');
assert.equal(records[0].rows.length, 2);
assert.equal(records[0].rows[1].direction, 'property-of');
assert.match(records[0].xml, /A &amp; B/);
assert.equal(records[1].id, '_:b2');
assert.equal(records[1].rows.length, 0, 'preserve sibling tabs with no eligible triples');
console.log('BNode API regression checks passed.');

// Exercise the extracted DOM query builder with a minimal DOM model. This
// verifies selection, not XML parser behavior (the browser owns DOMParser).
class FakeElement {
  constructor(localName, attributes = {}) {
    this.localName = localName;
    this.attrs = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.textContent = '';
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  get firstChild() { return this.children[0] ?? null; }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentElement = null; }
  toXml() {
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${this.localName}${attrs}>${this.textContent}${this.children.map((child) => child.toXml()).join('')}</${this.localName}>`;
  }
}
const fctRoot = new FakeElement('query', { addr: 'urn:graph@https://example.org/sparql' });
const carrier = fctRoot.appendChild(new FakeElement('property', { iri: 'urn:child' }));
const projected = carrier.appendChild(new FakeElement('property-of', { iri: 'urn:parent', project: 'yes' }));
const structural = carrier.appendChild(new FakeElement('property-of', { iri: 'urn:parent' }));
const mainView = carrier.appendChild(new FakeElement('view', { type: 'list', badges: 'yes' }));
const fakeDoc = {
  documentElement: fctRoot,
  querySelector: () => null,
  getElementsByTagNameNS: (_ns, local) => local === 'view' ? [mainView] : [],
  createElementNS: (_ns, name) => new FakeElement(name),
};
const domExports = {};
const domFilename = path.resolve(process.cwd(), 'src/lib/bnode-dom.ts');
const domJs = ts.transpileModule(fs.readFileSync(domFilename, 'utf8'), {
  fileName: domFilename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const domSandbox = {
  exports: domExports,
  DOMParser: class { parseFromString() { return fakeDoc; } },
  XMLSerializer: class { serializeToString(doc) { return doc.documentElement.toXml(); } },
  require: (name) => name === '@/lib/bnode' ? api : name === '@/lib/fct-view-types'
    ? { FCT_VIEW_TYPES: { LIST_VALUES: 'list-values' } } : require(name),
};
vm.runInNewContext(domJs, domSandbox, { filename: domFilename });
const rebound = domExports.blankNodeRecordListValuesQuery('<query/>', 'urn:parent', 'urn:correct', 22);
assert.equal(projected.children.length, 0, 'must ignore projected reverse role');
assert.equal(structural.children.length, 1, 'must bind actual structural reverse role');
assert.equal(structural.children[0].getAttribute('datatype'), 'uri');
assert.equal(structural.children[0].textContent, 'urn:correct');
assert.equal(mainView.getAttribute('type'), 'list-values');
assert.equal(mainView.getAttribute('limit'), '22');
assert.equal(mainView.getAttribute('badges'), null);
assert.match(rebound, /addr="urn:graph@https:\/\/example.org\/sparql"/, 'must preserve graph provenance');
console.log('Blank-node FCT query-builder regression checks passed.');

// Imported RDF must retain b-node equality without merging distinct nodes
// whose labels would collide after punctuation replacement.
const rdfExports = {};
const rdfFilename = path.resolve(process.cwd(), 'src/lib/rdf-to-sparql.ts');
const rdfJs = ts.transpileModule(fs.readFileSync(rdfFilename, 'utf8'), {
  fileName: rdfFilename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(rdfJs, {
  exports: rdfExports, Buffer,
  require: (name) => name === '@/lib/bnode' ? api : require(name),
}, { filename: rdfFilename });
const iriTerm = (value) => ({ termType: 'NamedNode', value });
const bnodeTerm = (value) => ({ termType: 'BlankNode', value });
const rdfInsert = rdfExports.buildInsertData('urn:graph', [
  { subject: bnodeTerm('a-b'), predicate: iriTerm('urn:p'), object: bnodeTerm('a_b') },
  { subject: bnodeTerm('a-b'), predicate: iriTerm('urn:q'), object: iriTerm('urn:o') },
]);
assert.match(rdfInsert, /_:m0 <urn:p> _:m1/);
assert.match(rdfInsert, /_:m0 <urn:q> <urn:o>/);
console.log('RDF import blank-node collision checks passed.');
