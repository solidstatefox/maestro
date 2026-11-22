import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path, 'utf8');

test('hydrated Browse panes retain their own Result, facet and Record lifecycles', () => {
  const boundaries=read('src/lib/app-lifecycle/skeleton-boundaries.ts');
  const pane=read('src/canvas/tab/browse/results-view.tsx');
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(boundaries,/const facets: LoadingBoundary = shell === "loading" \? "loading" : "ready"/);
  assert.match(boundaries,/const results: LoadingBoundary = shell === "loading" \? "loading" : "ready"/);
  assert.match(boundaries,/const record: LoadingBoundary = shell === "loading" \? "loading" : "ready"/);
  assert.match(pane,/<ElapsedStatus label="Locating"/);
  assert.match(pane,/!results\.length && !searchError && endpointReady && isLoading/);
  assert.match(controller,/const endpointReadyForQuery = Boolean\(queryGraphServer\)/);
  assert.doesNotMatch(controller,/graphReady: graphHealthReady/);
});

test('transport evidence enters isolated XState health actor with stale-probe guard', () => {
  const actor=read('src/lib/app-lifecycle/graph-server-health-actor.ts');
  const client=read('src/lib/client-query-cache.ts');
  const host=read('src/canvas/utils/workspace-controller.tsx');
  assert.match(actor,/setup\(\{ types:/);
  assert.match(actor,/TRANSPORT_FAILED:/);
  assert.match(actor,/PROBE_REPORTED:/);
  assert.match(actor,/lastTransportFailure\[event\.status\.id\].*event\.startedAt/);
  assert.match(client,/MAESTRO_GRAPH_SERVER_TRANSPORT_FAILURE/);
  assert.match(client,/UND_ERR_CONNECT_TIMEOUT/);
  assert.match(host,/graphHealthVerificationRef/);
  assert.match(host,/now - previous\.at < 15_000/);
  assert.match(host,/reportGraphHealthProbe\(status, probeStartedAt\)/);
});

test('graph seeding preflights immutable manifest assets and only writes changed destination graphs', () => {
  const seed=read('src/lib/client-graph-seed.ts');
  assert.match(seed,/seedInFlight=new Map/);
  assert.match(seed,/const documents:Array/);
  assert.match(seed,/staticJson<Asset>/);
  // The login seeder reuses the content SHA-256 already calculated for
  // curator implementationDigest. Its shared helper hashes the destination
  // graph's ordered file/content-digest relation, not static asset filenames.
  const digestHelper=read('src/lib/graph-seed-content-digest.ts');
  assert.match(seed,/import \{ destinationSeedDigest \} from ["']@\/lib\/graph-seed-content-digest["']/);
  assert.match(seed,/documents\.push\(\{entry,graph,triples,digest:asset\.digest\}\)/);
  assert.match(seed,/destinationSeedDigest\(/);
  assert.match(digestHelper,/assets\.map\(\(\{file, digest\}\)/);
  assert.match(digestHelper,/crypto\.subtle\.digest\(\s*["']SHA-256["']/);
  assert.match(digestHelper,/JSON\.stringify\(components\)/);
  assert.match(seed,/const changed=new Set/);
  assert.match(seed,/if\(!changed\.has\(graph\)\)/);
  assert.match(seed,/seedDigest/);
  assert.match(seed,/await updatePersonal\(`CLEAR SILENT GRAPH/);
});

test('History and Status avoid unchanged writes and do not change query clock rules', () => {
  const controller=read('src/canvas/utils/workspace-controller.tsx');
  const status=read('src/canvas/controllers/personal-record-status.ts');
  const mutation=read('src/lib/client-status-writes.ts');
  assert.match(controller,/persistedHistoryStateRef/);
  assert.match(controller,/pendingHistoryStateRef/);
  assert.match(status,/locatedPageWritesRef/);
  assert.match(mutation,/DELETE \{ GRAPH/);
  assert.match(mutation,/INSERT \{ GRAPH/);
  assert.match(controller,/resetMaestroQueryExecutionClocks\(/);
});

test('Bookmark card uses real Play button and joined shadcn right controls', () => {
  const rdf=read('graph/maestro-personal-perspectives.ttl');
  const view=read('src/canvas/tab/view/personal-perspectives.tsx');
  assert.match(rdf,/group flex items-start gap-2/);
  assert.match(rdf,/data-perspective-bookmark-actions-slot="true"/);
  assert.match(view,/<ButtonGroup aria-label="Bookmark actions"/);
  assert.match(view,/<Button type="button" variant="ghost" size="icon-sm"/);
  assert.match(view,/<Play className="size-4"/);
  assert.match(view,/onClick=\{event => \{[\s\S]*?void remove\(\[slot\.id\]\)/);
});

test('Browse Matches shares the Default Record cell/row styles and keeps bold match markup', () => {
  const record=read('src/canvas/right/pane.tsx');
  const matches=read('src/canvas/tab/browse/results-view.tsx');
  const styles=read('src/canvas/right/default-record-row-style.ts');
  assert.match(record,/className=\{DEFAULT_RECORD_PROPERTY_CELL\}/);
  assert.match(matches,/className=\{DEFAULT_RECORD_PROPERTY_CELL\}/);
  assert.match(matches,/className=\{DEFAULT_RECORD_VALUE_CELL\}/);
  assert.match(matches,/onNavigateMatchProperty\(match\.predicate!\)/);
  assert.match(matches,/recordMatchBoldMarkup\(match\.excerpt\)/);
  assert.match(styles,/DEFAULT_RECORD_VALUE_BUTTON/);
});
