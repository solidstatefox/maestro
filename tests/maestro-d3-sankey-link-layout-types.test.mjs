import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("D3 laid-out links replace numeric endpoints with positioned nodes", () => {
  const declaration = read("src/types/d3-sankey.d.ts");
  const original = read("src/canvas/tab/analyze/d3-sankey.tsx");

  // The active D3 Sankey renderer uses positioned source/target objects
  // after layout. The type must not intersect resolved nodes with numeric IDs.
  assert.match(declaration, /Omit<L,\s*["']source["']\s*\|\s*["']target["']>/);
  assert.match(declaration, /source\s*:\s*SankeyNode<N,L>/);
  assert.match(declaration, /target\s*:\s*SankeyNode<N,L>/);
  assert.match(declaration, /links:\s*SankeyLink<N,L>\[\]/);
  assert.doesNotMatch(declaration, /export type SankeyLink<N,L>\s*=\s*L\s*&/);
  assert.match(original, /sankeyLinkHorizontal/);
  // Protect the original working Analysis renderer against accidental rewrites.
  assert.match(original, /sankey<Node,Link>\(\)/);
});
