const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('XState invokes the foreground request owner and stops it on navigation',()=>{
 const source=read('src/lib/app-lifecycle/query-view-ownership.ts');
 for(const needle of ['fromCallback<ExecuteRequest>','invoke: { id: "view-operations", src: "operations" }',
   'type: "NAVIGATE"','reenter: true','sendTo("view-operations"','controller.abort()',
   'ownerKey === context.owner.key','event.generation === context.generation'])
   assert.ok(source.includes(needle),needle);
 assert.doesNotMatch(source,/onLeave\(|abortOffstageMaestroQueries|\.getElementById\(/);
});

test('no view query enters the scheduler without a workspace actor and exact tab/ribbon',()=>{
 const cache=read('src/lib/client-query-cache.ts');
 for(const needle of ['registerMaestroQueryWorkspace','workspace.controller.execute(scope!, actorSignal',
   'declaredViewScope(headers)','queryWorkspaces.get(query.workspaceId)','viewOwnerKey: ownerKey'])
   assert.ok(cache.includes(needle),needle);
 assert.doesNotMatch(cache,/maestroRequestViewClaim|abortOffstageMaestroQueries|maestroViewCoordinator|tab: "current"/);
 assert.match(cache,/if \(!workspace \|\| \(!scope && !actorOwner\)\) throw new DOMException/);
 assert.match(cache,/if \(job\.signal\?\.aborted\) \{/);
});

test('React changes the selected tab and ribbon by XState events, without queue owner refs',()=>{
 const ui=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(ui,/useSyncExternalStore\(queryViewController\.subscribe/);
 assert.match(ui,/navigateQueryView\(\{ tab: "view", viewProvider: providerKind, viewPanel: "providers" \}\)/);
 assert.match(ui,/queryViewController\.select\(\{ \.\.\.queryViewController\.getSelection\(\), \.\.\.change \}\)/);
 assert.doesNotMatch(ui,/viewQueueSelectionRef|switchViewQueryOwner|selectMaestroActiveQueryView/);
});

test('every browser query call has a declared view; no debug label can grant work',()=>{
 const modules=[];
 function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){
  const abs=path.join(folder,item.name);
  if(item.isDirectory())walk(abs);
  else if(/\.tsx?$/.test(item.name)&&item.name!=='client-query-cache.ts')modules.push(abs);
 }}walk(path.join(root,'src'));
 for(const file of modules){
  const content=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,content,99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['maestroQueryFetch','cachedFetchFct'].includes(node.expression.text)){
    const init=node.arguments[1];const headers=init&&ts.isObjectLiteralExpression(init)&&init.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)==='headers');
    assert.ok(headers&&/x-maestro-view-tab|activeViewQueryHeaders/.test(headers.getText(ast)),`${file}:${ast.getLineAndCharacterOfPosition(node.pos).line+1}`);
   }
   ts.forEachChild(node,visit);
  };visit(ast);
 }
});

test('all changed source files parse as TypeScript',()=>{
 for(const file of ['src/lib/app-lifecycle/query-view-ownership.ts','src/lib/client-query-cache.ts',
  'src/canvas/utils/workspace-controller.tsx','src/components/ui/maestro-provider-host.tsx',
  'src/lib/maestro-provider-dom.ts','src/lib/maestro-provider-query-executor.ts','src/lib/fct-client.ts']){
  const ast=ts.createSourceFile(file,read(file),99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file);
 }
});

test('saved view restoration commits tab, ribbon and provider atomically; hosted providers use exact mount leases',()=>{
 const ui=read('src/canvas/utils/workspace-controller.tsx');
 assert.match(ui,/const restoredViewSelection: Partial<typeof viewSelection> = \{\};/);
 assert.match(ui,/navigateQueryView\(restoredViewSelection\)/);
 assert.match(ui,/navigateQueryView\(\{ viewPanel: "perspectives", selectedViewUri: uri, viewProvider: null \}\)/);
 const host=read('src/components/ui/maestro-provider-host.tsx');
 assert.match(host,/registerMaestroProviderMount\(componentUrn, controller\.signal, \{tab:"view",ribbon:`perspectives:\$\{providerUri\}`\}\)/);
 assert.match(host,/unregisterMaestroProviderMount\(componentUrn, controller\.signal\)/);
 const bridge=read('src/lib/maestro-provider-dom.ts');
 assert.match(bridge,/function requireMountScope\(signal\?: AbortSignal\)/);
 assert.match(bridge,/const scope = requireMountScope\(signal\)/);
 assert.match(bridge,/executeProviderDerivedQuery\(query, signal, requireMountScope\(signal\)\)/);
});
