import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
const source = (name) => fs.readFileSync(path.join(project, name), 'utf8');

test('Record controller imports unanchored blank-node query from its actual DOM facade', () => {
  const controller = source('src/canvas/utils/workspace-controller.tsx');
  const facade = source('src/lib/bnode-dom.ts');
  const implementation = source('src/lib/bnode/dom.ts');
  assert.match(facade, /export \* from ["']\.\/bnode\/dom["']/);
  assert.match(implementation, /export function unanchoredBlankNodeRecordQuery\(/);
  assert.match(controller, /import \{[^\n]*unanchoredBlankNodeRecordQuery[^\n]*\} from ["']@\/lib\/bnode-dom["']/);
  assert.doesNotMatch(controller, /import \{[^\n]*unanchoredBlankNodeRecordQuery[^\n]*\} from ["']@\/lib\/bnode["']/);
});

test('Tag Cloud co-occurrence results augment stable facet tags instead of replacing them', () => {
  const cloud = source('src/canvas/left/personal-tag-cloud.tsx');
  assert.match(cloud, /distinctFacetValues\(\[\s*\.\.\.values,\s*\.\.\.\(cooccurring \?\? \[\]\)/);
  assert.match(cloud, /\[cooccurring, values\]/);
  assert.doesNotMatch(cloud, /cooccurring && cooccurring\.length > 0 \? cooccurring : values/);
});

test('Blank-node XState gate permits same-key reload after failure or a prior candidate result', () => {
  const lifecycle = source('src/lib/bnode/lifecycle.ts');
  assert.match(lifecycle, /failed:\s*\{\s*on:\s*\{\s*LOAD:\s*\{\s*guard:\s*"sameKey",\s*target:\s*"loading"/);
  assert.match(lifecycle, /ready:\s*\{\s*on:\s*\{\s*LOAD:\s*\{\s*guard:\s*"sameKey",\s*target:\s*"loading"/);
  assert.doesNotMatch(lifecycle, /ambiguous:\s*\{/);
  assert.match(lifecycle, /termType === "bnode"/);
});
