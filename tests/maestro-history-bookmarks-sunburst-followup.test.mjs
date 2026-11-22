import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path, 'utf8');

test('History and Bookmarks collections page through all ordered ODS result rows before client filtering', () => {
  const source = read('src/lib/client-perspective-collections.ts');
  assert.match(source, /const batchSize = 500, maxResultRows = 25_000/);
  assert.match(source, /ORDER BY DESC\(\?created\) \?entry \?tagPredicate \?tag __PAGINATION__/);
  assert.match(source, /ORDER BY DESC\(\?created\) \?entry __PAGINATION__/);
  assert.match(source, /q\.replace\("__PAGINATION__", `LIMIT \$\{batchSize\} OFFSET \$\{offset\}`\)/);
  assert.match(source, /if \(!complete\) throw new Error/);
  assert.doesNotMatch(source, /ORDER BY DESC\(\?created\) LIMIT 500/);
});

test('Both perspectives have one shared search and page-navigation toolbar with an accessible page count', () => {
  const source = read('src/canvas/tab/view/personal-perspectives.tsx');
  assert.match(source, /PERSPECTIVE_PAGE_SIZES = \[10, 20, 50, 100\] as const/);
  assert.match(source, /const \[pageSize, setPageSize\] = useState<number>\(20\)/);
  assert.match(source, /const totalPages = Math\.max\(1, Math\.ceil\(filtered\.length \/ pageSize\)\)/);
  assert.match(source, /filtered\.slice\(currentPage \* pageSize/);
  assert.match(source, /aria-label=\{`\$\{kind\} entries per page`\}/);
  assert.match(source, /PERSPECTIVE_PAGE_SIZES\.map\(size =>/);
  assert.match(source, /setPageSize\(Number\(event\.currentTarget\.value\)\)/);
  assert.match(source, /aria-label=\{`\$\{kind\} search and pagination`\}/);
  assert.match(source, /aria-label="Previous page"/);
  assert.match(source, /aria-label="Next page"/);
  assert.match(source, /Page \{currentPage \+ 1\} of \{totalPages\}/);
  assert.match(source, /setSearch\(event\.target\.value\); setPage\(0\)/);
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
