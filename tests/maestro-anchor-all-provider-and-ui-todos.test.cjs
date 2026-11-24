"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const read = (f) => readFileSync(resolve(__dirname,'..',f),'utf8');

test('Bookmarks analyses expose scoped transported dimension without disturbing original activity and tags',()=>{
 const s=read('src/canvas/tab/analyze/bookmark-charts.tsx');
 assert.match(s,/activeTransportedFacets\(tree\)/);
 assert.match(s,/createGroupValuesQuery\(tree,/);
 assert.match(s,/selectedAlias/);
 assert.match(s,/Bookmark activity/);
 assert.match(s,/Bookmark tags/);
 assert.match(s,/controller\.signal\.aborted/);
});

test('Overview and Node analytics consume grouped Personal alias results without a redundant request',()=>{
 const s=read('src/canvas/tab/view/transported-dimension-summary.tsx');
 for(const f of ['src/canvas/tab/view/overview.tsx','src/canvas/tab/view/overview-node-analytics.tsx'])
   assert.match(read(f),/<TransportedDimensionSummary widgets=\{workspace\.personalWidgets\}/);
 assert.match(s,/widgets\.filter\(widget => widget\.anchor\)/);
 assert.match(s,/groupValueBinding\(value\)/);
 assert.match(s,/value\.columns\?\.\[1\]\?\.value/);
 assert.doesNotMatch(s,/fetch\(|cachedFetchFct\(|executeQuery\(/);
});

test('All provider XSLT contexts receive getPath-equivalent remote hops except DESCRIBE Records',()=>{
 const s=read('src/lib/maestro-provider-xslt.ts');
 assert.match(s,/mctx:transported-facets/);
 assert.match(s,/if \(!options\.describeXml\)/);
 assert.match(s,/facet\.setAttribute\("key", `alias:\$\{id\}`\)/);
 assert.match(s,/hop\.setAttribute\("id"/);
 assert.match(s,/hop\.setAttribute\("iri"/);
});

test('Map color-by decorations are alias-id keyed and mixed path direction safe in both XSLT templates',()=>{
 const ui=read('graph/map/perspective-ui.xsl');
 const ttl=read('graph/map/provider.ttl');
 const deco=read('src/lib/facet-decoration-contract.tsx');
 for(const s of [ui,ttl]){
   assert.match(s,/data-map-alias/);
   assert.match(s,/selected\.hops\.length/);
   assert.match(s,/colorAnchorId/);
   assert.match(s,/facet-decoration direction="\{@direction\}" iri="\{@iri\}" anchorId="\{@anchorId\}"/);
   assert.match(s,/its complete returned columns, including mixed-direction aliases/);
 }
 assert.match(deco,/facetKey\(direction, iri, anchorId\)/);
 assert.match(deco,/`alias:\$\{anchorId\}`/);
});

test('Spider, Sankey, Table, Compare, Kanban preserve alias ID instead of leaf predicate IRI',()=>{
 const spider=read('src/canvas/tab/analyze/spider.tsx');
 const sankey=read('src/lib/sankey-coverage.ts');
 const view=read('src/canvas/utils/workspace-controller.tsx');
 const compare=read('graph/maestro-analyze.ttl');
 assert.match(spider,/anchorId/);
 assert.match(sankey,/predicateKey\(.*anchorId/);
 assert.match(view,/analyzeTableHeaderNodes/);
 assert.match(view,/option\.anchorId \? activeTransportedFacets/);
 assert.match(compare,/node-id/);
});

test('Record and Browse changes preserve URI click override and descriptive Results title',()=>{
 assert.match(read('src/canvas/right/pane.tsx'),/!event\.shiftKey && binding\.termType === "uri"/);
 assert.match(read('src/canvas/tab/browse/results-view.tsx'),/item\.title \|\| \(item\.termType === "uri"/);
});

test('EURIO separate Results section and file-chart-column DOI icon; global default stroke is 1.5',()=>{
 const xslt=read('graph/eu-data/record.xsl'),css=read('src/app/globals.css');
 assert.match(xslt,/<h3 id="eu-project-results-title"/);
 assert.match(xslt,/Lucide file-chart-column/);
 assert.match(xslt,/stroke-width="1.5"/);
 assert.match(css,/--maestro-icon-stroke-width: 1\.5/);
 assert.match(css,/svg\.lucide\[stroke-width="2"\]/);
});

test('Transported Personal facets use ordinary factory and append after local widgets',()=>{
 const ui=read('src/canvas/utils/workspace-controller.tsx');
 const cards=read('src/canvas/left/personal-widget-cards.tsx');
 assert.match(ui,/\.\.\.propertyNodes\.map/);
 assert.match(ui,/\.\.\.anchored\.map/);
 assert.match(cards,/const alias = widget\.anchor/);
 assert.match(cards,/setPropertyValue\(activeLeafId, widget\.uri, binding, checked, boundNode\?\.id\)/);
 assert.match(cards,/createPersonalFacetValuesQuery\(queryTree, widget\.uri, valueRelationship\.direction,[\s\S]*?undefined, valueRelationship\.href\)/);
 assert.doesNotMatch(cards,/createTransportedFacetQuery/);
});

test('Ancestor hover applies only to breadcrumb labels and union marker, not the control group',()=>{
 const s=read('src/canvas/top/breadcrumb-renderers.tsx');
 assert.match(s,/data-maestro-root-label/);
 assert.match(s,/data-maestro-anchor-preview/);
 assert.match(s,/!bg-emerald/);
 assert.match(read('src/lib/fct-facet-alias.ts'),/getPath\(index, ancestor, \(focus as FctQueryNode\)\.id\)/);
});
