'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = (() => {try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const root = path.resolve(__dirname,'..');
const source = name => fs.readFileSync(path.join(root,name),'utf8');
const take = async (classes, contextProviders) => {
  let requests=[];
  const module={exports:{}};
  const code=ts.transpileModule(source('src/lib/client-personal-perspectives.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mocks = {
    '@/lib/constants/graphs':{ GRAPH:{SHACL_POLICIES:'shacl-policies',STATUS:'status'}, resolveGraph:(key,base)=>base+'/'+(key==='shacl-policies'?'shacl/policies':key) },
    '@/lib/client-query-cache': {maestroQueryFetch:async()=>{
      throw Error('Unexpected record probe during query-context discovery');
    }},
    '@/lib/client-personal-sparql':{
      personalContext:async()=>({base:'https://personal.example'}),
      selectPersonal:async(query)=>{
        requests.push(query);
        if(query.includes('SELECT DISTINCT ?provider ?kind ?label ?stylesheet'))return [{provider:{value:'https://provider.example/bookmarks'},kind:{value:'bookmarks'},label:{value:'Bookmarks'},stylesheet:{value:'<xsl:stylesheet />'}}];
        throw Error('Unexpected early discovery/preflight query');
      },
    },
    '@/lib/client-policy-approvals':{readClientPolicyApprovals:async()=>[{uri:'https://provider.example/bookmarks',status:'Approved'}]},
    '@/lib/client-provider-provenance':{isClientQueryBookmarked:async()=>false,writeClientProviderDiscovery:async()=>{}},
    '@/lib/maestro-ui-component-ids':{UI_COMPONENT:{perspectiveRibbon:'urn:ui:view'}},
  };
  vm.runInNewContext(code,{exports:module.exports,module,require:p=>{if(!(p in mocks))throw Error('Unexpected '+p);return mocks[p]}});
  const rows=await module.exports.discoverMatchedClientPerspectives(classes,'<query/>','',undefined,undefined,contextProviders);
  return {rows:JSON.parse(JSON.stringify(rows)),requests};
};
test('class-free contextual SHACL perspective is discovered through existing validated providers (no extra record probe)',async()=>{
  const {rows,requests}=await take([],['https://provider.example/bookmarks']);
  assert.equal(requests.length,1);
  assert.match(requests[0],/\?provider IN \(<https:\/\/provider\.example\/bookmarks>\)/);
  assert.equal(rows.length,1);assert.equal(rows[0].kind,'bookmarks');
});
test('no class and no contextual match does not dispatch a query',async()=>{
  const {rows,requests}=await take([],[]);
  assert.equal(rows.length,0);assert.equal(requests.length,0);
});
test('personal perspective buttons are scoped to exact FCT, visit and SHACL matches',()=>{
  const ui=source('src/canvas/tab/view/ribbon.tsx');
  assert.match(ui,/discoveryKey = \[queryXml, triggerUri, historyUri/);
  assert.match(ui,/const visibleViews = \[\.\.\.new Map\(discoveredViews\.map\(view => \[view\.uri, view\]\)\)\.values\(\)\]/);
  assert.match(ui,/const personalToRender = visibleViews\.flatMap/);
  assert.doesNotMatch(ui,/setPersonalDiscovery\(/);
  assert.doesNotMatch(ui,/window\.setTimeout/);
  assert.match(source('src/canvas/workspace.tsx'),/queryMatchedProviders=\{workspace\.queryMatchedProviders\}/);
});
test('mindmap relationship child nodes can navigate the verified path',()=>{
  const ui=source('src/canvas/tab/view/overview-connection-finder.tsx');
  assert.match(ui,/\^connection-\(\?:path-\)\?/);
  const match=/^connection-(?:path-)?(\d+)(?:-\d+)?$/;
  assert.equal(Number(match.exec('connection-path-2')?.[1]),2);
  assert.equal(Number(match.exec('connection-2-3')?.[1]),2);
  assert.equal(match.exec('not-a-path'),null);
});
test('autocomplete portaled popup does not close on pointer exit and matching algorithm is unchanged',()=>{
  const ui=source('src/canvas/top/root-uri-autocomplete.tsx');
  assert.match(ui,/<ComboboxContent aria-label="URI suggestions">/);
  assert.doesNotMatch(ui,/<ComboboxContent[^>]+onMouseLeave/);
  assert.match(ui,/createRootUriAutocompleteQuery\(prefix, addr, settings, propertyUris\)/);
});
test('query hover menu reports only observed browser slots and proxy lane addresses',()=>{
  const ui=source('src/canvas/top/appbar-pane.tsx');
  // A projected proxy address requires a positive proxy queue index and
  // both lane coordinates supplied by the proxy telemetry.
  assert.match(ui,/query\.serverQueueIndex && query\.serverQueueIndex > 0 && query\.serverQueueLane &&/);
  assert.match(ui,/query\.serverQueueLaneNumber && query\.serverQueueLanePosition/);
  assert.match(ui, /`\$\{lane\}\$\{query\.serverQueueLaneNumber\}:\$\{query\.serverQueueLanePosition\} · \$\{query\.serverQueueLane\}`/);
  // Browser waiting ordinals are local to that queue, not a synthetic rank
  // combining browser and proxy scheduler positions.
  assert.match(ui,/query\.state === "queued" && query\.queueIndex > 0/);
  assert.match(ui,/`B:\$\{query\.queueIndex\} · browser`/);
  assert.doesNotMatch(ui,/browser\.\$\{query\.queueIndex\}/);
  // Missing telemetry must not display a fabricated zero lane or queue slot.
  assert.match(ui,/return \{ text: "Browser admitted"/);
  assert.match(ui,/return \{ text: "Preparing"/);
  assert.doesNotMatch(ui,/query\.queueIndex > 0 \? query\.queueIndex : "0"/);
});
