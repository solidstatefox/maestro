"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

// Test the exact production readiness selector, not a rewritten approximation.
const selectorSource = read("src/lib/app-lifecycle/restored-view-readiness.ts");
const compiled = ts.transpileModule(selectorSource, {
  fileName: "restored-view-readiness.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const readiness = input => JSON.parse(JSON.stringify(sandbox.exports.restoredViewReadiness({
  tab: "browse", hydrated: true, queryReady: true, personalReady: false,
  personalSessionPresent: false, personalPolicyStage: "unavailable",
  selectedAnalysisUri: "", analysisBuiltIn: true, analysisEligible: false, ...input,
})));

test("unrestored URL stays unexecuted, then selected graph startup waits without an error", () => {
  const restoring = readiness({tab:"view", hydrated:false});
  assert.equal(restoring.ready, false);assert.equal(restoring.blockedOn,"url");assert.equal(restoring.skeleton,true);
  const graph = readiness({tab:"analyze", queryReady:false});
  assert.equal(graph.ready,false);assert.equal(graph.blockedOn,"graph");assert.equal(graph.skeleton,true);
});
test("deep-linked View preserves selection but requests Connect rather than running an offstage query", () => {
  const gated=readiness({tab:"view", personalSessionPresent:false});
  assert.equal(gated.ready,false);assert.equal(gated.blockedOn,"personal");assert.equal(gated.skeleton,false);
  assert.match(gated.reason,/Connect/);
});
test("signed-in View waits for seeding and verification, without falsely requiring another login", () => {
  for (const stage of ["seeding","verifying"]) {
    const r=readiness({tab:"view", personalSessionPresent:true, personalPolicyStage:stage});
    assert.equal(r.ready,false);assert.equal(r.skeleton,true);assert.match(r.reason,/policies/);
  }
  const failed=readiness({tab:"view", personalSessionPresent:true, personalPolicyStage:"failed"});
  assert.equal(failed.ready,false);assert.equal(failed.skeleton,false);assert.match(failed.reason,/initialization/);
  assert.equal(readiness({tab:"view",personalReady:true,personalSessionPresent:true,personalPolicyStage:"ready"}).ready,true);
});
test("public builtin Analyze never waits for personal seeding or login", () => {
  const r=readiness({tab:"analyze",selectedAnalysisUri:"urn:maestro:analyze:predicate-clusters",analysisBuiltIn:true});
  assert.equal(r.ready,true);assert.equal(r.blockedOn,null);
});
test("restored personal Analyze waits for login, seeding and exact eligibility in order",()=>{
  const input={tab:"analyze",selectedAnalysisUri:"urn:provider:personal",analysisBuiltIn:false};
  assert.equal(readiness({...input}).blockedOn,"personal");
  assert.equal(readiness({...input,personalSessionPresent:true,personalPolicyStage:"seeding"}).blockedOn,"personal");
  const eligibility=readiness({...input,personalReady:true,personalSessionPresent:true,personalPolicyStage:"ready",analysisEligible:false});
  assert.equal(eligibility.ready,false);assert.equal(eligibility.blockedOn,"provider");
  assert.equal(readiness({...input,personalReady:true,personalSessionPresent:true,personalPolicyStage:"ready",analysisEligible:true}).ready,true);
});
test("Browse remains public and independent of personal policies",()=>{
  assert.equal(readiness({tab:"browse"}).ready,true);
});
test("the XState view worker begins waiting and cannot invoke until SET_READY",()=>{
  const source=read("src/lib/app-lifecycle/query-view-ownership.ts");
  assert.match(source,/initial: "waiting"/);
  assert.match(source,/SET_READY: \[/);
  assert.match(source,/waiting: \{ on: \{ EXECUTE: \{ actions:/);
  assert.match(source,/foreground: \{\s*invoke: \{ id: "view-operations", src: "operations" \}/);
  assert.match(source,/target: "\.waiting", reenter: true/);
  assert.match(source,/getSnapshot\(\)\.matches\("foreground"\)/);
});
test("URL admission occurs before restoring selection, not in a deferred effect",()=>{
  const owner=read("src/canvas/utils/workspace-controller.tsx");
  const shell=read("src/canvas/workspace.tsx");
  assert.doesNotMatch(owner,/arrivalViewCheckedRef|arrivalRequestedTabRef|arrivedViewUrlRef/);
  assert.match(owner,/const decision = decideRestoredViewEntry\(/);
  assert.match(owner,/const access = accessController\.getSnapshot\(\)/);
  assert.match(owner,/personalReady: selectMaestroCapabilities\(access\)\.canUsePersonalStore/);
  assert.match(owner,/setRestoredViewFallback\(decision\.reason\)/);
  assert.match(owner,/return browseFallbackUiState\(restored\)/);
  assert.match(shell,/<AlertDialog open=\{Boolean\(workspace\.restoredViewFallback\)\}/);
  assert.match(shell,/<AlertDialogFooter>[\s\S]*?<AlertDialogAction onClick=\{workspace\.dismissRestoredViewFallback\}>Browse<\/AlertDialogAction>/);
  assert.doesNotMatch(shell,/RestoredViewWaitPage|pausedSideShell|waitingForSelectedView|Copy original URL/);
  assert.match(shell,/<LeftCanvasPanel workspace=\{workspace\} \/>/);
  assert.match(shell,/<RightCanvasPanel workspace=\{workspace\} \/>/);
});
test("scoped FCT provider queries are not incorrectly marked Browse",()=>{
  const client=read("src/lib/fct-client.ts");
  const population=read("src/lib/overview-population.ts");
  assert.match(client,/export async function fctProjectPage[\s\S]*?scope: MaestroQueryScope/);
  assert.match(client,/"x-maestro-view-tab": scope\.tab, "x-maestro-view-ribbon": scope\.ribbon/);
  assert.match(population,/fctRead\(cloneOverviewPopulationQuery\(queryXml\), signal, \{ tab: "analyze", ribbon: NODE_ANALYTICS_ANALYSIS_URI \}\)/);
});
test("Shared query and Record work do not depend on the presentation tab",()=>{
  const source=read("src/canvas/utils/workspace-controller.tsx");
  const gates=source.match(/workspaceTab !== "browse" \|\| !viewActorSnapshot\.matches\("foreground"\)/g)??[];
  assert.equal(gates.length,0);
  assert.match(source,/queryViewController\.observeScope\("shared", sharedScopeKey, sharedExecutionReady\)/);
  assert.match(source,/queryViewController\.observeScope\("record", recordScopeKey, sharedExecutionReady\)/);
  assert.match(source,/const endpointReady = endpointReadyForQuery && canExecuteMaestroQuery && sharedExecutionReady/);
  assert.match(source,/workspaceTab !== "analyze" \|\| !viewActorSnapshot\.matches\("foreground"\)/);
  assert.doesNotMatch(source,/abortOffstageMaestroQueries|viewQueueSelectionRef/);
});
test("all modified source files parse as TypeScript/TSX",()=>{
 for(const file of [
  "src/canvas/workspace.tsx", "src/canvas/utils/workspace-controller.tsx",
  "src/lib/app-lifecycle/restored-view-readiness.ts","src/lib/app-lifecycle/query-view-ownership.ts",
  "src/lib/fct-client.ts","src/lib/overview-population.ts",
 ]){
  const src=ts.createSourceFile(file,read(file),ts.ScriptTarget.ES2022,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(src.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[],file);
 }
});
