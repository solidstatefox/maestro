import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// These tests guard the affected source contracts without pretending to
// substitute for interactive browser, Virtuoso, or ODS integration tests.
test('Return starts at View Features and persists across tabs until explicitly returned', () => {
  const appbar = source('src/canvas/top/appbar-pane.tsx');
  const machine = source('src/lib/app-lifecycle/operations.ts');
  const controller = source('src/canvas/utils/workspace-controller.tsx');
  const hook = source('src/canvas/diagnostics/use-maestro-operations.ts');
  assert.match(machine, /FEATURES_ENTERED:/);
  assert.match(machine, /returnVisible: true/);
  assert.match(machine, /CONTEXT_RETURNED:.*returnVisible: false/);
  assert.match(controller, /type: "FEATURES_ENTERED"/);
  assert.match(hook, /viewPanel: facts\.navigationViewPanel/);
  assert.match(controller, /const returnButtonVisible = operations\.snapshot\.navigation\.returnVisible/);
  assert.match(appbar, /\{returnButtonVisible && <Tooltip>/);
  assert.doesNotMatch(appbar, /returnShareUrl && workspaceTab/);
});

test('followed Record value has unclipped line boxes and cloned inline text padding', () => {
  const css = source('src/canvas/right/record-source-highlight.css');
  assert.match(css, /\[data-maestro-followed-source="true"\][\s\S]*?line-height:\s*1\.9/);
  assert.match(css, /box-decoration-break:\s*clone/);
});

test('Value Wand decorates both predicate and exact value while keeping one selection identity', () => {
  const decorator = source('src/canvas/controllers/record-rdfa-decoration.ts');
  const pane = source('src/canvas/right/pane.tsx');
  assert.match(decorator, /found\.kind === "property" \|\|/);
  assert.match(decorator, /item\.value === found\.statement\.value/);
  assert.match(pane, /displayKind:\s*found\.kind/);
  assert.match(pane, /next\.push\(\{host:slot as HTMLElement,item,displayKind:found\.kind\}\)/);
  assert.match(pane, /data-maestro-inline-wand-slot/);
});

test('Place formatter selects only current Record subject, supplies native SVG heading and full-width hero', () => {
  const ttl = source('graph/maestro-dbpedia-policies.ttl');
  const place = ttl.slice(ttl.indexOf('DbpediaPlaceRecordTemplate'), ttl.indexOf('DbpediaSpeciesRecordTemplate'));
  assert.match(place, /normalize-space\(string\(fct:column\[1\]\)\) = \$recordUri/);
  assert.match(place, /id="dbpedia-place-record-heading-icon"/);
  assert.match(place, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" id="dbpedia-place-record-heading-icon"/);
  assert.match(place, /object-cover object-center/);
  assert.match(place, /h-\[clamp\(220px,35vw,440px\)\]/);
  const controller = source('src/canvas/utils/workspace-controller.tsx');
  assert.match(controller, /record-heading-icon/);
  assert.match(controller, /record_title_icon/);
});

test('Sunburst radial labels are untruncated with visible SVG overflow in both providers', () => {
  for (const provider of ['sunburst', 'sunburst-chartkit']) {
    const ttl = source(`graph/${provider}/provider.ttl`);
    assert.match(ttl, /overflow="visible"/);
    assert.match(ttl, /text-anchor="\{if \(\$outward\) then 'start' else 'end'\}" font-size="10"/);
    assert.match(ttl, /xsl:value-of select="\$label"/);
    assert.doesNotMatch(ttl, /radial-room/);
  }
  const host = source('src/canvas/left/facet-presentation.tsx');
  assert.match(host, /\[&_svg\]:overflow-visible/);
});

test('dedicated Status timeout is before Categories and owns Status requests', () => {
  const timeouts = source('src/lib/maestro-query-timeouts.ts');
  assert.match(timeouts, /\{ key: "status", label: "Status" \},\s*\{ key: "categories", label: "Categories" \}/);
  assert.match(timeouts, /status: 60/);
  assert.match(timeouts, /includes\("status-facet"\).*return "status"/);
});

test('Status header has text and reads both ODS and remote proxy dispatch clocks', () => {
  const header = source('src/canvas/left/status-widget.tsx');
  const personal = source('src/lib/client-personal-sparql.ts');
  const client = source('src/lib/fct-client.ts');
  const clocks = source('src/lib/maestro-query-execution-clock.ts');
  assert.match(header, /<ElapsedStatus label="Status" category="status" clockScope="statuses"/);
  assert.match(personal, /requestSource \? maestroQueryFetch : fetch/);
  assert.match(client, /selectPersonal\(countQuery, ctx, signal, "status-facet-count"\)/);
  assert.match(client, /"x-maestro-debug-source": "status-facet-remote"/);
  assert.match(clocks, /label\.includes\("status-facet"\).*return "statuses"/);
});

test('proxy sends lane and physical lane index; hover shows lane.index', () => {
  const proxy = source('src/lib/proxy-query-events.ts');
  const server = source('src/lib/graph-server-query-scheduler.ts');
  const adapter = source('src/lib/client-query-events.ts');
  const cache = source('src/lib/client-query-cache.ts');
  const appbar = source('src/canvas/top/appbar-pane.tsx');
  assert.match(proxy, /lane\?: "light" \| "heavy"; laneIndex\?: number/);
  assert.match(server, /const laneIndex = orderedLane\.indexOf\(task\) \+ 1/);
  assert.match(adapter, /onQueuePosition\?\.\(data\.queueIndex!/);
  assert.match(cache, /serverQueueLaneIndex/);
  assert.match(appbar, /\$\{query\.serverQueueLane\}\.\$\{query\.serverQueueLaneIndex\}/);
  assert.match(appbar, /`browser\.\$\{query\.queueIndex\}`/);
});
