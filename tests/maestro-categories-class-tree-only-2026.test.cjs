const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('src/canvas/utils/workspace-controller.tsx','utf8');
const categories=fs.readFileSync('src/canvas/left/filter-pane.tsx','utf8');
const ts=require('typescript');
test('Categories hierarchy toggle persists in canonical FCT query',()=>{
  assert.match(categories,/setQueryAttribute\("classTree", categoriesTreeMode \? "false" : "true"\)/);
  assert.match(src,/const queryXml = serializeFctQuery\(queryTree\)/);
});
test('Derived Results, counts, Alphabet and other facets ignore category-only layout attribute',()=>{
  assert.match(src,/const queryPopulationTree = useMemo/);
  assert.match(src,/classTree: _categoriesLayout, \.\.\.attributes/);
  assert.match(src,/const queryResultsXml = serializeFctQuery\(queryPopulationTree\)/);
  assert.match(src,/setQueryViewAttributes\(ungroupForMembers\(queryPopulationTree\)/);
  assert.match(src,/const alphabetQueryXml = serializeFctQuery\(setQueryViewAttributes\(queryPopulationTree/);
  assert.match(src,/const queryCountXml = serializeFctQuery\(\s*setQueryViewAttributes\(queryPopulationTree/);
  assert.match(src,/const resultsRequestXml = serializeFctQuery\(setQueryViewAttributes\(queryPopulationTree/);
  assert.match(src,/const resultsCountSparql = buildFctCountSparql\(queryPopulationTree\)/);
  assert.match(src,/\[categoriesTreeMode, classFacetQueryXml/);
  assert.equal(ts.createSourceFile('workspace-controller.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length,0);
});
