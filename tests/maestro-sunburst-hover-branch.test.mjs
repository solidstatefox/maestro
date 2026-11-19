import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root=process.cwd();
const host=readFileSync(join(root,'src/canvas/left/facet-presentation.tsx'),'utf8');
for (const file of ['graph/sunburst/provider.ttl','graph/sunburst-chartkit/provider.ttl']) {
  const body=readFileSync(join(root,file),'utf8');
  test(`${file} retains full category names and projects ancestry for hover`,()=>{
    assert.match(body,/data-facet-lineage="\{\$lineage\}"/);
    assert.match(body,/ancestor-or-self::node ! generate-id/);
    assert.match(body,/name="label" select="f:display-label\(string\(@label\)\)"/);
    assert.doesNotMatch(body,/available-chars|substring\(@label/);
    assert.match(body,/data-facet-value="\{@uri\}"/);
  });
}
test('generic facet host mutes unrelated wedges and labels, restores on pointer exit, and preserves click',()=>{
  assert.match(host,/onPointerOver=.*hoverBranch/);
  assert.match(host,/onPointerLeave=\{\(\)=>\{highlightLineage\(null\)/);
  assert.match(host,/onFocusCapture=/);
  assert.match(host,/path\.startsWith\(`\$\{lineage\} `\)/);
  assert.match(host,/lineage\.startsWith\(`\$\{path\} `\)/);
  assert.match(host,/element\.hasAttribute\("data-facet-value"\) \? "0\.15" : "0"/);
  assert.match(host,/onToggle\(uri,!item\.selected\)/);
  assert.match(host,/name==="data-facet-lineage"/);
});
