const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('Status FCT uses the original federated read-only transport, never an auth retry', () => {
  const route = read('src/app/proxy/api/fct/route.ts');
  const block = route.slice(route.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS'),route.indexOf('const isValidate ='));
  assert.match(block,/verifyApprovalBookmark\(bookmarkQueryXml, request\)/);
  assert.match(block,/cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.match(block,/defaultStatusAddr: `\$\{getPersonalStatusGraph\(request\)\}@\$\{personalEndpoint\}`/);
  assert.match(block,/queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
  assert.doesNotMatch(block,/queryPersonalStatusSparql|fetchWithDigestFallback|oneReadAuthUrl/);
  const personal = read('src/lib/personal-sparql.ts');
  assert.doesNotMatch(personal,/queryPersonalStatusSparql|oneReadAuthUrl/);
  // Authentication and endpoint choice for all other personal SPARQL APIs stay intact.
  assert.match(personal,/export async function queryPersonalSparql/);
  assert.match(personal,/export async function updatePersonalSparql/);
});
test('View and Analyze empty states have shadcn-style composition, panels-top-left and Browse action', () => {
  const empty = read('src/components/ui/maestro-empty-results.tsx');
  const components = read('src/components/ui/empty.tsx');
  assert.match(empty,/PanelsTopLeft/);
  for (const name of ['Empty','EmptyHeader','EmptyMedia','EmptyTitle','EmptyDescription','EmptyContent']) {
    assert.match(empty,new RegExp(`<${name}\\b`));
    assert.match(components,new RegExp(`function ${name}\\b`));
  }
  assert.match(empty,/<Button[^>]*onClick=\{onBrowse\}>Browse<\/Button>/);
  assert.match(read('src/canvas/tab/view/view-components.tsx'), /MaestroEmptyResults/);
  assert.match(read('src/canvas/tab/analyze/page.tsx'), /MaestroEmptyResults/);
});
test('Kanban cards always derive from the live FCT page, with an Ungrouped default', () => {
  const controller = read('src/canvas/utils/workspace-controller.tsx');
  const provider = read('graph/kanban/provider.ttl');
  assert.match(controller, /const kanbanPageRows = visibleResultsPage\.map/);
  assert.match(controller, /const kanbanGroupKey = kanbanGroupChoice/);
  assert.match(controller, /memberships\.get\(row\.uri\)\?\.length/);
  assert.match(controller, /verifiedQueryBookmarked \? "status" : "none"/);
  assert.match(provider, /Ungrouped/);
  assert.match(provider, /xsl:key name="by-column"/);
  assert.match(provider, /data-provider-open-uri/);
  assert.match(read('src/lib/discovered-view-xslt.ts'), /element\.setAttribute\("group", row\.group \?\? ""\)/);
});
