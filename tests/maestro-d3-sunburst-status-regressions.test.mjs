import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { traceSankeyStreams } from '../src/lib/sankey-stream-focus.ts';
const read = file => fs.readFileSync(file,'utf8');

test('D3 stream isolation keeps only a node\'s upstream and downstream branches', () => {
  const links = [
    {source:'root',target:'A'}, {source:'root',target:'B'},
    {source:'A',target:'predicate-A'}, {source:'predicate-A',target:'value-A'},
    {source:'B',target:'predicate-B'}, {source:'predicate-B',target:'value-B'},
  ];
  const connected=traceSankeyStreams(links,'A');
  assert.deepEqual([...connected.links].sort((a,b)=>a-b),[0,2,3]);
  assert.deepEqual([...connected.nodes].sort(),['A','predicate-A','root','value-A']);
  const focus=traceSankeyStreams(links,'predicate-A');
  assert.deepEqual([...focus.links].sort((a,b)=>a-b),[0,2,3]);
  assert.equal(focus.links.has(4),false);
});

test('nested Sunburst recursion passes required total and preserves ancestors not on the flat page', () => {
  const xslt=read('graph/sunburst/provider.ttl');
  const host=read('src/canvas/left/facet-presentation.tsx');
  assert.match(xslt,/<xsl:variable name="sibling-total"/);
  assert.match(xslt,/<xsl:with-param name="total" select="\$total"\/>/g);
  assert.match(xslt,/div max\(\(1,\$sibling-total\)\)/);
  assert.match(host,/const presented=itemByUri\.get\(sourceItem\.uri\)/);
  assert.match(host,/presented \?\? \{uri:sourceItem\.uri/);
  assert.match(host,/hierarchyItems\.set\(item\.uri,item\)/);
  assert.match(host,/if\(result\.error\)return <ErrorDetails/);
});

test('Status uses original read-only FCT execution without added personal authentication fallbacks', () => {
  const route=read('src/app/proxy/api/fct/route.ts');
  const start=route.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS');
  const end=route.indexOf('const isValidate =',start);
  const block=route.slice(start,end);
  assert.match(block,/queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
  assert.match(block,/cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.match(block,/getPersonalStatusGraph\(request\)/);
  assert.doesNotMatch(block,/queryPersonalStatusSparql|fetchWithDigestFallback|oneReadAuthUrl/);
  assert.doesNotMatch(read('src/lib/personal-sparql.ts'),/queryPersonalStatusSparql/);
});

test('Dynamic provider, analysis and record errors use copyable ErrorDetails', () => {
  const files=['src/canvas/left/facet-presentation.tsx', 'src/canvas/tab/analyze/d3-sankey.tsx',
    'src/canvas/tab/analyze/sankey.tsx','src/canvas/tab/analyze/page-provider.tsx',
    'src/canvas/right/record-explorer.tsx','src/canvas/utils/query-inspector.tsx'];
  for(const file of files)assert.match(read(file),/<ErrorDetails/,file);
});
