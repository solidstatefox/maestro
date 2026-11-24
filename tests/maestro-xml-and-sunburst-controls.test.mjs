import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared XML CodeBlock formats with center-pane two-space xml-formatter for display, copy and export', () => {
  const block = read('src/components/ui/code-block.tsx');
  const center = read('src/canvas/center/pane.tsx');
  assert.match(center, /import xmlFormat from "xml-formatter"/);
  assert.match(block, /import xmlFormat from "xml-formatter"/);
  assert.match(block, /language\.trim\(\)\.toLowerCase\(\) !== "xml"/);
  assert.match(block, /xmlFormat\(code, \{ indentation: "  " \}\)/);
  assert.match(block, /catch \{ return code; \}/);
  assert.match(block, /const sourceLines = displayedCode/);
  assert.match(block, /navigator\.clipboard\.writeText\(displayedCode\)/);
  assert.match(block, /new Blob\(\[displayedCode\]/);
});

test('master timeout slider has a full-width container with inner padding', () => {
  const settings = read('src/canvas/sheet/settings-pane.tsx');
  // Preserve the original full-width/min-width layout contract while allowing
  // the requested inset so the slider track never touches the InputGroup border.
  assert.match(settings, /masterTimeoutEnabled && <div className="w-full min-w-0 space-y-2 px-4 py-3">/);
  assert.doesNotMatch(settings, /masterTimeoutEnabled && <div className="w-full min-w-0 space-y-2 py-3">/);
  assert.match(settings, /<Slider aria-label="Set all query timeouts in seconds"/);
});

test('Categories control cluster uses Record Graph styling and one connected two-button Toggle Group', () => {
  const host = read('src/canvas/left/facet-presentation.tsx');
  const record = read('src/canvas/right/pane.tsx');
  assert.match(host, /import \{ InputGroup, InputGroupAddon, InputGroupText \}/);
  assert.match(host, /import \{ ToggleGroup, ToggleGroupItem \}/);
  assert.match(host, /import \{ DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger \}/);
  assert.match(record, /border-r bg-muted\/40 px-2 text-muted-foreground/);
  // The compact Provider addon retains the Record's muted-border styling.
  assert.match(host, /border-r bg-muted\/40 px-1\.5 text-muted-foreground/);
  assert.match(host, /<InputGroupText className="text-xs">Provider<\/InputGroupText>/);
  assert.match(host, /<DropdownMenuTrigger asChild>/);
  assert.match(host, /presentation\.select\(option\.uri\)/);
  assert.match(host, /justify-center gap-1\.5 px-1 pt-0\.5/);
  assert.match(host, /<InputGroup className="!w-auto !flex-nowrap[^>]+aria-label="Sunburst label layout controls">/);
  assert.match(host, /<ToggleGroup type="single" aria-label="Sunburst label layout" value=\{labelStyle\}/);
  assert.match(host, /<ToggleGroupItem unstyled value="radial"[^>]*>Radial<\/ToggleGroupItem>/);
  assert.match(host, /<ToggleGroupItem unstyled value="arc"[^>]*>Arc<\/ToggleGroupItem>/);
  assert.match(host, /border-l border-input px-2/);
  assert.equal((host.match(/<ToggleGroup type="single"/g)??[]).length, 1);
  assert.equal((host.match(/<ToggleGroupItem unstyled value=/g)??[]).length, 2);
  assert.doesNotMatch(host, /<select id="maestro-category-facet-provider"|data-facet-label-toggle/);
});

test('sunbursts keep hover highlight without scaling, hand cursor or native SVG title', () => {
  const host = read('src/canvas/left/facet-presentation.tsx');
  assert.match(host, /element\.style\.opacity=inBranch/);
  assert.match(host, /<div ref=\{tooltipRef\} role="tooltip"/);
  assert.match(host, /positionTooltip\(event\.clientX,event\.clientY\)/);
  assert.doesNotMatch(host, /scale\(1\.045\)|style\.transform=|<Tooltip open=/);
  for (const path of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
    const ttl=read(path);
    assert.match(ttl, /aria-label="\{concat\(@label/);
    assert.match(ttl, /class="cursor-default transition-opacity/);
    assert.match(ttl, /name="label" select="f:display-label\(string\(@label\)\)"/);
    assert.doesNotMatch(ttl, /<title>|data-facet-label-toggle/);
  }
});

test('sunbursts retain 2.5x depth geometry but cap the surrounding host to reduce whitespace', () => {
  const host = read('src/canvas/left/facet-presentation.tsx');
  assert.match(host, /max-w-\[420px\]/);
  assert.doesNotMatch(host, /max-w-\[800px\]/);
  assert.match(host, /flex-none flex-col gap-1/);
  assert.match(host, /child\.localName\.toLowerCase\(\)===\"g\" && attr\.value===\"scale\(2\.5\)\"/);
  for (const path of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
    const ttl=read(path);
    assert.match(ttl, /name="max-depth" select="min\(\(5,/);
    assert.match(ttl, /name="outer-radius" select="min\(\(144, 70 \+ \(\$max-depth - 1\) \* 18\.5\)\)"/);
    // Dynamic viewBox trims unused margins while keeping the 2.5x ring geometry.
    assert.match(ttl, /viewBox="\{concat\(format-number\(400 - 2\.5 \* \(\$outer-radius \+ 14\)/);
    assert.doesNotMatch(ttl, /viewBox="0 0 800 800"/);
    assert.match(ttl, /<g transform="scale\(2\.5\)">/);
    // Two root passes (wedges, then labels) and one recursive child pass.
    // Label-over-wedge paint order avoids SVG sibling paths obscuring long radial text.
    assert.equal((ttl.match(/<xsl:with-param name="outer-radius"/g)??[]).length,3);
    assert.match(ttl, /<xsl:with-param name="labels-only" select="true\(\)"\/>/);
    assert.match(ttl, /<xsl:if test="not\(\$labels-only\)"/);
    for(let level=1;level<=5;level++) {
      const radius=2.5*Math.min(144,70+(level-1)*18.5);
      assert.ok(radius<=360 && radius<400, 'scaled radius must fit chart');
      if(level>1)assert.ok(radius>2.5*Math.min(144,70+(level-2)*18.5));
    }
  }
});
