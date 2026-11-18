const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const root=require('node:path').resolve(__dirname,'..');
function loadTs(rel,mocks={}){const p=root+'/'+rel,js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,mod={exports:{}};new Function('require','module','exports',js)((n)=>{if(n in mocks)return mocks[n];throw Error('Unmocked '+n+' from '+rel)},mod,mod.exports);return mod.exports}
const identity=loadTs('src/lib/fct-node-identity.ts');
const source={id:'b',name:'property',attributes:{iri:'https://schema.org/email',rid:'a'},children:[]};
const derived={id:'c',name:'property',attributes:{iri:'gttp://ggg.maestro.ui/derived/email#username',rid:'b',pid:'a',derive:'regex',pattern:'^(?:mailto:)?([^@\\s]+)@([^@\\s]+)$',capture:'1',label:'email: username'},children:[{id:'d',name:'view',attributes:{type:'list',limit:'30',offset:'0'},children:[]}]};
const original={name:'query',attributes:{id:'a',ctr:'15',uctr:'a',rctr:'c',addr:'$ALL$@https://vec.demo.openlinksw.com/sparql'},children:[{id:'i',name:'value',attributes:{datatype:'uri'},text:'http://example.org/person',children:[]},source]};
const spawn=loadTs('src/lib/fct-derived-facets.ts',{'./fct-node-identity':identity}).spawnRegexDerivedFacets;
const spawned=spawn(original,'b',[{iri:derived.attributes.iri,label:'email: username',pattern:derived.attributes.pattern,capture:'1'}]);
assert.equal(spawned.children.length,3);assert.equal(spawned.children[2].attributes.pid,spawned.children[1].attributes.rid);assert(identity.isValidFctNodeId(spawned.children[2].attributes.rid));
assert.equal(spawn(spawned,'b',[{iri:derived.attributes.iri,label:'email: username',pattern:derived.attributes.pattern,capture:'1'}]).children.length,3);
const kinds={'./maestro-language':{effectiveMaestroLanguage:()=> 'en',validMaestroLanguage:(value)=>value},'./maestro-kinds':{MAESTRO_KIND_IDS:[],normalizeMaestroKind:()=>null,maestroKindSparql:()=>''},'./graph-address-mode':{ALL_GRAPHS:'$ALL$'},'./fct-value-policy':{normalizeFctValue:s=>s??''},'./virtuoso-full-text':{buildVirtuosoFullTextExpression:()=>null},'./virtuoso-numeric-coercion':{guardedNumericRangeFilter:()=>'',numericFacetBinding:()=>'',NUMERIC_FACET_PROJECTION:''}};
const buildCount=loadTs('src/lib/fct-count-sparql.ts',kinds).buildFctCountSparql;
const count=buildCount({...original,children:[original.children[0],source,derived]});
assert(count&&count.includes('BIND(REPLACE('),count);assert(count.includes('$1'),count);assert(count.includes('REGEX(STR('),count);
// Mock only XML parser dependency: the compiler still executes its actual query-generation pipeline.
const expressionMock={
 './maestro-language':kinds['./maestro-language'],
 './maestro-kinds':kinds['./maestro-kinds'],
 './fct-view-types':{FCT_VIEW_TYPES:{TEXT:'text',LIST:'list',LIST_COUNT:'list-count',DESCRIBE:'describe',PROPERTIES:'properties',PROPERTIES_IN:'properties-in',CLASSES:'classes',GRAPHS:'graphs'},isFctViewType:()=>true},
 './bnode':{isBlankNodeTerm:()=>false,bnodeDescribeBounds:()=>({}),RDF_REST_IRI:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
 'fast-xml-parser':{XMLParser:class{parse(){return {query:{'@_addr':original.attributes.addr,value:{'@_datatype':'uri','#text':'http://example.org/person'},property:[{'@_iri':source.attributes.iri,'@_rid':'a'},{'@_iri':derived.attributes.iri,'@_rid':'b','@_pid':'a','@_derive':'regex','@_pattern':derived.attributes.pattern,'@_capture':'1',view:{'@_type':'list','@_limit':'30','@_offset':'0'}}]}}}},XMLValidator:{validate:()=>true}},
 './fct-value-policy':kinds['./fct-value-policy'],
 './virtuoso-numeric-coercion':{NUMERIC_LEXICAL_PATTERN:'^[-+]?\\d+$'},
 './virtuoso-full-text':kinds['./virtuoso-full-text'],
 './graph-address-mode':kinds['./graph-address-mode'],
};
const compile=loadTs('src/lib/fct-sparql-translator.ts',expressionMock).compileFctXmlToSparql;
const compiled=compile('<query/>');
assert(compiled.query.includes('BIND(REPLACE('),compiled.query);assert(compiled.query.includes('REGEX(STR('),compiled.query);assert(compiled.query.includes('$1'),compiled.query);
console.log('PASS derived regex source binding, pid/rid provenance, idempotence, count and FCT projection');
