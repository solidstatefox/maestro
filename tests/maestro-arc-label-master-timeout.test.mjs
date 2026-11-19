import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path,'utf8');
test('timeout master makes individual query timeout controls inert while keeping independent hover preference editable', () => {
 const s = read('src/canvas/sheet/settings-pane.tsx');
 assert.match(s, /<fieldset disabled=\{masterTimeoutEnabled\} aria-label="Individual query timeouts"/);
 assert.match(s, /<fieldset disabled=\{masterTimeoutEnabled\} aria-label="Individual widget query timeouts"/);
 assert.match(s, /aria-label="Root URI autocomplete timeout in seconds"[\s\S]*?disabled=\{masterTimeoutEnabled\}/);
 assert.match(s, /aria-label=\{`\$\{label\} query timeout in seconds`\}[\s\S]*?disabled=\{masterTimeoutEnabled\}/);
 assert.match(s, /<\/fieldset>\s*<div className="space-y-2 border-t pt-3">\s*<div className="flex items-center justify-between gap-2">\s*<Label htmlFor="maestro-root-hover-delay"/);
});
for(const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
 test(`${file} renders one responsive arc caption and preserves the complete name for accessible tooltip`,()=>{
  const s=read(file);
  assert.match(s,/Arc labels/);
  assert.match(s,/data-facet-label-style="arc"/);
  assert.match(s,/name="caption" select="concat\(\$label, ' · ', format-number/);
  assert.match(s,/string-length\(\$caption\)/);
  assert.match(s,/name="f:display-label"/);
  assert.match(s,/f:display-label\(string\(@label\)\)/);
  assert.match(s,/then replace\(\$raw, '\^\[\^:\]\+:'/);
  assert.match(s,/aria-label="\{concat\(@label/);
  assert.doesNotMatch(s,/<title>/);
  assert.doesNotMatch(s,/data-facet-label-style="curved"|name="percent-id"/);
 });
}
test('shared host anchors one styled tooltip beside the hovered wedge, keeps wedges static and preserves RDF toggles',()=>{
 const s=read('src/canvas/left/facet-presentation.tsx');
 const sunburstSurface=s.slice(s.indexOf('export function FacetPresentationSurface('));
 assert.match(sunburstSurface,/<div ref=\{tooltipRef\} role="tooltip"/);
 assert.match(s,/positionTooltip\(event\.clientX,event\.clientY\)/);
 assert.match(s,/onPointerOver=.*hoverBranch/);
 assert.match(s,/onPointerLeave=\{\(\)=>\{highlightLineage\(null\);setHoverDescription\(""\)/);
 assert.match(s,/element\.style\.opacity=inBranch/);
 assert.match(s,/setHoverDescription\(wedge\?\.getAttribute\("aria-label"\)\?\?""\)/);
 assert.doesNotMatch(sunburstSurface,/<Tooltip(?:Content|Trigger)?\b|scale\(1\.045\)|element\.style\.transform=/);
 assert.match(s,/export function FacetPresentationButton/);
 assert.match(s,/onToggle\(uri,!item\.selected\)/);
});
test('Status compiled query and transport are unchanged by Sunburst presentation changes',()=>{
 const s=read('src/app/proxy/api/fct/route.ts');
 const block=s.slice(s.indexOf('if (compiled.view === FCT_VIEW_TYPES.LIST_STATUS'),s.indexOf('const isValidate ='));
 assert.match(block,/queryPersonalSparql\(query, compiled\.timeoutMs, request\)/);
 assert.doesNotMatch(block,/queryPersonalStatusSparql|fetchWithDigestFallback|oneReadAuthUrl/);
});
