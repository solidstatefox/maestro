/** Bounded DESCRIBE translation regression checks. Run: node tools/test-fct-bnode-describe.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');

const bundle = (relative, deps = {}) => {
  const filename = path.resolve(process.cwd(),relative);
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},fileName:filename,
  }).outputText;
  const exports = {};
  const req = name => (name in deps ? deps[name] : require(name));
  vm.runInNewContext(code, {exports, require:req, console}, {filename});
  return exports;
};
const bnode = bundle('src/lib/bnode.ts');
assert.equal(bnode.bnodeDescribeBounds({expand:'bnodes',limit:'5000',depth:'5',incoming:'yes'}).maxTriples, 5000);
assert.equal(bnode.bnodeDescribeBounds({expand:'bnodes',limit:'5000',depth:'5',incoming:'yes'}).incoming, true);
assert.equal(bnode.bnodeDescribeBounds({}), null);
for(const attrs of [
  {expand:'other'}, {expand:'bnodes',limit:'5001'}, {expand:'bnodes',limit:'0'},
  {expand:'bnodes',depth:'6'}, {expand:'bnodes',incoming:'maybe'},
]) assert.throws(() => bnode.bnodeDescribeBounds(attrs));
const identifiers = bnode.createBlankNodeLabelAllocator('bn');
assert.equal(identifiers('_:a-b'), 'bn0');
assert.equal(identifiers('_:a_b'), 'bn1');
assert.equal(identifiers('_:a-b'), 'bn0');

// The server already depends on fast-xml-parser; the test gives the compiler
// an equivalent minimal parse tree so the regression suite needs no server.
const parseAttributes = raw => Object.fromEntries(Array.from(raw.matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)).map(m=>[`@_${m[1]}`,m[2]]));
const xmlStub = {XMLValidator:{validate:()=>true},XMLParser:class {
  parse(xml) {
    const rootTag = xml.match(/<query\b([^>]*)>/);
    if(!rootTag) throw Error('No query');
    const root = parseAttributes(rootTag[1]);
    const value = xml.match(/<value\b([^>]*)>([^<]*)<\/value>/);
    if(value) root.value = {...parseAttributes(value[1]), '#text':value[2]};
    const view = xml.match(/<view\b([^>]*)\/?\s*>/);
    if(view) root.view = parseAttributes(view[1]);
    return {query:root};
  }
}};
const translator = bundle('src/lib/fct-sparql-translator.ts', {
  './fct-view-types': {FCT_VIEW_TYPES: {DESCRIBE:'describe',PROPERTIES:'properties',PROPERTIES_IN:'properties-in',CLASSES:'classes',TEXT:'text',LIST:'list',LIST_VALUES:'list-values',GRAPHS:'graphs'},isFctViewType:()=>true},
  './bnode': bnode,
  'fast-xml-parser': xmlStub,
  './fct-value-policy': {normalizeFctValue:v=>v.trim()},
  './virtuoso-numeric-coercion': {NUMERIC_LEXICAL_PATTERN:'[0-9]+'},
  './virtuoso-full-text': {buildVirtuosoFullTextExpression:()=>null},
  './graph-address-mode': {ALL_GRAPHS:'$ALL$'},
});
const xml = attrs => `<query addr="urn:graph@https://example.org/sparql"><value datatype="uri">urn:curator</value><view type="describe" ${attrs}/></query>`;
const expanded = translator.compileFctXmlToSparql(xml('expand="bnodes" incoming="yes" depth="5" limit="5000"'));
assert.equal(expanded.describeExpanded, true);
assert.equal(expanded.describeMaxTriples, 5000);
assert.match(expanded.query, /SELECT DISTINCT \?s\s+\?p\s+\?o/);
assert.match(expanded.query, /GRAPH <urn:graph>/);
assert.match(expanded.query, /rdf-syntax-ns#rest>\* \?s/);
assert.match(expanded.query, /LIMIT 5001$/);
assert.match(expanded.query, /BIND\(\?s1 AS \?o\)/);
assert.match(expanded.query, /isBlank\(/);
assert.doesNotMatch(expanded.query, /DESCRIBE \?s1/);
const direct = translator.compileFctXmlToSparql(xml('limit="30"'));
assert.equal(direct.describeExpanded, false);
assert.match(direct.query, /^DESCRIBE \?s1/);
for(const invalid of ['expand="bnodes" limit="5001"','expand="bnodes" depth="9"','expand="bnodes" offset="1"','expand="bnodes" incoming="true"']) {
  assert.throws(() => translator.compileFctXmlToSparql(xml(invalid)), /Expanded FCT|FCT describe|describe\/@/);
}
assert.throws(() => translator.compileFctXmlToSparql('<query addr="urn:g@https://example.org/sparql"><view type="describe" expand="bnodes"/></query>'), /explicit root/);
console.log('FCT bounded bnode DESCRIBE checks passed.');
if (process.env.MAESTRO_DUMP_SPARQL) console.log(expanded.query);
