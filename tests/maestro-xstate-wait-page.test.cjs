"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const ts=require("typescript");
const vm=require("node:vm");
const read=name=>fs.readFileSync(name,"utf8");
const source=read("src/lib/app-lifecycle/restored-view-entry.ts");
const compiled=ts.transpileModule(source, { fileName:"restored-view-entry.ts", compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText;
const sandbox={exports:{}};
vm.runInNewContext(compiled,sandbox);
const decide=overrides=>JSON.parse(JSON.stringify(sandbox.exports.decideRestoredViewEntry({
  tab:"view",authRestored:true,accessRestoring:false,personalSessionPresent:false,
  personalReady:false,personalPolicyStage:"unavailable",queryReady:true,
  cancelled:false,selectedAnalysisUri:"",analysisBuiltIn:true,analysisEligible:false,...overrides,
})));

test("no login: redirected from View to Browse, never held by a spinner",()=>{
 const result=decide({});
 assert.equal(result.status,"browse");assert.match(result.reason,/no authenticated session/);
});
test("pending authentication is denied immediately, never deferred",()=>{
 assert.equal(decide({authRestored:false}).status,"browse");
 assert.equal(decide({accessRestoring:true}).status,"browse");
 assert.equal(decide({tab:"browse",authRestored:false}).status,"admit");
});
test("signed-in but seeding or verifying: actionable Browse fallback",()=>{
 for(const stage of ["seeding","verifying"]){
   const value=decide({personalSessionPresent:true,personalPolicyStage:stage});
   assert.equal(value.status,"browse"); assert.match(value.reason,/still initializing/);
 }
});
test("initialization failure and failed provider eligibility fail closed",()=>{
 assert.match(decide({personalSessionPresent:true,personalPolicyStage:"failed"}).reason,/failed/);
 assert.equal(decide({tab:"analyze",selectedAnalysisUri:"urn:personal",analysisBuiltIn:false,
   personalSessionPresent:true,personalReady:true,personalPolicyStage:"ready",
   analysisEligible:false}).status,"browse");
});
test("public native Analyze works without personal login; graph and Cancel still gate",()=>{
 assert.equal(decide({tab:"analyze",selectedAnalysisUri:"gttp://ggg.maestro.ecosys/analyze/table",analysisBuiltIn:true}).status,"admit");
 assert.equal(decide({tab:"analyze",queryReady:false}).status,"browse");
 assert.equal(decide({tab:"analyze",cancelled:true}).status,"browse");
 assert.equal(decide({tab:"view",personalReady:true,personalSessionPresent:true,personalPolicyStage:"ready"}).status,"admit");
});
test("denied entry clears rejected zone fields, preserving ordinary Browse state",()=>{
 const saved={workspaceTab:"analyze",viewPanel:"providers",selectedViewUri:"urn:view",viewProvider:"policies",selectedAnalysisUri:"urn:analysis",analyzeHistogram:true,centralTab:"view-query",querySourceFormat:"analysis-sparql",selectedUri:"urn:record",propertiesPage:3,graphText:"urn:graph",searchDraft:"John"};
 const result=sandbox.exports.browseFallbackUiState(saved);
 assert.equal(result.workspaceTab,"browse");assert.equal(result.viewPanel,"trail");assert.equal(result.viewProvider,null);
 assert.equal(result.selectedViewUri,"");assert.equal(result.selectedAnalysisUri,"");assert.equal(result.analyzeHistogram,false);
 assert.equal(result.centralTab,"results");assert.equal(result.querySourceFormat,"xml");
 for(const key of ["selectedUri","propertiesPage","graphText","searchDraft"])assert.equal(result[key],saved[key]);
 assert.equal(saved.workspaceTab,"analyze");assert.equal(saved.selectedAnalysisUri,"urn:analysis");
});
test("single admission precedes URL navigation; one live pane group and standard alert footer",()=>{
 const shell=read("src/canvas/workspace.tsx");
 const controller=read("src/canvas/utils/workspace-controller.tsx");
 assert.doesNotMatch(shell,/RestoredViewWaitPage|Preparing Analyze|waitingForSelectedView|pausedSideShell|Restoring saved pane layout/);
 assert.equal(fs.existsSync("src/canvas/restored-view-wait-page.tsx"),false);
 assert.equal((shell.match(/<ResizablePanelGroup\b/g)||[]).length,1);
 assert.doesNotMatch(controller,/arrivalRequestedTabRef|arrivalViewCheckedRef|arrivedViewUrlRef|decodedTabFromUrl|status === "pending"/);
 assert.match(controller,/const initialUiState = admitSavedUiState\(readShareableUiState\(arrivalSearchRef\.current \?\? undefined\), initialXml\)/);
 assert.match(controller,/restoreQueryAndUiState\(initialXml, initialUiState/);
 assert.match(controller,/setRestoredViewFallback\(decision\.reason\)/);
 assert.match(controller,/return browseFallbackUiState\(restored\)/);
 assert.match(controller,/arrivalSearchRef\.current = null/);
 assert.match(shell,/<AlertDialogFooter>\s*<AlertDialogAction onClick=\{workspace\.dismissRestoredViewFallback\}>Browse<\/AlertDialogAction>\s*<\/AlertDialogFooter>/);
 assert.doesNotMatch(shell,/originalUrl|Copy original URL/);
});
test("signed-out Browse does not repeatedly dispatch navigation",()=>{
 const source=read("src/canvas/utils/workspace-controller.tsx");
 const start=source.indexOf('if (!authRestoreComplete || authSession || personalStoreReady) return;');
 const effect=source.slice(start,source.indexOf('const bookmarkQueryKey',start));
 assert.match(effect,/if \(selection\.tab === "browse"/);
 assert.equal((effect.match(/queryViewController\.select\(/g)||[]).length,1);
 assert.doesNotMatch(effect,/setWorkspaceTab|setViewProvider/);
});
test("changed files parse as TypeScript / TSX",()=>{
 for(const f of ["src/lib/app-lifecycle/restored-view-entry.ts","src/canvas/utils/workspace-controller.tsx","src/canvas/workspace.tsx"]){
   const sf=ts.createSourceFile(f,read(f),ts.ScriptTarget.ES2022,true,f.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
   assert.deepEqual(sf.parseDiagnostics.map(e=>ts.flattenDiagnosticMessageText(e.messageText,"\n")),[]);
 }
});
