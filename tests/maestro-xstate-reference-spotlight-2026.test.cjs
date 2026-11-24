const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = file => fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');

test('XState owns selection lifecycle, preserved draft and cancel without committing',()=>{
  const source=read('src/lib/app-lifecycle/value-reference-picker.ts');
  assert.match(source,/"pickingReferenceTarget"/);
  assert.match(source,/START_PICK/);
  assert.match(source,/CANCEL_PICK/);
  assert.match(source,/PICK/);
  assert.match(source,/\{ \.\.\.context\.draft, targetId: event\.targetId \}/);
  assert.doesNotMatch(source,/replaceQueryTree|upsertValueBinding|fetch\(/);
});

test('Driver.js spotlight covers whole scrollable Query Tree and isolates other interactions',()=>{
  const source=read('src/canvas/utils/workspace-controller.tsx');
  const pane=read('src/canvas/tab/browse/page.tsx');
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.equal(pkg.dependencies['driver.js'],'^1.14.0');
  assert.equal(lock.packages['node_modules/driver.js'].version,'1.14.0');
  assert.match(source,/import\("driver\.js"\)/);
  assert.match(source,/driver\.js\/dist\/driver\.css/);
  assert.match(source,/document\.getElementById\("central-panel-query-tree"\)/);
  assert.match(source,/overlayClickBehavior: "none"/);
  assert.match(source,/disableActiveInteraction: false/);
  assert.match(source,/key === "Escape"/);
  assert.match(source,/pane\.contains\(event\.target\)/);
  assert.match(pane,/h-full overflow-auto p-3/);
  assert.match(pane,/onClickCapture=\{workspace\.captureReferenceTargetClick\}/);
});

test('Node selection restores dialog, validates before one atomic commit and rejects self reference',()=>{
  const source=read('src/canvas/utils/workspace-controller.tsx');
  const pane=read('src/canvas/tab/browse/page.tsx');
  assert.match(source,/referencePicker\.beginPicking\(\)/);
  assert.match(source,/referencePicker\.selectTarget\(id\)/);
  assert.match(source,/editor\.targetId === editor\.parentId/);
  assert.match(source,/inspectFctValueReferences\(next\);\s*replaceQueryTree\(next\)/);
  assert.match(source,/open=\{Boolean\(editor\) && !pickingReferenceTarget\}/);
  assert.match(pane,/Root \(whole query\)/);
  assert.match(source,/data-maestro-query-node=\{node\.id\}/);
  for(const filename of ['src/canvas/utils/workspace-controller.tsx','src/canvas/tab/browse/page.tsx','src/lib/app-lifecycle/value-reference-picker.ts']) {
    const parse=ts.createSourceFile(filename,read(filename),ts.ScriptTarget.Latest,true,filename.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    assert.equal(parse.parseDiagnostics.length,0,filename);
  }
});
