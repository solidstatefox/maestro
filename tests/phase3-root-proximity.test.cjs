const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const file = name=>fs.readFileSync(path.join(__dirname, '..', name),'utf8');

test('root collapse uses existing XState with 40px buffer and 300ms delay',()=>{
  const fsm=file('src/lib/app-lifecycle/root-breadcrumb.ts');
  const proximity=file('src/lib/app-lifecycle/root-proximity.ts');
  assert.match(fsm,/POINTER_NEAR.*POINTER_AWAY/);
  assert.match(fsm,/leaving:\s*\{/);
  assert.match(fsm,/after:\s*\{ 300: \{ target: "#root-resting", actions: assign/);
  assert.match(fsm,/labelHovered: false, inputFocused: false, pointerAway: false/);
  assert.match(fsm,/1200:\s*\[/);
  assert.match(proximity,/ROOT_EDITOR_PROXIMITY_PX = 40/);
  assert.doesNotMatch(fsm,/LABEL_LEAVE: \[\s*\{ guard: \(\{ context \}\) => !context.inputFocused, target: "resting"/);
});
test('pointer proximity is limited to root editor, excludes touching popup and keyboard activity',()=>{
  const c=file('src/canvas/utils/workspace-controller.tsx');
  const r=file('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(c,/if \(!rootSearchExpanded \|\| rootAutocompleteInspectorOpen\) return/);
  assert.match(c,/rootPointerIsNear\(event.clientX, event.clientY, rectangles\)/);
  assert.match(c,/data-slot="combobox-content"/);
  assert.match(c,/document.addEventListener\("pointermove"/);
  assert.match(r,/type: "EDIT_ACTIVITY"/);
  assert.match(r,/event.key === "Escape"/);
  assert.match(r,/!event\.nativeEvent\.isComposing/);
  assert.doesNotMatch(r,/!event\.isComposing/);
});
test('new and modified TypeScript parses',()=>{
  for(const p of ['src/lib/app-lifecycle/root-breadcrumb.ts','src/lib/app-lifecycle/root-proximity.ts','src/canvas/utils/workspace-controller.tsx','src/canvas/top/breadcrumb-renderers.tsx']){
    const fileName=path.join(__dirname,'..',p); const source=ts.createSourceFile(fileName,fs.readFileSync(fileName,'utf8'),ts.ScriptTarget.Latest,true,p.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.deepEqual(source.parseDiagnostics.map(d=>String(d.messageText)),[],p);
  }
});

test('proximity geometry includes the 40px buffer and the portaled popup',()=>{
  const vm=require('node:vm');
  const p=file('src/lib/app-lifecycle/root-proximity.ts');
  const js=ts.transpileModule(p, { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020 }}).outputText;
  const context={ exports:{} };vm.runInNewContext(js,context);
  const {rootPointerIsNear,ROOT_EDITOR_PROXIMITY_PX}=context.exports;
  assert.equal(ROOT_EDITOR_PROXIMITY_PX,40);
  const editor={left:100,right:200,top:100,bottom:140};
  const popup={left:100,right:200,top:160,bottom:250};
  assert.equal(rootPointerIsNear(160,180,[editor,popup]),true);
  assert.equal(rootPointerIsNear(60,140,[editor]),true,'40 pixels from edge is inside');
  assert.equal(rootPointerIsNear(59,140,[editor]),false,'41 pixels from edge closes');
  assert.equal(rootPointerIsNear(250,140,[editor,popup]),false);
});

test('root hover duration follows the Sheet setting rather than a hardcoded XState timer',()=>{
  const machine=file('src/lib/app-lifecycle/root-breadcrumb.ts');
  const prefs=file('src/lib/root-breadcrumb-settings.ts');
  assert.match(machine,/delays:\s*\{ rootHoverDelay:\s*\(\) => readRootHoverDelayMs\(\)/);
  assert.match(machine,/rootHoverDelay:\s*\{ guard:/);
  assert.match(prefs,/DEFAULT_ROOT_HOVER_DELAY_MS = 2000/);
});
