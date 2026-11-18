import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('XState preserves Browse Return and falls back to a displaced Bookmarks Perspective', () => {
  const nav = read('src/lib/app-lifecycle/operations.ts');
  assert.match(nav, /browseQueryKey: string; browseUrl: string/);
  assert.match(nav, /newBrowse = event\.tab === "browse" && !event\.isProviderQuery/);
  assert.match(nav, /context\.key === event\.sourceKey/);
  assert.match(nav, /event\.fromUrl/);
  assert.match(nav, /providerCommitted = event\.isProviderQuery && !event\.restoringHistory/);
  assert.match(nav, /returnUrl: abandoned \? "" : providerCommitted \? context\.pendingEntryUrl : context\.returnUrl/);
  assert.doesNotMatch(nav, /CONTEXT_REPLACED/);
});

test('Return restores the exact source tab instead of forcing Browse', () => {
  const w = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(w, /if \(tab === "browse" && operations\.controller\.getSnapshot\(\)\.navigation\.returnUrl/);
  assert.match(w, /function returnToPreviousContext\(\)/);
  assert.match(w, /if \(!restored \|\| restored\.workspaceTab === "browse"\)/);
  assert.match(w, /History\/Bookmarks are explicit Browse navigations, not ribbon hijacks/);
  assert.doesNotMatch(w, /type: "CONTEXT_REPLACED"/);
  const appbar = read('src/canvas/top/appbar-pane.tsx');
  assert.match(appbar, /returnShareUrl &&/);
  assert.match(appbar, /returnToPreviousContext\(\)/);
});

test('Kinds login discovery is direct SPARQL and documents issue #609', () => {
  const k = read('src/lib/client-kinds.ts');
  assert.match(k, /https:\/\/github\.com\/w3c\/data-shapes\/issues\/609/);
  assert.match(k, /SELECT DISTINCT \?provider \?kind \?pattern/);
  assert.match(k, /hydrateMaestroKinds\(entries\)/);
  assert.doesNotMatch(k, /validateShacl|runShacl|shaclRenderer/);
});
