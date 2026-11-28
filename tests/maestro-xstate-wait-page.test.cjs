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
test("authentication restoration has to resolve before the single decision",()=>{
 assert.equal(decide({authRestored:false}).status,"pending");
 assert.equal(decide({accessRestoring:true}).status,"pending");
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
test("waiting splash removed; existing Results skeleton does not mount inactive provider",()=>{
 const shell=read("src/canvas/workspace.tsx");
 const controller=read("src/canvas/utils/workspace-controller.tsx");
 assert.doesNotMatch(shell,/RestoredViewWaitPage|Preparing Analyze/);
 assert.equal(fs.existsSync("src/canvas/restored-view-wait-page.tsx"),false);
 assert.match(shell,/waitingForSelectedView \? <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4"/);
 assert.match(shell,/<ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1"><ResultsLoadingSkeleton wide \/><\/ResizablePanelGroup>/);
 assert.match(controller,/arrivalRequestedTabRef\.current/);
 assert.match(controller,/arrivalViewCheckedRef\.current/);
 assert.match(controller,/authRestored: authRestoreComplete/);
 assert.match(controller,/personalPolicyStage: accessSnapshot\.context\.policyStage/);
 assert.ok(controller.includes('queryViewController.select({ ...queryViewController.getSelection(), tab: "browse" })'));
});
test("changed files parse as TypeScript / TSX",()=>{
 for(const f of ["src/lib/app-lifecycle/restored-view-entry.ts","src/canvas/utils/workspace-controller.tsx","src/canvas/workspace.tsx"]){
   const sf=ts.createSourceFile(f,read(f),ts.ScriptTarget.ES2022,true,f.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
   assert.deepEqual(sf.parseDiagnostics.map(e=>ts.flattenDiagnosticMessageText(e.messageText,"\n")),[]);
 }
});
