import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("D3 laid-out links replace numeric endpoints with positioned nodes", () => {
  const declaration = read("src/types/d3-sankey.d.ts");
  const context = read("src/components/ui/charts/core/sankey/context.ts");
  const tooltipTypes = read("src/components/ui/charts/core/types/sankey.ts");
  const original = read("src/canvas/tab/analyze/d3-sankey.tsx");

  // The installed chart kit's input links use numeric source/target. D3 replaces
  // those with node objects during layout. An intersection creates `number & Node`.
  assert.match(declaration, /Omit<L,\s*["']source["']\s*\|\s*["']target["']>/);
  assert.match(declaration, /source\s*:\s*SankeyNode<N,L>/);
  assert.match(declaration, /target\s*:\s*SankeyNode<N,L>/);
  assert.match(declaration, /links:\s*SankeyLink<N,L>\[\]/);
  assert.doesNotMatch(declaration, /export type SankeyLink<N,L>\s*=\s*L\s*&/);
  assert.match(tooltipTypes, /data:\s*SankeyNodeDatum\s*\|\s*SankeyLinkDatum\s*\|\s*SankeyLink<SankeyNodeDatum,\s*SankeyLinkDatum>/);
  assert.match(context, /const \{ source, target \} = link as \{ source: SankeyLayoutNode; target: SankeyLayoutNode \}/);
  // Protect the original working Analysis renderer against accidental rewrites.
  assert.match(original, /sankey<Node,Link>\(\)/);
});
