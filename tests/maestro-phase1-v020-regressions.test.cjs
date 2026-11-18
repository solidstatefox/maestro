const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const read=name=>readFileSync(path.join(root,name),'utf8');
let ts; try {ts=require('typescript');} catch {try {ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');} catch{ts=null;}}
if(ts)require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);

test('Group-by headings reuse the same derived Personal facet FCT paths',()=>{
  const src=read('src/lib/fct-query-derived.ts');
  const fn=src.slice(src.indexOf('export function createGroupValuesQuery('),src.indexOf('export function createGroupMemberQuery('));
  assert.match(fn,/ungroupForMembers\(sourceTree\)/);
  assert.match(fn,/createPropertyWidgetQuery\(clean, option\.uri, option\.direction, option\.nodeId, true\)/);
  assert.match(fn,/createPersonalRoleValuesQuery\(clean, selected\)/);
  assert.match(fn,/FCT_VIEW_TYPES\.CLASSES/);
  assert.doesNotMatch(fn,/markFctGroup/);
});

test('Actual sport rows survive arbitrary SELECT aliases without regex parsing', {skip:!ts},()=>{
 const {decodeFctFacetGroupRows}=require('../src/lib/group-projection-contract.ts');
 const rows=[['http://dbpedia.org/resource/Surfing',2],['Basketball',1],
  ['http://dbpedia.org/resource/Baseball',1],['http://dbpedia.org/resource/Rodeo',1],
  ['http://dbpedia.org/resource/Skiing',1],['http://dbpedia.org/resource/Sled_dog',1]]
 .map(([value,count],i)=>({uri:'',title:'',matches:[],columns:[
 {value,termType:value.startsWith('http')?'uri':'literal',attributes:{var:`term_${i}`},raw:{}},
 {value:String(count),attributes:{var:`count_${i}`},raw:{}}]}));
 const out=decodeFctFacetGroupRows(rows,x=>x.split('/').at(-1),7);
 assert.equal(out.length,6);
 assert.equal(out.reduce((sum,row)=>sum+Number(row.columns[1].value),0),7);
 assert.equal(out[0].uri,'http://dbpedia.org/resource/Surfing');
 assert.equal(out[0].columns[1].value,'2');
});

test('Center grouped view follows committed group attribute; failed fetch preserves known groups',()=>{
 const w=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(w,/groupByPropertyUri && centralTab === "results"\) setCentralTab\("groups"\)/);
 assert.match(w,/!groupByPropertyUri && centralTab === "groups"\) setCentralTab\("results"\)/);
 assert.doesNotMatch(w,/groupProjectionContract\(data\.sparql\)/);
 assert.doesNotMatch(w,/Cannot identify the grouping value and count columns/);
 assert.match(w,/An unsuccessful transient refresh must not erase previously loaded/);
});

test('Return can capture Bookmarks Perspective if no prior Browse owner exists',()=>{
 const nav=read('src/lib/app-lifecycle/operations.ts');
 const w=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(nav,/pendingEntryUrl: context\.key === context\.browseQueryKey && context\.browseUrl[\s\S]*?: event\.fromUrl/);
 assert.match(nav,/context\.key === event\.sourceKey/);
 assert.match(w,/if \(!restored \|\| restored\.workspaceTab === "browse"\)/);
});

test('XSLT React SVG attributes are normalized; Record values use immediate component',()=>{
 const xslt=read('src/components/maestro-xslt-components.tsx');
 for(const [a,b] of [['stroke-width','strokeWidth'],['stroke-linecap','strokeLinecap'],['stroke-linejoin','strokeLinejoin']])
  assert.ok(xslt.includes(`"${a}": "${b}"`));
 assert.match(xslt,/node\.localName\.toLowerCase\(\) === "recordvaluepages"\) return RecordValuePages/);
});
