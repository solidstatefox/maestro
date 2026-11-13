/* Focused FCT regression: the view-bearing mui:widget relationship must
 * project its structural curator URI alongside the RDF-list blank node.
 * Run from the Maestro root: node tools/test-bnode-forward-parent.cjs
 * Uses an XMLParser fixture to isolate the query compiler from I/O.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'fast-xml-parser') return {
    XMLParser: class {
      parse(xml) {
        const view = xml.match(/<view\s+type="([^"]+)"/)?.[1] || 'list';
        const focus = { view: { '@_type': view, '@_limit': '30', '@_offset': '0' } };
        const nested = xml.includes('nested-path');
        const property = nested
          ? { '@_iri': 'urn:hasNested', property: { '@_iri': 'gttp://ggg.maestro.ecosys/ns/ui#widget', ...focus } }
          : { '@_iri': 'gttp://ggg.maestro.ecosys/ns/ui#widget', ...focus };
        return { query: {
          '@_addr': 'http://example.org/policies@http://example.org/sparql',
          class: { '@_iri': 'gttp://ggg.maestro.ecosys/ns/ui#CurationProvider' },
          property,
        } };
      }
    },
    XMLValidator: { validate: () => true },
  };
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.ts'] = function (mod, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  mod._compile(output, filename);
};

const translator = require(path.resolve(__dirname, '../src/lib/fct-sparql-translator.ts'));
const bnode = require(path.resolve(__dirname, '../src/lib/bnode.ts'));
const predicate = 'gttp://ggg.maestro.ecosys/ns/ui#widget';
for (const view of ['list', 'text']) {
  const xml = `<query><class/><property iri="${predicate}"><view type="${view}"/></property></query>`;
  const compiled = translator.compileFctXmlToSparql(xml);
  assert.equal(compiled.recordParent?.predicate, predicate);
  assert.equal(compiled.recordParent?.direction, 'forward');
  assert.match(compiled.query, /\(SAMPLE\(\?s1\) AS \?recordParent\)/);
  assert.match(compiled.query, /GROUP BY \?s2/);
  assert.match(compiled.query, /\?s1 <gttp:\/\/ggg\.maestro\.ecosys\/ns\/ui#widget> \?s2/);
}
// The eliminated `project` attribute must not affect structural relationship matching.
const deprecatedAttrRole = { localName: 'property-of', getAttribute: (name) => ({ iri: predicate, project: 'yes' })[name] ?? null };
const structuralRole = { localName: 'property-of', getAttribute: (name) => ({ iri: predicate })[name] ?? null };
assert.equal(bnode.isStructuralReverseRole(deprecatedAttrRole, predicate), true);
assert.equal(bnode.isStructuralReverseRole(structuralRole, predicate), true);

for (const view of ['list', 'text']) {
  const compiled = translator.compileFctXmlToSparql(`<query marker="nested-path"><property iri="urn:hasNested"><property iri="${predicate}"><view type="${view}"/></property></property></query>`);
  assert.deepEqual(compiled.recordAncestors?.map(x => [x.colName, x.depth]), [
    ['recordAncestor0', 0], ['recordParent', 1],
  ]);
  assert.match(compiled.query, /\(SAMPLE\(\?s1\) AS \?recordAncestor0\)/);
  assert.match(compiled.query, /\(SAMPLE\(\?s2\) AS \?recordParent\)/);
  assert.match(compiled.query, /GROUP BY \?s3/);
}
console.log('PASS: forward and nested URI ancestry projected with original FCT path; no deprecated project semantics');
