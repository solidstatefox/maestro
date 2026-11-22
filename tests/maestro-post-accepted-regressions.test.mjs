import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Record XSLT policy supplies IDs for DBpedia Person literal and URI values', () => {
  const rdf = source('graph/dbpedia/maestro-dbpedia-policies.ttl');
  const renderer = source('src/canvas/utils/workspace-controller.tsx');
  assert.match(rdf, /DbpediaPersonRecordTemplate/);
  for (const field of ['label', 'birthDate', 'deathDate', 'birthName', 'nationality']) {
    assert.match(rdf, new RegExp(`id="record-field-literal-${field}-\\{position\\(\\)\\}" property="http:`));
    assert.match(rdf, new RegExp(`id="record-field-uri-${field}-\\{position\\(\\)\\}" href="#"`));
  }
  assert.doesNotMatch(rdf, /<span property="[^"\n]+" content="\{\.\}">/);
  assert.match(renderer, /Template element <\$\{element\.tagName\.toLowerCase\(\)\}> is missing its required id/);
  assert.match(renderer, /Template contains duplicate id/);
});

test('Spider uses fixed domain without visible axis and anchors tooltip to top right', () => {
  const spider = source('src/canvas/tab/analyze/spider.tsx');
  assert.match(spider, /<PolarRadiusAxis domain=\{\[0, 100\]\} tick=\{false\}/);
  assert.match(spider, /<Tooltip position=\{\{ x: Math\.max\(8, chartWidth - 272\), y: 12 \}\}/);
  assert.match(spider, /new ResizeObserver/);
  assert.match(spider, /raw_\$\{String\(item\.dataKey\)\}/);
  assert.doesNotMatch(spider, /tickFormatter=\{/);
});

test('Root crumb applies the same active-bg as a selected breadcrumb regardless of signal', () => {
  const crumb = source('src/canvas/top/breadcrumb-renderers.tsx');
  assert.match(crumb, /activeBreadcrumbIndex < 0 \? "bg-accent font-medium text-foreground"/);
  assert.match(crumb, /aria-current=\{activeBreadcrumbIndex < 0 \? "location" : undefined\}/);
  assert.match(crumb, /aria-pressed=\{textSearchMode === mode\}/);
});

test('Browse separators use centered stable hit targets and do not steal adjacent handles', () => {
  const resizable = source('src/components/ui/resizable.tsx');
  const workspace = source('src/canvas/workspace.tsx');
  const frames = source('src/canvas/workspace-pane-shells.tsx');
  assert.match(resizable, /PanelResizeHandle/);
  assert.match(resizable, /before:left-1\/2 before:w-px before:-translate-x-1\/2/);
  assert.match(resizable, /min-w-2 max-w-2/);
  assert.doesNotMatch(resizable, /after:-left-1/);
  assert.doesNotMatch(workspace, /!w-px !min-w-px !max-w-px/);
  assert.equal((workspace.match(/<ResizableHandle withHandle/g) || []).length, 2);
  for (const [name, order] of [["left",0],["center",1],["right",2]])
    assert.ok(frames.includes(`id="maestro-browse-${name}" order={${order}}`));
});

test('XState observables and live Results requests deduplicate unchanged input', () => {
  const operations = source('src/lib/app-lifecycle/operations.ts');
  const discovery = source('src/lib/app-lifecycle/analyze-discovery.ts');
  const workspace = source('src/canvas/utils/workspace-controller.tsx');
  assert.match(operations, /snapshot\.graph\.key !== event\.key \|\| snapshot\.graph\.phase !== phase/);
  assert.match(discovery, /!snapshot\.matches\("inactive"\)/);
  assert.match(discovery, /snapshot\.context\.key === key/);
  assert.match(workspace, /const viewRenderInputKey = JSON\.stringify/);
  assert.match(workspace, /selectedView\?\.stylesheet, viewRenderInputKey\]/);
  assert.match(workspace, /resultsRequestXml, resultsQueryHasStatuses/);
  assert.match(workspace, /setAnalysisDefinitions\(previous => previous\.length \? \[\] : previous\)/);
});
