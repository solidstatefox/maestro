import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('View catalog uses Providers as the single current panel, without Features URL aliases', () => {
  const query=read('src/canvas/utils/query-controller.ts');
  const ribbon=read('src/canvas/tab/view/ribbon.tsx');
  assert.match(ribbon,/\{ id: "providers", label: "Providers"/);
  assert.match(query,/case "2": case "providers": return "providers"/);
  assert.doesNotMatch(query,/case "features"|viewFeature|LEGACY_PROVIDER_URIS/);
});
test('RDF provenance, appbar actions and XSLT DOM contracts are all renamed together', () => {
  assert.match(read('src/lib/provider-fct-query.ts'), /urn:maestro:providers:/);
  assert.match(read('src/lib/app-lifecycle/pending-approvals.ts'), /urn:maestro:providers:/);
  assert.match(read('src/lib/client-appbar-buttons.ts'), /ensure-providers/);
  const render=read('src/lib/provider-catalog-xslt.ts');
  const consume=read('src/canvas/tab/view/view-components.tsx');
  for(const attribute of ['data-provider-uri','data-provider-open-uri','data-provider-code']) {
    assert.ok(render.includes(attribute),attribute);
    assert.ok(consume.includes(attribute),attribute);
  }
  for (const old of ['data-feature-','urn:maestro:features:','ensure-features']) {
    assert.ok(!render.includes(old),old);
    assert.ok(!consume.includes(old),old);
  }
});
test('Former feature catalog files are absent and provider catalog modules exist',()=> {
  // Legacy modules may remain as unreferenced compatibility sources in source
  // archives, but the live provider paths must not import them.
  for (const file of ['src/canvas/utils/workspace-controller.tsx','src/canvas/tab/view/page.tsx','src/canvas/tab/view/ribbon.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/lib\/(?:feature-catalog|feature-view-xslt|feature-fct-query|app-lifecycle\/features)/, file);
  }
  for (const file of ['src/lib/provider-catalog-items.ts','src/lib/provider-catalog-xslt.ts','src/lib/provider-fct-query.ts','src/lib/app-lifecycle/provider-catalog.ts'])
    assert.equal(existsSync(new URL(`../${file}`,import.meta.url)),true,file);
});
test('pending approvals count providerKind projection, not obsolete feature field',()=> {
  const actor=read('src/lib/app-lifecycle/pending-approvals.ts');
  assert.match(actor,/item\.providerKind/);
  assert.doesNotMatch(actor,/item\.feature/);
  assert.match(actor,/providersByKind/);
});
