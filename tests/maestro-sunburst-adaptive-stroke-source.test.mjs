import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
for(const provider of ['sunburst','sunburst-chartkit']){
  test(`${provider}: adaptive gap and contained border are provider-owned`,()=>{
    const ttl=fs.readFileSync(`graph/${provider}/provider.ttl`,'utf8');
    assert.match(ttl,/name="extent" select="\$span - min\(\(0\.006, \$span div 10\)\)"/);
    assert.match(ttl,/name="border-budget"[^>]+\$chord div 4, \(\$outer - \$inner\) div 4/);
    assert.match(ttl,/name="border" select="if \(\$border-budget lt 0\.15\) then 0 else \$border-budget"/);
    assert.match(ttl,/name="paint-inner" select="\$inner \+ \$half-border"/);
    assert.match(ttl,/name="paint-outer" select="\$outer - \$half-border"/);
    assert.match(ttl,/name="inner-inset" select="math:asin\(\$half-border div \$paint-inner\)"/);
    assert.match(ttl,/name="outer-inset" select="math:asin\(\$half-border div \$paint-outer\)"/);
    assert.match(ttl,/stroke-width="\{\$border\}" stroke-linejoin="round"/);
    assert.match(ttl,/\$paint-outer\*math:sin\(\$outer-start\)/);
    assert.match(ttl,/\$paint-inner\*math:sin\(\$inner-end\)/);
  });
}
test('generic SVG sanitizer permits only round joins on paths, not arbitrary attributes or URLs',()=>{
  const host=fs.readFileSync('src/canvas/left/facet-presentation.tsx','utf8');
  assert.match(host,/"stroke-width","stroke-linejoin","x"/);
  assert.match(host,/name==="stroke-linejoin" && \(child\.localName\.toLowerCase\(\)!=="path" \|\| attr\.value!=="round"\)/);
  assert.match(host,/!ATTRS\.has\(name\)/);
  assert.match(host,/\["fill","stroke"\]\.includes\(name\)/);
});
