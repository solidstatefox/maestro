/* Regression: an FCT Results blank node may be the object of a forward property,
 * the subject of a reverse property, or descend through other blank nodes.
 * Its Record is rebound by the nearest URI ancestor on the structural FCT path.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
// Resolve the XML parser through the project dependency graph, on any OS.
// Do not depend on a developer's global Node.js installation.
let DOMParser, XMLSerializer;
try {
  ({ DOMParser, XMLSerializer } = require('@xmldom/xmldom'));
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  throw new Error(
    'The regression test requires @xmldom/xmldom. Install it locally '
    + '(e.g. npm install --no-save @xmldom/xmldom) and rerun the test.',
    { cause: error },
  );
}
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const documentProto = Object.getPrototypeOf(new DOMParser().parseFromString('<query/>','application/xml'));
documentProto.querySelector ??= function (selector) { return this.getElementsByTagName(selector)[0] ?? null; };
const elementProto = Object.getPrototypeOf(new DOMParser().parseFromString('<query/>','application/xml').documentElement);
// xmldom versions may already expose these DOM properties as non-configurable.
// Supply only missing browser-compatible accessors; never overwrite native ones.
if (!('children' in elementProto)) {
  Object.defineProperty(elementProto, 'children', {
    configurable: true,
    get() { return Array.from(this.childNodes).filter(n => n.nodeType === 1); },
  });
}
if (!('parentElement' in elementProto)) {
  Object.defineProperty(elementProto, 'parentElement', {
    configurable: true,
    get() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; },
  });
}
const originalLoad = Module._load;
Module._load = function (request,parent,isMain) {
  if (request === '@/lib/fct-view-types') return { FCT_VIEW_TYPES: {LIST_VALUES:'list-values'} };
  if (request === '@/lib/bnode') return require(path.resolve(__dirname,'../src/lib/bnode.ts'));
  return originalLoad.call(this,request,parent,isMain);
};
require.extensions['.ts'] = function (mod, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  mod._compile(output, filename);
};
const {blankNodeRecordListValuesQuery} = require(path.resolve(__dirname, '../src/lib/bnode-dom.ts'));
const ns='http://openlinksw.com/services/facets/1.0';
const root = (xml) => new DOMParser().parseFromString(xml, 'application/xml').documentElement;
const direct = `<query xmlns="${ns}"><property iri="urn:p"><view type="list" limit="30"/></property></query>`;
let node = root(blankNodeRecordListValuesQuery(direct,'urn:p','urn:parent',50,false,'forward',0));
assert.equal(node.getElementsByTagNameNS(ns, 'view')[0].getAttribute('type'), 'list-values');
assert.equal(node.getElementsByTagNameNS(ns, 'value')[0].parentNode, node);
assert.equal(node.getElementsByTagNameNS(ns, 'value')[0].textContent, 'urn:parent');
const nested = `<query xmlns="${ns}"><property iri="urn:outer"><property iri="urn:inner"><view type="list"/></property></property></query>`;
node = root(blankNodeRecordListValuesQuery(nested,'urn:inner','urn:root',50,false,'forward',0));
assert.equal(node.getElementsByTagNameNS(ns, 'value')[0].parentNode, node);
assert.equal(node.getElementsByTagNameNS(ns, 'property').length, 2);
node = root(blankNodeRecordListValuesQuery(nested,'urn:inner','urn:intermediate',50,false,'forward',1));
assert.equal(node.getElementsByTagNameNS(ns, 'value')[0].parentNode, node.getElementsByTagNameNS(ns, 'property')[0]);
const reverse = `<query xmlns="${ns}"><property-of iri="urn:role"><view type="list"/></property-of></query>`;
node = root(blankNodeRecordListValuesQuery(reverse,'urn:role','urn:object',50,false,'reverse',0));
assert.equal(node.getElementsByTagNameNS(ns, 'value')[0].parentNode, node);
assert.throws(()=>blankNodeRecordListValuesQuery(nested,'urn:inner','urn:wrong',50,false,'forward',2), /anchor does not belong/);
console.log('PASS: direct forward, nested root/intermediate URI anchors, reverse role, invalid path');
