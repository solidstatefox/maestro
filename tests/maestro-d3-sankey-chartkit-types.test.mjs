import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the existing D3 Sankey declaration supports both original Analysis and installed chart kit", () => {
  const types = read("src/types/d3-sankey.d.ts");
  const original = read("src/canvas/tab/analyze/d3-sankey.tsx");
  const kitContext = read("src/components/ui/charts/core/sankey/context.ts");
  const kitTypes = read("src/components/ui/charts/core/types/sankey.ts");
  assert.match(types, /export type SankeyNode<N,\s*L\s*=\s*unknown>/);
  assert.match(types, /export interface SankeyGraph<N,L>/);
  assert.match(types, /\(graph: \{nodes:N\[\];links:L\[\]\}\):SankeyGraph<N,L>/);
  assert.match(original, /sankey<Node,Link>\(\)/);
  assert.match(kitContext, /SankeyNode<SankeyNodeDatum, SankeyLinkDatum>/);
  assert.match(kitTypes, /SankeyGraph<SankeyNodeDatum, SankeyLinkDatum>/);
});
