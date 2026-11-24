"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = pathPart => fs.readFileSync(path.join(root, pathPart), 'utf8');
const controller = read('src/canvas/utils/workspace-controller.tsx');
const filters = read('src/canvas/left/filter-pane.tsx');
const xsl = read('graph/eu-data/record.xsl');
const ttl = read('graph/eu-data/provider.ttl');
const stylesheet = read('src/app/globals.css');
const select = read('src/components/ui/maestro-select.tsx');

test('Category sunburst sees the direct disjoint union of Selected and available items', () => {
  assert.match(controller, /const unselectedClassDisplayFacets = classDisplayFacets\.filter\(\(item\) => !selectedClasses\.has\(item\.uri\)\)/);
  assert.match(controller, /const categoryTreeItems = \[\.\.\.selectedClassDisplayFacets, \.\.\.unselectedClassDisplayFacets\];/);
  const start = filters.indexOf('<FacetPresentationSurface presentation={classPresentation}');
  assert.ok(start > 0);
  const exposed = filters.slice(start, start + 530);
  assert.match(exposed, /items=\{\[\.\.\.selectedClassDisplayFacets, \.\.\.unselectedClassDisplayFacets\]/);
  assert.doesNotMatch(exposed, /findIndex/);
  const sunburst = read('graph/sunburst/provider.ttl');
  const chartkit = read('graph/sunburst-chartkit/provider.ttl');
  for (const code of [sunburst, chartkit]) assert.match(code, /select="count\(item\)"/);
});

test('Project DOI is a growing-chart document icon at end of expandable narrative', () => {
  const narrative = xsl.slice(xsl.indexOf('id="eu-project-narrative"'), xsl.indexOf('id="eu-project-results-section"'));
  assert.match(narrative, /data-maestro-expandable="true"/);
  assert.match(narrative, /<xsl:call-template name="project-doi-inline-icon">/);
  // Project and Research Result now both provide their own inline DOI icons.
  assert.equal((xsl.match(/data-maestro-icon="file-chart-column-increasing"/g) || []).length, 4);
  assert.match(xsl, /id="eu-result-doi-icon"/);
  assert.match(xsl, /id="eu-project-doi-inline-link"[^>]*data-maestro-external-link="true"/);
  assert.match(xsl, /id="eu-project-doi-link-\{\$n\}"/);
  assert.doesNotMatch(xsl, /id="eu-project-doi-icon-\{\$n\}"[^>]*stroke-width="2"/);
  assert.match(stylesheet, /--maestro-icon-stroke-width: 1\.5/);
  assert.match(stylesheet, /svg\[data-maestro-icon\] \{ stroke-width: var\(--maestro-icon-stroke-width\)/);
  const embedded = [...ttl.matchAll(/mui:templateContent """([\s\S]*?)"""/g)];
  const unescape = (source) => source.replace(/\\\\/g, '\\');
  const recordWidget = ttl.match(/<gttp:\/\/ggg\.maestro\.ecosys\/eu-data\/widget#Record> a mui:RecordViewerWidget\s*;[\s\S]*?mui:templateContent """([\s\S]*?)"""/);
  const perspectiveWidget = ttl.match(/<gttp:\/\/ggg\.maestro\.ecosys\/eu-data\/widget#Perspective> a mui:PerspectiveWidget\s*;[\s\S]*?mui:templateContent """([\s\S]*?)"""/);
  assert.ok(recordWidget && perspectiveWidget, 'Both EURIO widgets must have a stylesheet');
  assert.equal(unescape(recordWidget[1]), xsl);
  assert.equal(embedded.filter(template => unescape(template[1]) === xsl).length, 1);
  assert.match(perspectiveWidget[1], /match="\/results"/);
  assert.doesNotMatch(perspectiveWidget[1], /<xsl:template name="RecordResult">/);
});

test('Scoped Record loading covers the XSLT-enriched Project DOI/Results phase', () => {
  const pane = read('src/canvas/right/pane.tsx');
  assert.match(pane, /"Loading record \(formatted\)"/);
  assert.doesNotMatch(pane, /Loading linked Results and DOI metadata/);
  assert.match(pane, /currentFormattedRecordHtml/);
  assert.match(controller, /\[data-maestro-expandable\]/);
  assert.match(controller, /toggle\.textContent = "more…"/);
});

test('Every migrated dropdown uses the one shadcn/Radix adapter with value callbacks', () => {
  assert.match(select, /import \{ Select, SelectContent, SelectItem, SelectTrigger, SelectValue \}/);
  assert.match(select, /onValueChange=/);
  assert.match(select, /React\.Children\.toArray/);
  const fileNames = [
    'src/canvas/sheet/settings-pane.tsx', 'src/canvas/tab/analyze/page.tsx',
    'src/canvas/tab/view/page.tsx', 'src/components/ui/record-value-pages.tsx',
    'src/canvas/workspace-unavailable.tsx', 'src/canvas/left/configure-pane.tsx',
  ];
  for (const file of fileNames) assert.match(read(file), /<MaestroSelect/, file);
});

test('User-facing language calls these state machines without renaming mui:status RDF', () => {
  assert.match(require('node:fs').readFileSync("src/lib/app-lifecycle/access.ts", 'utf8'), /signedOut: \{\}/);
  assert.doesNotMatch(read('src/canvas/controllers/authentication.ts'), /Status machines\./);
  assert.match(read('graph/maestro-status-machines.ttl'), /visibility state machine/);
  assert.match(read('graph/maestro-ui-ontology.ttl'), /mui:status/);
});
