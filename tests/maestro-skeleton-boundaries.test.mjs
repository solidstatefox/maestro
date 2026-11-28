import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectWorkspaceSkeletonBoundaries, selectLeftPaneSkeletonWidgets } from '../src/lib/app-lifecycle/skeleton-boundaries.ts';

const base = {
  hydrated: true,
  tab: 'browse',
  graphPhase: 'ready',
  queryPhase: 'ready',
  registryReady: true,
  endpointReady: true,
  endpointFailed: false,
  facetsLoading: false,
  facetContentPresent: true,
  facetFailed: false,
  initialQueryStarted: true,
  recordSelected: false,
  recordLoading: false,
  recordReady: false,
  recordFailed: false,
};
const select = (facts) => selectWorkspaceSkeletonBoundaries({ ...base, ...facts });

test('hydration shows shell, navigation and region placeholders without mounting provisional queries', () => {
  const value = select({ hydrated: false, graphPhase: 'unknown', queryPhase: 'restoring', registryReady: false, endpointReady: false });
  assert.equal(value.shell, 'loading');
  assert.equal(value.graphSelector, 'loading');
  assert.equal(value.facets, 'loading');
  assert.equal(value.results, 'loading');
  assert.equal(value.record, 'loading');
});
test('graph checks cannot hide an otherwise ready Record region', () => {
  const value = select({ graphPhase: 'checking', endpointReady: false, recordSelected: true, recordReady: true });
  assert.equal(value.facets, 'ready');
  assert.equal(value.results, 'ready');
  assert.equal(value.record, 'ready');
});
test('failed graph checks display degraded fixtures without error billboards', () => {
  const value = select({ graphPhase: 'unavailable', endpointReady: false, endpointFailed: true });
  assert.equal(value.graphSelector, 'error');
  assert.equal(value.facets, 'ready');
  assert.equal(value.results, 'ready');
  assert.equal(value.record, 'ready');
});
test('a failed registry discovery does not leave an infinite graph selector skeleton', () => {
  assert.equal(select({ registryReady: false, endpointReady: false, endpointFailed: true }).graphSelector, 'error');
});
test('a retry from unavailable to checking and ready restores regions', () => {
  assert.equal(select({ graphPhase: 'unavailable', endpointReady: false, endpointFailed: true }).results, 'ready');
  assert.equal(select({ graphPhase: 'checking', endpointReady: false }).results, 'ready');
  assert.equal(select({ graphPhase: 'ready', endpointReady: true }).results, 'ready');
});
test('facets reveal available partial results while unrelated facet queries continue', () => {
  assert.equal(select({ facetsLoading: true, facetContentPresent: false }).facets, 'ready');
  assert.equal(select({ facetsLoading: true, facetContentPresent: true }).facets, 'ready');
  assert.equal(select({ facetsLoading: false, facetContentPresent: false, facetFailed: true }).facets, 'ready');
});
test('Record loading is independent; empty Record panes are not loading', () => {
  assert.equal(select({ recordSelected: false, recordLoading: true }).record, 'ready');
  assert.equal(select({ recordSelected: true, recordLoading: true }).record, 'ready');
  assert.equal(select({ recordSelected: true, recordLoading: true, recordReady: true }).record, 'ready');
  assert.equal(select({ recordSelected: true, recordFailed: true }).record, 'ready');
});
test('View and Analyze content are not replaced solely because graph health changes', () => {
  for (const tab of ['view', 'analyze']) {
    const value = select({ tab, graphPhase: 'unavailable', endpointReady: false, endpointFailed: true });
    assert.equal(value.results, 'ready');
  }
});
test('initial Browse query skeleton releases to the live result clocks after execution starts', () => {
  assert.equal(select({ initialQueryStarted: false, queryPhase: 'readyToExecute' }).results, 'ready');
  assert.equal(select({ initialQueryStarted: true, queryPhase: 'readyToExecute' }).results, 'ready');
  assert.equal(select({ initialQueryStarted: true, queryPhase: 'executing' }).results, 'ready');
});
test('composition uses one resizable group and no full-workspace skeleton switch', () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const workspace = fs.readFileSync(path.resolve(directory, '../src/canvas/workspace.tsx'), 'utf8');
  const view = fs.readFileSync(path.resolve(directory, '../src/canvas/tab/view/view-components.tsx'), 'utf8');
  const appbar = fs.readFileSync(path.resolve(directory, '../src/canvas/top/appbar-pane.tsx'), 'utf8');
  assert.equal((workspace.match(/<ResizablePanelGroup\b/g) || []).length, 1);
  assert.doesNotMatch(workspace, /<WorkspaceSkeleton\b/);
  assert.doesNotMatch(workspace, /if\s*\(!urlStateInitialized\)\s*return\s+null/);
  assert.match(workspace, /selectWorkspaceSkeletonBoundaries\(/);
  assert.doesNotMatch(workspace, /<RecordLoadingSkeleton\s*\/>/);
  assert.doesNotMatch(workspace, /<AppbarLoadingSkeleton\s*\/>/);
  assert.doesNotMatch(workspace, /<RibbonLoadingSkeleton\s*\/>/);
  assert.match(workspace, /<AppBarSection workspace=\{workspace\} \/>/);
  assert.match(workspace, /<RightCanvasPanel workspace=\{workspace\} \/>/);
  // An anchor from the prior Browse scope must be checked against the current
  // authoritative tree before its Personal listener mounts on Bookmarks/History.
  assert.match(workspace, /urlStateInitialized && workspaceTab === "browse" && workspace\.viewExecutionReady && endpointReadyForQuery && personalWidgets\.filter\(\(widget\) =>/);
  assert.match(workspace, /activeTransportedFacets\(queryTree\)/);
  assert.match(workspace, /sameTransportedFacetIdentity\(candidate, widget\.anchor\)/);
  assert.doesNotMatch(workspace, /hop === widget\.anchor\?\.path\[index\]/);
  assert.match(workspace, /\}\)\.map\(\(widget\) => \(\s*<PersonalWidgetQueryListener/);
  assert.match(view, /<ProviderCatalogLoadingSkeleton\b/);
  assert.match(appbar, /Loading graph servers/);
});

test('Configure skeleton shows Properties and Roles only, respecting Configure order', () => {
  const empty = { pane: 'facets', focusListOrder: 'Properties', showStatus: true, showPropertyUsage: true,
    focusWidgetsSuppressed: false,
    transported: [{ key: 'a1', title: 'Transported facet' }],
    personalRoles: [{ key: 'r1', title: 'Personal role' }],
    personalProperties: [{ key: 'p1', title: 'Personal facet' }] };
  assert.deepEqual(selectLeftPaneSkeletonWidgets(empty).map(item => item.title), ['Properties', 'Roles']);
  assert.deepEqual(selectLeftPaneSkeletonWidgets({ ...empty, focusListOrder: 'Roles' }).map(item => item.title), ['Roles', 'Properties']);
});

test('Filters skeleton includes only eligible, current-scope Filter widgets in live display order', () => {
  const facts = { pane: 'personal', focusListOrder: 'Properties', showStatus: true, showPropertyUsage: true,
    focusWidgetsSuppressed: false,
    transported: [{ key: 'a1', title: 'author › name' }],
    personalRoles: [{ key: 'r1', title: 'initiator of' }],
    personalProperties: [{ key: 'p1', title: 'release date' }, { key: 'p2', title: 'rating' }] };
  assert.deepEqual(selectLeftPaneSkeletonWidgets(facts).map(item => item.title),
    ['Status', 'author › name', 'Subjects', 'Objects', 'Categories', 'initiator of', 'release date', 'rating', 'Graphs']);
  assert.ok(selectLeftPaneSkeletonWidgets(facts).every(widget => !widget.key.startsWith('configure:')));
});

test('Filters respects the bookmark Status gate and suppresses Focus Personal widgets', () => {
  const facts = { pane: 'personal', focusListOrder: 'Roles', showStatus: false, showPropertyUsage: false,
    focusWidgetsSuppressed: true,
    transported: [], personalRoles: [{ key: 'r1', title: 'Role' }], personalProperties: [{ key: 'p1', title: 'Property' }] };
  assert.deepEqual(selectLeftPaneSkeletonWidgets(facts).map(widget => widget.title), ['Categories', 'Graphs']);
  assert.deepEqual(selectLeftPaneSkeletonWidgets({ ...facts, pane: 'community' }), []);
  assert.deepEqual(selectLeftPaneSkeletonWidgets({ ...facts, showStatus: true }).map(widget => widget.title), ['Status', 'Categories', 'Graphs']);
});

test('Filters Personal widgets are not duplicated by a stale per-query widget projection', () => {
  const widgets = selectLeftPaneSkeletonWidgets({
    pane: 'personal', focusListOrder: 'Properties', showStatus: false, showPropertyUsage: false,
    focusWidgetsSuppressed: false, transported: [], personalRoles: [],
    personalProperties: [{ key: 'http://x/label', title: 'label' }, { key: 'http://x/label', title: 'label' }],
  });
  assert.equal(widgets.filter(widget => widget.title === 'label').length, 1);
});

test('loading left region uses live pane mode, and navigation remains available during graph checks', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = fs.readFileSync(path.join(root, 'src/canvas/workspace.tsx'), 'utf8');
  const pane = fs.readFileSync(path.join(root, 'src/canvas/workspace-skeleton.tsx'), 'utf8');
  assert.match(workspace, /facetsLoading: leftPaneLoading/);
  assert.match(workspace, /facetContentPresent: leftPaneContentPresent/);
  assert.match(workspace, /pane=\{restoringLeftPane\}/);
  assert.match(workspace, /onShowFilters=\{commitConfigureFacetChanges\}/);
  assert.match(pane, /widgets\.map\(widget\s*=>\s*pane === "facets"/);
  assert.match(pane, /<SkeletonConfigureSection key=\{widget.key\}/);
  assert.match(pane, /<SkeletonFacet key=\{widget.key\}/);
  assert.doesNotMatch(pane, /<SkeletonFacet title="Properties"/);
  assert.doesNotMatch(pane, /<SkeletonFacet title="Categories"/);
  assert.match(fs.readFileSync(path.join(root, 'src/canvas/left/pane-navigation.tsx'), 'utf8'), /!restoring && showConfigureProperties/);
  assert.match(fs.readFileSync(path.join(root, 'src/canvas/left/pane-navigation.tsx'), 'utf8'), /!restoring && showConfigureRoles/);
});

test('a green graph server stays healthy while auto-fill discovery is pending', () => {
  const value = select({ graphPhase: 'ready', queryPhase: 'waitingForServer',
    endpointReady: true, discoveryPending: true, initialQueryStarted: false });
  assert.equal(value.graphSelector, 'ready');
  assert.equal(value.facets, 'ready');
  assert.equal(value.results, 'ready');
});

test('a timed-out graph auto-fill does not turn a healthy server, facet, or results region into an error', () => {
  const value = select({ graphPhase: 'ready', queryPhase: 'readyToExecute',
    endpointReady: true, discoveryFailed: true, initialQueryStarted: true });
  assert.equal(value.graphSelector, 'ready');
  assert.equal(value.facets, 'ready');
  // The existing FCT pipeline owns loading and results; auto-fill is advisory.
  assert.equal(value.results, 'ready');
  assert.equal(value.record, 'ready');
  assert.equal(select({ graphPhase: 'ready', queryPhase: 'executing',
    endpointReady: true, discoveryFailed: true }).results, 'ready');
});

test('disabling auto-fill returns to ordinary FCT view without an XState health retry', () => {
  assert.equal(select({ graphPhase: 'ready', endpointReady: true, queryPhase: 'ready',
    discoveryPending: false, discoveryFailed: false }).results, 'ready');
});


test('degraded graph overrides a stale Record loading or failure state, but a healthy server restores the live pane', () => {
  const offline = select({ graphPhase: 'unavailable', endpointReady: false, endpointFailed: true,
    recordSelected: true, recordLoading: true, recordFailed: true });
  assert.deepEqual([offline.facets, offline.results, offline.record], ['ready', 'ready', 'ready']);
  const online = select({ graphPhase: 'ready', endpointReady: true, recordSelected: true, recordLoading: true });
  assert.equal(online.record, 'ready');
});

test('degraded panes keep Graphs, zero counts, group-by and a static null Record', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fixtures = fs.readFileSync(path.join(root, 'src/canvas/workspace-unavailable.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'src/canvas/workspace.tsx'), 'utf8');
  assert.match(fixtures, /<ZeroFacet name="Graphs"\s*\/>/);
  assert.match(fixtures, /<ZeroFacet name="Categories"\s*\/>/);
  assert.match(fixtures, /Group <span className="tabular-nums">0<\/span> results by:/);
  assert.match(fixtures, /Record not found/);
  assert.match(fixtures, /aria-busy="false"/);
  assert.doesNotMatch(fixtures, /animate-pulse|<Skeleton/);
  assert.match(workspace, /<GraphUnavailableFacets/);
  assert.match(workspace, /<GraphUnavailableResults/);
  assert.match(workspace, /<GraphUnavailableRecord/);
  assert.doesNotMatch(workspace, /<UnavailablePane/);
});


test('retrying a failed graph retains zero-data furniture instead of reentering loading skeletons', () => {
  const checking = select({ graphPhase: 'checking', queryPhase: 'waitingForServer', endpointReady: false,
    endpointFailed: false, recordSelected: true, recordLoading: true });
  assert.equal(checking.graphSelector, 'loading');
  assert.deepEqual([checking.facets, checking.results, checking.record], ['ready','ready','ready']);
});
