const fs=require('fs'),ts=require('typescript'),assert=require('assert/strict');
const filename=require('node:path').resolve(__dirname,'../src/lib/fct-query.ts');const s=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);let fun;
for(const node of s.statements) if(ts.isFunctionDeclaration(node)&&node.name?.text==='attachViewToPropertyInQueryTree') fun=node.getText(s);
assert(fun);
const compiled=ts.transpileModule(`type FctQueryNode=any;type FctQueryTree=any;${fun}\nexports.attachViewToPropertyInQueryTree=attachViewToPropertyInQueryTree;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('exports','module',compiled)(mod.exports,mod);
const uri='http://www.w3.org/2004/02/skos/core#broader';
const make=(includeId)=>({name:'query',attributes:{addr:'$ALL$@https://vec.demo.openlinksw.com/sparql'},children:[{id:'r',name:'value',attributes:{datatype:'uri'},text:'http://dbpedia.org/resource/Category:University_of_Miami',children:[]},{...(includeId?{id:'k'}:{}),name:'property',attributes:{iri:uri},children:[{...(includeId?{id:'l'}:{}),name:'property',attributes:{iri:uri},children:[]},{...(includeId?{id:'f'}:{}),name:'view',attributes:{type:'list',limit:'30'},children:[]}]}]});
for(const idFlag of [true,false]){
  const tree=make(idFlag),parent=tree.children[1],view=parent.children[1];
  const widget=mod.exports.attachViewToPropertyInQueryTree(tree,uri,'property',view,'fallback-property');
  assert.equal(tree.children[1].children[1].name,'view'); // live tree unchanged
  const outer=widget.children[1];assert.equal(outer.children.filter(n=>n.name==='view').length,0);
  assert.equal(outer.children[0].name,'property');assert.equal(outer.children[0].children[0].name,'view');
  assert.equal(widget.children.length,2); // no duplicate root-scope skos broader
}
console.log('PASS repeated skos:broader relationship and view relocation in DERIVED widget only, with/without XML IDs.');
