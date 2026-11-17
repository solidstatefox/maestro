import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uniqueOverviewPredicateOptions } from "../src/lib/overview-predicate-options.ts";

const academicAdvisor = "http://dbpedia.org/ontology/academicAdvisor";

test("same predicate in Properties and Roles appears once, keeping first label", () => {
  const options = uniqueOverviewPredicateOptions([
    { uri: academicAdvisor, label: "Academic advisor" },
    { uri: "http://dbpedia.org/ontology/doctoralAdvisor", label: "Doctoral advisor" },
    { uri: academicAdvisor, label: "Academic advisor of" },
  ]);
  assert.deepEqual(options, [
    { uri: academicAdvisor, label: "Academic advisor" },
    { uri: "http://dbpedia.org/ontology/doctoralAdvisor", label: "Doctoral advisor" },
  ]);
});

test("duplicate metrics predicates and empty URIs cannot generate duplicate options", () => {
  const options = uniqueOverviewPredicateOptions([
    { uri: academicAdvisor, label: "Academic advisor", count: 10 },
    { uri: academicAdvisor, label: "Academic advisor", count: 4 },
    { uri: "", label: "Invalid", count: 1 },
    { uri: "  ", label: "Blank", count: 1 },
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].count, 10);
});

test("both Overview predicate menus use the same URI deduplication", () => {
  const ui = readFileSync(new URL("../src/canvas/tab/view/overview-node-analytics.tsx", import.meta.url), "utf8");
  assert.match(ui, /const choices=useMemo\(\(\)=>uniqueOverviewPredicateOptions\(/);
  assert.match(ui, /const connectionPredicates=useMemo\(\(\)=>uniqueOverviewPredicateOptions\(/);
  assert.match(ui, /<OverviewConnectionFinder[^\n]*predicates=\{connectionPredicates\}/);
});
