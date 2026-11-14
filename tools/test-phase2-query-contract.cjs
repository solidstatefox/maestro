/** Focused pure-query contract tests. Run with node after npm install. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const copy = (value) => JSON.parse(JSON.stringify(value));
const queryApi = { fctQueryTreeApi: {
  getDataTree: (tree) => copy(tree),
  resetQuery: (tree) => ({...copy(tree), children:[
    {id:'t',name:'text',attributes:{property:'urn:label'},text:'',children:[]},
    {id:'v',uiKey:'query-view',name:'view',attributes:{type:'list',limit:'30',offset:'0'},children:[]},
  ]}),
  setSearchText: (tree,text) => ({...tree,children:tree.children.map(node => node.name==='text'?{...node,text}:node)}),
  insertNode: (tree,parent,node) => {
    const result=copy(tree);
    const insert=(nodes) => {
      for(const item of nodes) {if(item.id===parent){item.children.push(node);return true;}if(insert(item.children))return true;}
      return false;
    };
    if(parent === null) result.children.push(node);
    else if(!insert(result.children))throw Error('Missing parent '+parent);
    return result;
  },
}};
function load(relative) {
  const filename=path.join(root,relative);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=(name)=>name==='./fct-query-api'?queryApi:require(name);
  mod._compile(code,filename);
  return mod.exports;
}
const {classifyRecordValue,buildWandQuery}=load('src/lib/record-explorer-query.ts');
assert.equal(classifyRecordValue('https://example.org/a','uri'),'web-url');
assert.equal(classifyRecordValue('2026-11-13','literal'),'date');
assert.equal(classifyRecordValue('12.5','literal'),'numeric');
const base={name:'query',attributes:{xmlns:'http://openlinksw.com/services/facets/1.0',addr:'urn:g@https://example.org/sparql',ctr:'20'},children:[
  {id:'original',name:'view',attributes:{type:'text'},children:[]},
]};
const draft=buildWandQuery(base,[{predicate:'urn:friend',direction:'property'}],[
  {recordIndex:0,predicate:'urn:name',direction:'property'},
  {recordIndex:1,predicate:'urn:employer',direction:'property-of'},
]);
assert.equal(draft.children.find(n=>n.name==='text').text,'');
assert(draft.children.some(n=>n.name==='property'&&n.attributes.iri==='urn:name'));
const parent=draft.children.find(n=>n.name==='property'&&n.attributes.iri==='urn:friend');
assert(parent&&parent.children.some(n=>n.name==='property-of'&&n.attributes.iri==='urn:employer'));
assert.equal(base.children[0].attributes.type,'text','source never modified');
const {resolveTransportedFacets,createTransportedFacetQuery}=load('src/lib/fct-facet-alias.ts');
const tree={name:'query',attributes:{id:'a',ctr:'20',xmlns:'http://openlinksw.com/services/facets/1.0'},children:[
  {id:'b',name:'property',attributes:{iri:'urn:friend'},children:[
    {id:'c',name:'property-of',attributes:{iri:'urn:employer'},children:[{id:'d',name:'value',text:'urn:prior',attributes:{datatype:'uri'},children:[]}]},
  ]},
  {id:'e',name:'a',attributes:{href:'c'},children:[]},
  {id:'f',name:'view',attributes:{type:'list',limit:'30'},children:[]},
]};
const aliases=resolveTransportedFacets(tree);
assert.equal(aliases.length,1);assert.deepEqual(aliases[0].path.map(n=>n.id),['b','c']);
const projected=createTransportedFacetQuery(tree,'c');
assert.equal(projected.children.filter(n=>n.name==='view').length,0);
const projectedTarget=projected.children[0].children[0];
assert.equal(projectedTarget.children.filter(n=>n.name==='view').length,1);
assert.equal(projectedTarget.children.filter(n=>n.name==='value').length,0);
assert.equal(projectedTarget.children.find(n=>n.name==='view').attributes.type,'list-count');
assert.equal(tree.children[2].name,'view','source view remains at root');
console.log('Phase 2 query contracts: passed');
