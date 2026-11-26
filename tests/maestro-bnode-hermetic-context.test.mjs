import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function loadPureContext() {
  const code = ts.transpileModule(read('src/lib/bnode/context.ts'), {
    fileName: 'context.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports }, { filename: 'context.js' });
  return exports;
}

test('ordinary FCT requests never run a blank-node population probe or ancestry query', () => {
  const route = read('src/app/proxy/api/fct/route.ts');
  const compiler = read('src/lib/fct-sparql-translator.ts');
  assert.doesNotMatch(route, /createBlankNodePopulationGate|needsBlankNodeAncestry|contextualResult/);
  assert.doesNotMatch(compiler, /blankNodeAncestorPlan|recordParentProjection|AS \?sampleSubject/);
  assert.match(compiler, /Normal FCT results contain only normal value projections/);
  assert.match(read('src/canvas/utils/fct-response.ts'), /rdfBindingKind\(datatype\)/);
});

test('only an already-bound FCT URI path can provide a bnode Record anchor', () => {
  const ctx = loadPureContext();
  const uri = (id, text) => ({ id, name: 'value', text, attributes: { datatype: 'uri' }, children: [] });
  const focus = { id: 'f', name: 'property-of', attributes: { iri: 'urn:q' }, children: [] };
  const parent = { id: 'p', name: 'property', attributes: { iri: 'urn:p' }, children: [focus] };
  const direct = ctx.boundBlankNodeAnchorFromFct({ children: [uri('v', 'urn:Alice'), parent] }, [{id:'p'}, {id:'f'}]);
  assert.equal(direct.parent, 'urn:Alice');
  assert.equal(direct.depth, 0);
  assert.equal(direct.direction, 'reverse');
  const intermediate = ctx.boundBlankNodeAnchorFromFct({ children: [{...parent,children:[uri('v2','urn:Intermediate'),focus]}] }, [{id:'p'},{id:'f'}]);
  assert.equal(intermediate.parent, 'urn:Intermediate');
  assert.equal(intermediate.depth, 1);
  assert.equal(ctx.boundBlankNodeAnchorFromFct({ children: [uri('a', 'urn:A'), uri('b', 'urn:B'), parent] }, [{id:'p'}]), undefined);
  assert.equal(ctx.boundBlankNodeAnchorFromFct({ children: [uri('v','urn:Alice'), parent] }, [{id:'nonexistent'}]), undefined);
  assert.equal(ctx.boundBlankNodeAnchorFromFct({ children: [parent] }, [{id:'p'}]), undefined);
  assert.match(read('src/lib/bnode/dom.ts'), /The chosen URI anchor conflicts with existing FCT value bindings/);
});

test('generic FCT parsing has no leftover sampled-ancestor handoff', () => {
  const response = read('src/canvas/utils/fct-response.ts');
  const main = read('src/canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(response, /recordAnchor|blankNodeRecordAnchorFromColumns|recordParent/);
  assert.doesNotMatch(main, /currentRecordIdentity\?\.recordAnchor/);
  assert.match(response, /rdfBindingKind\(datatype\)/);
});

test('XState guards only already-decoded selected blank-node Records and automatic response-local sibling selection', () => {
  const lifecycle = read('src/lib/bnode/lifecycle.ts');
  const route = read('src/app/proxy/api/fct/route.ts');
  const main = read('src/canvas/utils/workspace-controller.tsx');
  const pivot = read('src/canvas/controllers/record-session-controller.tsx');
  const core = read('src/canvas/right/record.tsx');
  assert.doesNotMatch(lifecycle, /PAGE_RECEIVED|containsBlankNodePopulation|observedBlankNode/);
  assert.match(lifecycle, /isBlankRecord:[\s\S]*?termType === "bnode"/);
  assert.match(lifecycle, /if \(termType === "bnode"\) activeActor\(\)/);
  assert.match(lifecycle, /CANDIDATES_RECEIVED:[\s\S]*?target: "ready"[\s\S]*?selected: event.initial/);
  assert.doesNotMatch(lifecycle, /selected: context\.selected[\s\S]*? : 0/);
  assert.match(lifecycle, /chooseValid:[\s\S]*?event\.index < context\.candidates/);
  assert.doesNotMatch(route, /createBlankNodePopulationGate|needsBlankNodeAncestry/);
  assert.match(main, /selectedRecordTermType === "bnode"[\s\S]*?blankNodeContext\.begin\(\)/);
  assert.match(pivot, /recordTermType === "bnode"[\s\S]*?own\.blankNodeContext\.begin\(\)/);
  assert.match(main, /unanchoredBlankNodeRecordQuery/);
  assert.match(read('src/lib/bnode/client-record.ts'), /responseScope: "request"/);
  assert.doesNotMatch(read('src/app/proxy/api/sparql/route.ts'), /body\?\.recordBlankNodes/);
  assert.match(core, /blankNodeContext\.choose\(index\)/);
  assert.match(lifecycle, /context\.membership\[context\.seed\]\?\.parents\.some\(parent =>/);
  assert.doesNotMatch(main, /Math\.max\(\s*0,\s*records\.findIndex/);
});

test('all modified TypeScript modules parse; generic graph marshalling delegates bnode path', () => {
  const modules = [
    'src/lib/bnode/index.ts', 'src/lib/bnode/context.ts', 'src/lib/bnode/lifecycle.ts', 'src/lib/bnode/client-record.ts',
    'src/lib/bnode/dom.ts', 'src/lib/bnode/record-graphs.ts',
    'src/lib/fct-sparql-translator.ts', 'src/lib/record-graph-marshalling.ts',
    'src/app/proxy/api/fct/route.ts', 'src/canvas/utils/fct-response.ts',
    'src/canvas/utils/workspace-controller.tsx', 'src/canvas/controllers/record-session-controller.tsx',
    'src/canvas/right/pane.tsx', 'src/canvas/right/record.tsx',
    'src/canvas/right/record-explorer.tsx', 'src/lib/client-query-cache.ts',
  ];
  for (const mod of modules) {
    const parsed = ts.createSourceFile(mod, read(mod), ts.ScriptTarget.ES2022, true,
      mod.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(parsed.parseDiagnostics.length, 0, `${mod}: ${parsed.parseDiagnostics.map(d => d.messageText).join('; ')}`);
  }
  assert.match(read('src/lib/record-graph-marshalling.ts'), /blankNodeGraphFctQuery\(blankQueryXml, limits\)/);
});
