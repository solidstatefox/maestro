import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path, 'utf8');

test('History and Bookmarks preserve the authoritative Results page, allowing explicit pinned Bookmarks', () => {
  const source = read('src/lib/client-perspective-collections.ts');
  assert.match(source, /fctProjectPage\(queryXml,all\.map\(row=>row\.uri\),\[\.\.\.columns,/);
  assert.match(source, /kind === "bookmarks" \? pinned : \[\]/);
  assert.match(source, /new Map\(\[\.\.\.candidates,\.\.\.page\]/);
  assert.match(source, /pageIds\.has\(row\.uri\)/);
  assert.doesNotMatch(source, /SELECT |__PAGINATION__|rootResourceQuery/);
});
test('Both saved-entry perspectives share Results pagination without independent collection slicing', () => {
  const source = read('src/canvas/tab/view/personal-perspectives.tsx');
  const page = read('src/canvas/tab/view/page.tsx');
  assert.match(source, /const visible = filtered/);
  assert.doesNotMatch(source, /setPageSize|filtered\.slice\(/);
  assert.match(page, /viewPagination/);
  assert.match(page, /perspectivePageReady/);
});

test('History and Bookmarks provider-authored rows use safe React action slots for Lucide play and trash buttons', () => {
  const rdf = read('graph/maestro-personal-perspectives.ttl');
  const host = read('src/canvas/tab/view/personal-perspectives.tsx');
  const sanitizer = read('src/lib/discovered-view-xslt.ts');
  assert.equal((rdf.match(/data-perspective-action-slot="select"/g) ?? []).length, 2);
  assert.equal((rdf.match(/data-perspective-action-slot="delete"/g) ?? []).length, 1);
  assert.match(rdf, /data-perspective-bookmark-actions-slot="true"/);
  assert.match(host, /<ButtonGroup aria-label="Bookmark actions"/);
  assert.doesNotMatch(rdf, />Select<|>Delete<|>Selected<\/xsl:when>/);
  assert.match(host, /<Play className="size-4"/);
  assert.match(host, /<Trash2 className="size-4"/);
  assert.match(host, /<TooltipContent>\{slot\.action === "select"/);
  assert.match(host, /className=\{`size-7 shrink-0 self-start/);
  assert.match(host, /onClick=\{event => \{/);
  assert.match(sanitizer, /data-perspective-action-slot/);
});

test('Radial Sunburst labels anchor outward on both semicircles and stagger child labels against parent spokes', () => {
  for (const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
    const rdf = read(file);
    assert.match(rdf, /parent-mid" as="xs:double" select="-1"/);
    assert.match(rdf, /abs\(\$sector-mid - \$parent-mid\) lt 0\.20/);
    assert.match(rdf, /if \(\$near-parent\) then 0\.13 else 0\.045/);
    assert.match(rdf, /text-anchor="\{if \(\$outward\) then 'start' else 'end'\}"/);
    assert.match(rdf, /<xsl:with-param name="parent-mid" select="\$radial-mid"\/>/);
    assert.equal((rdf.match(/<xsl:with-param name="labels-only" select="true\(\)"\/>/g) ?? []).length, 1);
  }
});
