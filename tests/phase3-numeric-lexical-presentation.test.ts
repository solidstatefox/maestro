import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCoercibleNumericLexical } from "../src/lib/virtuoso-numeric-coercion";
import { formatNumericFacetLabels } from "../src/lib/numeric-facet-format";

test("numeric presentation and FCT coercion agree on finite lexical values", () => {
  const valid = ["-12.5", "+.5", "1.5e-3", "0", "2."];
  for (const lexical of valid) assert.ok(isCoercibleNumericLexical(lexical), lexical);
  const invalid = ["1e10000", "NaN", "INF", "+05:30", "100 USD", "9".repeat(81)];
  for (const lexical of invalid) assert.ok(!isCoercibleNumericLexical(lexical), lexical);
  const labels = formatNumericFacetLabels(valid);
  assert.equal(labels.length, valid.length);
});

test("facet numeric labels are scoped to the eligible provider and coercible literal results", () => {
  const source = readFileSync("src/canvas/left/personal-widget-cards.tsx", "utf8");
  assert.match(source, /const numericValues = numericProvider\s*\? orderedValues\.filter\(value => value\.termType === "literal" && isCoercibleNumericLexical\(value\.uri\)\)/);
  assert.match(source, /const numericLabelByLexical = new Map\(numericValues/);
  assert.doesNotMatch(source, /isNumericFacetLexical\(value\.uri\)/);
});
