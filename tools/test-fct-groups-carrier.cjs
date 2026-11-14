const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(js, filename);
};
const lib = require(path.resolve(__dirname, '../src/lib/fct-groups-carrier.ts'));
const clone = require(path.resolve(__dirname, '../src/lib/fct-query-clone.ts'));
const view = { name:'view',id:'c',uiKey:'query-view',attributes:{type:'list',limit:'30',offset:'0'},children:[] };
const p = { id:'p',name:'property',attributes:{iri:'urn:test:label'},children:[] };
const r = { id:'r',name:'property-of',attributes:{iri:'urn:test:role'},children:[] };
const tree={name:'query',attributes:{addr:'@https://example.org/sparql'},children:[p,r,view]};
const serialized=JSON.stringify(tree);
const first=lib.markFctGroup(tree, {id:'p',name:'property',iri:'urn:test:label'});
assert.equal(lib.groupKeyFromCarrier(first),'forward:urn:test:label');
assert.equal(lib.findGroupCarrier(first).view.id,'c');
assert.equal(first.children.find(n=>n.id==='p').attributes.group,'true');
assert.equal(tree.children.find(n=>n.id==='p').attributes.group,undefined);
const second=lib.markFctGroup(first,{id:'r',name:'property-of',iri:'urn:test:role'});
assert.equal(lib.groupKeyFromCarrier(second),'reverse:urn:test:role');
assert.equal(second.children.find(n=>n.id==='p').attributes.group,undefined);
const data=clone.cloneFctQueryTree(second,'data');
assert.equal(lib.groupKeyFromCarrier(data),'');
assert.equal(data.children.find(n=>n.id==='r').attributes.group,undefined);
assert.equal(second.children.find(n=>n.id==='r').attributes.group,'true');
const exact=clone.cloneFctQueryTree(second,'exact');
assert.equal(exact.children.find(n=>n.id==='r').attributes.group,'true');
assert.notEqual(exact.children,second.children);
assert.equal(JSON.stringify(tree),serialized);
const off=lib.markFctGroup(second,null);
assert.equal(lib.groupKeyFromCarrier(off),'');
const nested={name:'query',attributes:{},children:[{
  id:'a',name:'property',attributes:{iri:'urn:link'},children:[{id:'inner',name:'property',attributes:{iri:'urn:date',group:'true'},children:[]},view]
}]};
assert.equal(lib.groupKeyFromCarrier(nested),'forward:urn:date');
assert.equal(lib.groupKeyFromCarrier(clone.cloneFctQueryTree(nested,'data')),'');
console.log('Group marker, direction, scope, immutable live tree, and exact/data clones passed.');
