// Dependency-free focused Phase 1 regressions. Uses the project's TypeScript
// compiler after `npm.cmd ci`, or a globally installed TypeScript on CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let ts;
try { ts = require('typescript'); }
catch { try { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); }
  catch { ts = null; } }
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
if (ts) require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  module._compile(code, filename);
};

test('all TypeScript/TSX source files parse', { skip: !ts }, () => {
  let files = 0;
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(filename);
      else if (/\.tsx?$/.test(entry.name)) {
        files++;
        const kind = filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, kind);
        assert.equal(parsed.parseDiagnostics.length, 0, `${filename} failed TypeScript parsing`);
      }
    }
  }
  scan(path.join(root,'src'));
  assert.ok(files > 300);
});

test('group headings decode the established typed FCT facet rows, never SPARQL aliases', {skip:!ts}, () => {
  const {decodeFctFacetGroupRows} = require('../src/lib/group-projection-contract.ts');
  const facetRow = (term, count, kind='uri') => ({uri:'',title:'',matches:[],columns:[
    {value:term, termType:kind,attributes:{var:'arbitraryTerm'},raw:{}},
    {value:String(count),attributes:{var:'count_d'},raw:{}}
  ]});
  const rows = [facetRow('http://dbpedia.org/resource/Surfing',2),facetRow('Basketball',1,'literal')];
  const out=decodeFctFacetGroupRows(rows, uri=>uri.split('/').at(-1),7);
  assert.deepEqual(out.map(row=>[row.uri,row.columns[1].value]), [
    ['http://dbpedia.org/resource/Surfing','2'],['Basketball','1']]);
  assert.equal(out[0].title, 'Surfing');
  assert.throws(()=>decodeFctFacetGroupRows([facetRow('Alaska',51)],x=>x,7),/exceeding/);
  assert.throws(()=>decodeFctFacetGroupRows([facetRow('Surfing','NaN')],x=>x,7),/valid distinct/);
});

test('repeated skos:broader navigation advances to the inner relationship', {skip:!ts}, () => {
  const {navigateFacetHeaderQuery} = require('../src/lib/fct-facet-header-navigation.ts');
  const uri = 'http://www.w3.org/2004/02/skos/core#broader';
  const view = {id:'f',name:'view',attributes:{type:'list',limit:'30'},children:[]};
  const inside = {id:'o',name:'property',attributes:{iri:uri},children:[]};
  const outside = {id:'n',name:'property',attributes:{iri:uri},children:[inside,view]};
  const tree = {name:'query', attributes:{id:'a',ctr:'25',addr:'$ALL$@https://vec.demo.openlinksw.com/sparql'}, children:[{id:'i',name:'value',attributes:{datatype:'uri'},text:'http://dbpedia.org/resource/Category:University_of_Miami',children:[]},outside]};
  const next = navigateFacetHeaderQuery(tree,uri);
  const outer = next.children.find(child=>child.name==='property');
  const inner = outer.children.find(child=>child.name==='property');
  assert.equal(outer.children.some(child=>child.name==='view'),false);
  assert.equal(inner.children.some(child=>child.name==='view'),true);
});

test('legacy view indexLang is absent from serialized FCT XML', {skip:!ts}, () => {
  const {serializeFctQuery} = require('../src/lib/fct-query-serialize.ts');
  const query = {name:'query',attributes:{id:'a',ctr:'20',addr:'$ALL$@https://dbpedia.org/sparql'},children:[
    {id:'f',name:'view',attributes:{type:'list',indexLang:'fr'},children:[]},
  ]};
  const xml = serializeFctQuery(query);
  assert.doesNotMatch(xml,/indexLang/);
  assert.match(xml,/type="list"/);
});

test('language URL overrides saved Sheet preference only until removed', {skip:!ts}, () => {
  const language = require('../src/lib/maestro-language.ts');
  const previous = global.window;
  let current = new URL('http://localhost:3000/?q=snapshot&tab=1');
  const events = [];
  global.window = {
    get location() {return {href:current.toString(),search:current.search};},
    history:{state:{},pushState(_state,_title,url){current=new URL(url,current);}},
    dispatchEvent(event){events.push(event.type);},
  };
  try {
    language.setSheetLanguage('en');
    assert.equal(language.effectiveMaestroLanguage(),'en');
    language.changeUrlLanguage('pt-BR');
    assert.equal(language.effectiveMaestroLanguage(),'pt-br');
    assert.equal(current.searchParams.get('q'),'snapshot');
    assert.equal(current.searchParams.get('tab'),'1');
    language.changeUrlLanguage(null);
    assert.equal(language.effectiveMaestroLanguage(),'en');
    assert.equal(current.searchParams.has('lang'),false);
    assert.deepEqual(events, [language.MAESTRO_LANGUAGE_CHANGED,language.MAESTRO_LANGUAGE_CHANGED]);
    language.setSheetLanguage('all');
    assert.equal(language.effectiveMaestroLanguage(),'all');
    assert.equal(language.validMaestroLanguage('en-US'),'en-us');
    assert.equal(language.validMaestroLanguage('../bad'),null);
  } finally {global.window=previous;}
});

test('live query ownership and navigation do not regress to IRI/option heuristics', () => {
  const workspace = read('src/canvas/utils/workspace-controller.tsx');
  const cards = read('src/canvas/left/personal-widget-cards.tsx');
  assert.doesNotMatch(workspace,/!groupByOptions\.some\([\s\S]{0,240}setGroupByPropertyUri\(""\)/);
  assert.match(cards,/if \(boundNode\) navigateToPropertyPath\(boundNode\.id\)/);
  assert.match(workspace,/ensureHistoryVisitForBookmark/);
  assert.match(workspace,/historyVisitIdRef\.current = ""/);
  assert.match(workspace,/decodeFctFacetGroupRows\(/);
  assert.doesNotMatch(workspace,/Cannot identify the grouping value and count columns/);
});

test('temporal selection and Overview sweep retain FCT semantics', () => {
  const temporal = read('src/canvas/left/personal-date-facet.tsx');
  const workspace = read('src/canvas/utils/workspace-controller.tsx');
  const overview = read('src/canvas/tab/view/overview.tsx');
  assert.match(temporal,/savedResolution = range\?\.attributes\.uiResolution/);
  assert.match(temporal,/savedCell = range\?\.attributes\.uiCell/);
  assert.match(workspace,/uiResolution: selection\.resolution, uiCell: selection\.cell/);
  assert.match(overview,/startAngle=\{-90\} endAngle=\{270\}/);
});

test('provider eligibility is separate from generic History validation', () => {
  const generic = read('src/lib/personal-sparql-reads.ts');
  assert.match(generic,/sh:or \?conditions/);
  assert.match(generic,/readClientPolicyApprovals/);
  const page = read('src/canvas/tab/view/page.tsx');
  assert.doesNotMatch(page,/useMapProviderDefinition|useMapProviderDiscovery/);
});
