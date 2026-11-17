import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('Perspectives is an FCT-backed Providers catalog with a telescope button and approval template', () => {
  const query = read('src/lib/provider-fct-query.ts');
  assert.match(query, /providerKind === "perspectives"/);
  assert.match(query, /PerspectiveWidget/);
  assert.match(query, /hasProviderFctFilters/);
  const ribbon = read('src/canvas/tab/view/ribbon.tsx');
  assert.match(ribbon, /id: "perspectives", label: "Perspectives", Icon: Telescope/);
  const xslt = read('src/lib/provider-catalog-xslt.ts');
  assert.match(xslt, /perspectives: `\$\{common\}/);
  assert.match(xslt, /data-policy-action="toggle"/);
});
test('Providers pagination shares the approval toolbar and has no duplicate footer', () => {
  const page = read('src/canvas/tab/view/page.tsx');
  assert.match(page, /<div className="ml-auto">\{viewPagination\}<\/div>/);
  assert.match(page, /!viewProvider && selectedView && <div/);
});
test('temporary store-readiness loss does not navigate away from a Providers query', () => {
  const ws = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(ws, /if \(!authRestoreComplete \|\| authSession \|\| personalStoreReady\) return;/);
  const key = ws.match(/const providerCatalogKey =[\s\S]*?: "";/)?.[0] ?? '';
  assert.ok(key.length > 0);
  assert.doesNotMatch(key, /matchingBookmarkId/);
});
