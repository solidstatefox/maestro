const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
const workspace=read('src/canvas/utils/workspace-controller.tsx');

// Execute the actual URL serializer (not a reimplementation) with a controlled
// query/visit pair and the previous browser URL. The remaining parameters are UI-only.
const ast=ts.createSourceFile('workspace.tsx',workspace,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function findFunction(node,name){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)return node;return ts.forEachChild(node,child=>findFunction(child,name));}
const serializer=findFunction(ast,'buildCurrentShareUrl');
assert.ok(serializer);
const code=ts.transpileModule(serializer.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const q1='<query id="a"><view type="list"/></query>',q2='<query id="a"><class iri="urn:class"/><view type="list"/></query>';
function serialize(queryXml,committedXml,id,oldId='urn:old'){
  const url=new URL('http://localhost:3000/');url.searchParams.set('q',q1);url.searchParams.set('history',oldId);
  const env={URL,window:{location:{href:url.href}},queryXml,historyVisitQueryRef:{current:committedXml},historyVisitIdRef:{current:id},APPBAR_TAB_NUMBER:{browse:0,analyze:2},VIEW_RIBBON_TAB_NUMBER:{trail:0},workspaceTab:'analyze',viewPanel:'trail',selectedViewUri:''};
  const state=serializer.getText(ast).match(/const state: ShareableUiState = \{([\s\S]*?)\n    \};/)[1];
  for(const line of state.split('\n')){const variable=line.trim().replace(/,$/,'').split(':').at(-1).trim();if(/^[\w]+$/.test(variable)&&!(variable in env))env[variable]=null;}
  return new URL(vm.runInNewContext(`${code}\nbuildCurrentShareUrl()`,env));
}
test('an edited q never travels with the previous History ID while persistence is pending',()=>{
  const next=serialize(q2,q1,'urn:old');assert.equal(next.searchParams.get('q'),q2);assert.equal(next.searchParams.has('history'),false);
  const pending=serialize(q2,q2,'');assert.equal(pending.searchParams.has('history'),false);
  const committed=serialize(q2,q2,'urn:new');assert.equal(committed.searchParams.get('history'),'urn:new');assert.equal(committed.searchParams.get('q'),q2);
});
test('a tab-only change preserves the exact committed History identity',()=>{
  const next=serialize(q1,q1,'urn:old');assert.equal(next.searchParams.get('history'),'urn:old');assert.equal(next.searchParams.get('q'),q1);assert.equal(next.searchParams.get('tab'),'2');
});
test('template edit publishes the existing final visit returned by persistence; no repair reads',()=>{
  const block=workspace.slice(workspace.indexOf('let finalVisitId ='),workspace.indexOf('replaceQueryTree(queuedLiveTree);'));
  assert.match(block,/finalVisitId = await writeHistoryVisit\(snapshot/);
  assert.match(block,/historyVisitQueryRef\.current = finalXml;\s*historyVisitIdRef\.current = finalVisitId;\s*setHistoryBookmarkId\(finalVisitId\)/);
  const restore=findFunction(ast,'restoreQueryAndUiState').getText(ast);
  assert.match(restore,/replaceQueryTree\(restoredTree\);[\s\S]*?serializedQuery\.trim\(\) === liveXml\.trim\(\)/);
  assert.doesNotMatch(restore,/clientQueryFavorites|writeHistoryVisit/);
  assert.doesNotMatch(workspace,/isInitialLoadedHistoryItem/);
  const writer=findFunction(ast,'writeHistoryVisit').getText(ast);
  assert.ok(writer.indexOf('visitUrl.searchParams.delete("history")') < writer.indexOf('action: "visit"'));
  assert.match(writer,/stateUrl: visitUrl\.toString\(\)/);
  assert.match(workspace,/if \(supplied\?\.trim\(\) !== initialXml\.trim\(\)\) params\.delete\("history"\)/);
  assert.match(read('src/lib/client-query-shacl.ts'),/visits\[0\]\.xml\.value\.trim\(\)!==queryXml\.trim\(\)/);
});
test('Connect is the invocation state, not a React flag left behind by an aborted attempt',()=>{
  const auth=read('src/canvas/controllers/authentication.ts'),access=read('src/canvas/diagnostics/use-maestro-access.ts');
  assert.doesNotMatch(auth,/setLoginTesting/);
  assert.match(auth,/}, "connect"\);/);
  assert.match(access,/initializationSnapshot\.matches\("running"\) && initializationSnapshot\.context\.request\?\.purpose === "connect"/);
  assert.match(access,/unsubscribe\(\); controller\.stop\(\)/);
  assert.doesNotMatch(auth,/loadClientStatusMachines\(|invalidateClientStatusMachines\(/);
});
