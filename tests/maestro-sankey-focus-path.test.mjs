import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const project=fs.readFileSync('src/lib/sankey-coverage.ts','utf8');
const canvas=fs.readFileSync('src/canvas/tab/analyze/sankey.tsx','utf8');
test('Sankey scope node uses focus breadcrumb path, not generic FCT page',()=>{
  assert.match(project,/focusPath\.trim\(\)/);
  assert.match(project,/name:focusPath/);
  assert.match(canvas,/workspace\.analyzeBreadcrumbTrail\.slice\(0, workspace\.activeBreadcrumbIndex \+ 1\)/);
  assert.match(canvas,/projectSankeyCoverage\(axes,resources,focusPath\)/);
  assert.doesNotMatch(project,/name:"FCT page"/);
});
test('prebuild removes retired Sunburst and unused chart kit without touching provider RDF',()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const cleaner=fs.readFileSync('tools/clean-obsolete-sunburst.mjs','utf8');
  assert.match(pkg.scripts.prebuild,/clean-obsolete-sunburst/);
  assert.match(pkg.scripts.pretest,/clean-obsolete-sunburst/);
  assert.match(cleaner,/category-sunburst\.tsx/);
  assert.match(cleaner,/rmSync\(obsoleteDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(cleaner,/src\/components\/ui\/charts/);
  assert.doesNotMatch(cleaner,/rmSync\([^)]*graph\//);
});
