import test from "node:test";
import assert from "node:assert/strict";
import { ensureFctQueryIds } from "../src/lib/fct-node-identity";
import { serializeFctQuery, type FctQueryTree } from "../src/lib/fct-query";
import { canonicalQueryIdentityXml } from "../src/lib/query-identity";
import { featureFctQuery } from "../src/lib/feature-fct-query";

const ns = "http://openlinksw.com/services/facets/1.0";

test("one persistent ID per FCT node, with a monotonic base-36 counter", () => {
  const original: FctQueryTree = {
    name: "query" as const,
    attributes: { xmlns: ns },
    children: [
      { id: "query-view", name: "view", attributes: { type: "list" }, children: [] },
      { id: "", name: "property", attributes: { iri: "http://example.org/p" }, children: [
        { id: "", name: "value", text: "x", attributes: { datatype: "string" }, children: [] },
      ] },
    ],
  };
  const tree = ensureFctQueryIds(original);
  assert.equal(tree.attributes.id, "a");
  assert.equal(tree.children[0].id, "b");
  assert.equal(tree.children[0].uiKey, "query-view");
  assert.equal(tree.children[1].id, "c");
  assert.equal(tree.children[1].children[0].id, "d");
  assert.equal(tree.attributes.ctr, "14");
  const xml = serializeFctQuery(tree);
  assert.match(xml, /<query\b[^>]*\bid="a"[^>]*\bctr="14"/);
  assert.match(xml, /<property\b[^>]*\bid="c"/);
  assert.match(xml, /<value\b[^>]*\bid="d"/);
  assert.match(xml, /<view\b[^>]*\bid="b"/);
  assert.doesNotMatch(xml, /\bid="query-view"/);
  assert.equal(serializeFctQuery(tree), xml);
});

test("canonical identity ignores IDs, counter, and sibling constraint order", () => {
  const one = `<query xmlns="${ns}" id="a" ctr="18"><property iri="urn:z" id="b"/><view id="query-view" type="list" limit="30"/><class iri="urn:a" id="c"/></query>`;
  const two = `<query xmlns="${ns}" id="other" ctr="800"><class iri="urn:a" id="y"/><property iri="urn:z" id="x"/><view id="v" type="list" limit="90"/></query>`;
  assert.equal(canonicalQueryIdentityXml(one), canonicalQueryIdentityXml(two));
  assert.notEqual(canonicalQueryIdentityXml(one), canonicalQueryIdentityXml(two.replace('iri="urn:a"', 'iri="urn:b"')));
});

test("Features policies use first-class FCT Status filters, never a regex value", () => {
  const base = { name: "query" as const, attributes: { xmlns: ns }, children: [] };
  const policies = featureFctQuery(base, "policies", "urn:policy-graph", "https://example.org/sparql", 30);
  assert.deepEqual(policies.children.filter(node => node.name === "status").map(node => node.text), [
    "gttp://ggg.maestro.ecosys/ns/ui#Pending", "gttp://ggg.maestro.ecosys/ns/ui#Approved",
  ]);
  assert.ok(policies.children.some(node => node.name === "property" && node.attributes.iri.endsWith("#lastRequestComponent")));
  assert.ok(!policies.children.some(node => node.name === "value"));
  assert.ok(!policies.children.some(node => node.name === "property" && node.attributes.iri.endsWith("#status")));
});
