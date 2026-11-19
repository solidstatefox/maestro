import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Sunburst receives category tree roots from the workspace controller through its typed pane contract', () => {
  const controller = source('src/canvas/utils/workspace-controller.tsx');
  const contracts = source('src/canvas/controllers/workspace-interfaces.ts');
  const pane = source('src/canvas/left/filter-pane.tsx');
  assert.match(controller, /const categoryTreeRoots:\s*CategoryTreeNode\[\]/);
  assert.match(controller, /categoryTreeAllCollapsed,\s*categoryTreeRoots,\s*categoryTreePages,/);
  assert.match(contracts, /"categoryTreeAllCollapsed"\s*\|\s*"categoryTreeRoots"\s*\|\s*"categoryTreePages"/);
  assert.match(pane, /categoryTreeAllCollapsed,\s*categoryTreeRoots,\s*categoryTreePages,/);
  assert.match(pane, /<FacetPresentationSurface\s+presentation=\{classPresentation\}\s+tree=\{categoryTreeRoots\}/);
});
