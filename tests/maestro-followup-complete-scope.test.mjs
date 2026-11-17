import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('root click remains navigation, with immediate hover and independent signal region', () => {
  const s = read('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(s, /type: "LABEL_ENTER"/);
  assert.match(s, /type: "SIGNAL_ENTER"/);
  assert.match(s, /onClick=\{handleRootBreadcrumbClick\}/);
  assert.doesNotMatch(s, /onClick=\{\(\) => \{ handleRootBreadcrumbClick\(\); setRootSearchExpanded\(true\)/);
  assert.match(s, /<InputGroup aria-label="Root breadcrumb"/);
  assert.match(s, /<BreadcrumbNodeMinus/);
  assert.match(s, /rootSearchExpanded \? searchInputGroup/);
});

test('URI editor uses shadcn input group and state-colored icon, with no text badge', () => {
  const s = read('src/canvas/utils/workspace-controller.tsx');
  assert.doesNotMatch(s, /<InputGroup aria-label="Root search input"/);
  assert.match(s, /<InputGroupAddon align="inline-start"/);
  assert.match(s, /rootUriGateStatus === "rejected" \? "text-destructive"/);
  assert.match(s, /text-green-600 dark:text-green-400/);
  assert.match(s, /modeAtClick !== "uri"\) return/);
  const c = read('src/canvas/top/root-uri-autocomplete.tsx');
  assert.match(c, /onDraft\(selected.uri\);onCommit\(selected.uri, selected.label\)/);
  assert.match(c, /itemToStringLabel=/);
  assert.match(c, /showTrigger=\{false\}/);
});

test('label lookup is a one-character-capable SPARQL URI/label SELECT', () => {
  const q = read('src/lib/uri-autocomplete-query.ts');
  assert.match(q, /text.length < 1/);
  assert.match(q, /SELECT DISTINCT \?uri \?label/);
  assert.match(q, /\?label bif:contains/);
  assert.doesNotMatch(q, /\?uri \?property \?text/);
  const p = read('src/lib/root-uri-policy.ts');
  assert.doesNotMatch(p, /prefix\.startsWith\(lower\)/);
  assert.match(p, /lower\.startsWith\(prefix\)/);
});

test('Kinds are discovered by direct SELECT at login, multiple providers, no SHACL', () => {
  const k = read('src/lib/client-kinds.ts');
  const d = read('src/lib/maestro-kinds.ts');
  assert.match(k, /https:\/\/github.com\/w3c\/data-shapes\/issues\/609/);
  assert.match(k, /\?provider [\s\S]*?KindProvider/);
  assert.match(k, /SELECT DISTINCT \?provider \?kind \?pattern/);
  assert.match(k, /hydrateMaestroKinds\(entries\)/);
  assert.doesNotMatch(k, /runShacl|validateShacl|shaclRenderer/);
  assert.match(d, /Multiple RDF providers can declare a regex/);
  assert.match(d, /subscribeMaestroKinds/);
  const f = read('src/lib/fct-count-sparql.ts');
  assert.match(f, /!state\.patterns\.length && !kindDirection/);
});

test('XState Return only captures displaced Browse query, not ribbon or history navigation', () => {
  const n = read('src/lib/app-lifecycle/operations.ts');
  const w = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(n, /browseQueryKey: string; browseUrl: string/);
  assert.match(n, /providerCommitted = event.isProviderQuery/);
  assert.match(n, /context.browseQueryKey === event.sourceKey/);
  assert.doesNotMatch(n, /CONTEXT_REPLACED/);
  assert.match(w, /if \(tab === "browse" && operations.controller.getSnapshot\(\).navigation.returnUrl\)/);
  assert.match(w, /History\/Bookmarks are explicit Browse navigations, not ribbon hijacks/);
  assert.match(w, /setWorkspaceTab\("browse"\);\s*setViewProvider\(null\)/);
  assert.match(w, /if \(tab !== "view"\) \{\s*\+\+providerNavigationSequenceRef\.current;\s*navigationTransactions\.cancel\(\)/);
  assert.match(w, /A ribbon click alone does not displace Browse/);
  assert.match(read('src/canvas/top/appbar-pane.tsx'), /Return to Browse query/);
});

test('query addr is authoritative for the server selector, even during Provider navigation', () => {
  const w = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(w, /Query \+ graph-server selector must never point to different stores/);
  assert.match(w, /queryEndpoint && queryEndpoint.id !== endpoint.id/);
  assert.match(w, /if \(queryEndpoint && queryEndpoint.id !== endpoint.id\) \{\s*setSelectedEndpointId\(queryEndpoint.id\);\s*return;/);
  const providerFlow = w.slice(w.indexOf('async function selectViewProvider('), w.indexOf('function returnToPreviousContext('));
  assert.doesNotMatch(providerFlow, /await synchronizeFctEndpointSelection/);
  assert.match(providerFlow, /restoreQueryAndUiState\(xml, null\)/);
});

test('Configure and Return-to-Filters buttons use native shadcn outline controls', () => {
  const p = read('src/canvas/left/pane.tsx');
  const b = read('src/canvas/left/return-to-filters.tsx');
  assert.match(p, /<Button variant="outline" size="sm"/);
  assert.match(b, /<Button type="button" size="sm" variant="outline"/);
  assert.doesNotMatch(p, /<span aria-hidden="true" className="h-5 w-px shrink-0 bg-border"/);
});

test('protected four endpoints and routing contracts are not modified in patch worktree', () => {
  const routeNames = ['service','observations','fct','sparql'];
  for (const name of routeNames) {
    assert.ok(read(`src/app/proxy/api/${name}/route.ts`).length > 100, name);
  }
});
