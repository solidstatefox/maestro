import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const read = name => fs.readFileSync(path.join(root,name),'utf8');
test('Record XSLT cache is separate, input-sensitive, bounded and cleared independently in Sheet',()=>{
 const src=read('src/lib/maestro-xslt.ts'), sheet=read('src/canvas/sheet/settings-pane.tsx');
 assert.match(src,/const recordFormatHtmlCache = new Map<string, string>/);
 assert.match(src,/const cacheKey =.*recordUri.*stylesheetText.*sourceXml/);
 assert.match(src,/fromRecordFormatCache\(cacheKey\)/);
 assert.match(src,/await transformWithMaestroSaxon/);
 assert.match(src,/annotateMaestroRecordRdfa/);
 assert.match(src,/cacheRecordFormat\(cacheKey/);
 assert.match(sheet,/Clear format cache/);
 assert.match(sheet,/clearMaestroRecordFormatCache\(\)/);
});
test('DBpedia Record formatters distinguish exact subject properties and actual incoming roles',()=>{
 const s=read('graph/dbpedia/maestro-dbpedia-policies.ttl');
 // The policy graph also embeds the auxiliary BookReviewQueryPivot stylesheet.
 // Require each of the seven Record stylesheets that calls m:roles to define it
 // locally; counting every named template in the RDF file would count the pivot.
 const stylesheets = [...s.matchAll(/<xsl:stylesheet\b[\s\S]*?<\/xsl:stylesheet>/g)].map(match => match[0]);
 assert.equal(stylesheets.length, 8);
 const recordStylesheets = stylesheets.filter(stylesheet => /<xsl:call-template name="m:roles"\/>/.test(stylesheet));
 assert.equal(recordStylesheets.length, 7);
 for (const stylesheet of recordStylesheets) {
  assert.equal((stylesheet.match(/<xsl:template name="m:roles">/g) || []).length, 1,
   'Every Record stylesheet calling m:roles must define it exactly once');
 }
 assert.match(s,/name="incoming" select="[^\"]*fct:column\[3\][^\"]*\$recordUri/);
 assert.match(s,/rev="\{\$p\}" resource="\{\.\}"/);
 assert.match(s,/normalize-space\(string\(fct:column\[1\]\)\) = \$recordUri/);
 assert.match(s,/>Additional information<\/h3><h4.*>Properties<\/h4>/);
});
test('Place coordinates and details carry exact RDFa without inventing source predicate',()=>{
 const s=read('graph/dbpedia/maestro-dbpedia-policies.ttl');
 for(const token of ['latEvidence','lonEvidence','geoEvidence','record-map-coordinates','rel="{$predicate}" resource="{.}"','property="{$predicate}" content="{.}"']) assert.ok(s.includes(token),token);
 assert.match(s,/property="\{normalize-space\(string\(\$latEvidence\/fct:column\[2\]\)\)\}"/);
 assert.match(read('src/lib/maestro-record-rdfa.ts'),/distinct\.size === 1/);
});
test('Sunburst labels paint after all wedge paths, not behind neighboring wedges',()=>{
 for(const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']){
  const s=read(file);
  const first=s.indexOf('name="labels-only" select="false()"');
  const second=s.indexOf('name="labels-only" select="true()"');
  assert.ok(first>0&&second>first,file);
  assert.match(s,/<xsl:if test="\$labels-only">/);
  assert.match(s,/<xsl:if test="not\(\$labels-only\)">/);
 }
});
test('Selected Wand groups self-toggle, wrap intrinsically and have no separate removal button',()=>{
 const pane=read('src/canvas/right/pane.tsx'), record=read('src/canvas/right/record-explorer.tsx');
 assert.match(pane,/!flex-wrap break-words/);
 assert.match(pane,/aria-label=\{`Unselect/);
 assert.doesNotMatch(pane.slice(pane.indexOf('{fullscreenPane && inlineWands.map('),pane.indexOf('{workspaceTab === "browse"')),/<InputGroupButton/);
 assert.match(record,/const alreadyFollowed = controller.followedSource/);
 assert.match(record,/controller.disposeAfter\(index\)/);
});
test('Pin appbar actions mount trusted Lucide tooltips in sanitized XSLT slots',()=>{
 const card=read('graph/maestro-personal-perspectives.ttl'),view=read('src/canvas/tab/view/personal-perspectives.tsx'),sanitizer=read('src/lib/discovered-view-xslt.ts');
 assert.match(card,/data-perspective-bookmark-actions-slot="true"/);
 assert.doesNotMatch(card,/>Unpin<|>Pin to appbar<\/button>/);
 assert.match(view,/<PinOff className=/);
 assert.match(view,/<Pin className=/);
 assert.match(view,/TooltipContent>\{slot\.pinned \? "Unpin from appbar" : "Pin to appbar"\}/);
 assert.match(view,/<ButtonGroup aria-label="Bookmark actions"/);
 assert.match(sanitizer,/data-perspective-pin-id/);
});
test('Session-owned personal work is closed while signed out and native XSLT buttons stay native',()=>{
 assert.match(read('src/canvas/left/derived-facet-button.tsx'),/!sessionActive \|\| !sessionKey/);
 assert.doesNotMatch(read('src/canvas/left/personal-widget-cards.tsx'),/if \(!workspace\.accessCapabilities\.canUsePersonalStore\) return null/);
 assert.match(read('src/canvas/left/personal-widget-cards.tsx'),/sessionActive=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.match(read('src/canvas/tab/view/page.tsx'),/PersonalPerspectives active=\{workspace\.accessCapabilities\.canUsePersonalStore\}/);
 assert.match(read('src/components/maestro-xslt-components.tsx'),/node\.localName\.toLowerCase\(\) === "button"/);
});
test('Page stays in viewport with thin scoped scrollbars',()=>{
 assert.match(read('src/app/layout.tsx'),/overflow-hidden/);
 assert.match(read('src/canvas/workspace.tsx'),/h-dvh/);
 assert.match(read('src/app/globals.css'),/scrollbar-width:\s*thin/);
});
