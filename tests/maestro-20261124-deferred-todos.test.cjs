const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const controller = read('src/canvas/utils/workspace-controller.tsx');
const xslt = read('graph/eu-data/record.xsl');
test('Record updates cannot retrigger Results scrolling through a new array identity',()=>{
  assert.match(controller,/const visibleResultsPage = useMemo/);
  assert.match(controller, /#central-panel-results \[data-results-scroll\]/);
  assert.match(controller,/\[centralTab, selectedUri, resultsUiPage, resultsPageSize, resultsOffset\]/);
  assert.doesNotMatch(controller,/\[centralTab, selectedUri, resultsUiPage, visibleResultsPage\]/);
});
test('Personal facet error belongs to the title row and URI uses full width',()=>{
  const text=read('src/canvas/left/personal-widget-cards.tsx');
  // The count/error shares the title row; the URI is its full-width sibling.
  assert.match(text,/group\/header flex flex-col border-b/);
  assert.match(text,/flex w-full min-w-0 items-start justify-between gap-2/);
  assert.match(text,/flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1/);
  assert.match(text,/shrink-0 text-xs font-normal tabular-nums text-muted-foreground[\s\S]*?shortenCount\(widget.values.length\)/);
  assert.match(text,/Update failed[\s\S]*?<\/span>\}[\s\S]*?<\/div>\s*<Tooltip><TooltipTrigger render=\{<p className="mt-1 w-full truncate/);
});
test('EURIO multiword acronym extracts only the colon-delimited prefix',()=>{
  assert.match(xslt,/matches\(\$acronymRaw, '\^\[\^:\]\+:\\s\+'\)/);
  const pattern = /^[^:]+:\s+/;
  for(const [label,expected] of [['ICE GENESIS: Creating the next generation','ICE GENESIS'],['LocalLing: Revitalisation','LocalLing'],['ICE GENESIS','ICE GENESIS']]) assert.equal(pattern.test(label)?label.split(':')[0].trim():label,expected);
});
test('funding plan uses reverse funds and verified disburser and amount',()=>{
  assert.match(xslt,/\?subject eurio:funds \?project/);
  assert.match(xslt,/eurio:isDisbursedBy,eurio:hasFundingAmount/);
  assert.match(xslt,/\$pair\[1\]=\$currency/);
  assert.match(xslt,/\$known le \$total/);
  assert.match(xslt,/Unallocated \/ unknown/);
});
test('Deliverables count distinct resources per RDF type, then filter locally',()=>{
  assert.match(xslt,/COUNT\(DISTINCT \?result\) AS \?object/);
  assert.match(xslt,/GROUP BY \?subject/);
  assert.match(xslt,/filterLabel="Deliverables"/);
  const pages=read('src/components/ui/record-value-pages.tsx');
  assert.match(pages,/allValues\.filter\(value => typesOf\(value\)\.includes\(activeType\)\)/);
  assert.match(pages,/setSelectedType\(event.target.value\);setPage\(0\)/);
});
test('Alphabet counts exclude the active index and empty container is not rendered',()=>{
  assert.match(controller,/type: FCT_VIEW_TYPES\.ALPHABET, index: ""/);
  assert.match(controller,/Alphabet retains its own query-scoped counts across letter toggles/);
  const pane=read('src/canvas/center/pane.tsx');
  assert.match(pane,/Object\.values\(alphabetCounts\)\.some\(count => count > 0\) \|\| isLoadingAlphabet \|\| Boolean\(alphabetIndex\)/);
});
test('D3 stream selection is independent of multicolor columns',()=>{
  const text=read('src/canvas/tab/analyze/d3-sankey.tsx');
  assert.match(text,/const streamFocus=useMemo\(\(\)=>selectedNode!==null/);
  assert.match(text,/\[graph.links,selectedNode\]/);
  assert.match(text,/In either color mode, click a node/);
});
test('Seen status refreshes authoritative counts and styles result titles',()=>{
  const status=read('src/canvas/controllers/personal-record-status.ts');
  assert.match(status,/activeHashRef.current === hash\) setStatusRevision/);
  assert.match(status,/pageIdentity, queryXml, statusRevision\]/);
  assert.match(read('src/canvas/tab/browse/results-view.tsx'),/seenUris\?\.has\(item.uri\) \? "font-normal" : "font-medium"/);
});
test('nested Results verify count instead of inferring a total from a short first page',()=>{
  assert.match(controller,/completeFirstResultsPage = queryTree.children.some\(node => node.name === "view"\)/);
  assert.match(controller,/same-scope count is \$\{resultsTotalCount\}/);
});
test('Record providers fill their parent column',()=>{
  assert.match(read('src/canvas/right/pane.tsx'),/maestro-record-format-surface/);
  assert.match(read('src/app/globals.css'),/width: 100% !important; min-width: 0 !important; max-width: 100% !important/);
});
test('breadcrumb tooltip is elevated without changing global tooltip defaults',()=>{
  assert.match(read('src/canvas/top/breadcrumb-renderers.tsx'),/positionerClassName="z-\[150\]"/);
});
test('Categories SVG bounds and resize affordance replace the radius slider',()=>{
  const text=read('src/canvas/left/facet-presentation.tsx');
  assert.match(text,/svg.getBBox\(\)/);
  assert.match(text,/svg.setAttribute\("viewBox"/);
  assert.match(text,/setPointerCapture/);
  assert.doesNotMatch(text,/aria-label="Maximum sunburst radius"/);
});
