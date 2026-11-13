import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureFctQueryIds } from "../src/lib/fct-node-identity";
import { fctQueryTreeApi, serializeFctQuery } from "../src/lib/fct-query";

const visit = (nodes: { id: string; children: any[] }[]): string[] =>
  nodes.flatMap((node) => [node.id, ...visit(node.children)]);
const compact = (id: string) => /^[0-9a-z]+$/.test(id) && parseInt(id, 36) >= 10;

test("legacy FCT XML IDs become compact base36 IDs, preserving the counter high-water mark", () => {
  const old = ensureFctQueryIds({
    name: "query",
    attributes: { xmlns: "http://openlinksw.com/services/facets/1.0", id: "a", ctr: "12" },
    children: [
      { id: "role-filter-0-geo", name: "property-of", attributes: { iri: "urn:latitude" }, children: [
        { id: "property-filter-0-1", name: "property", attributes: { iri: "urn:sport" }, children: [
          { id: "property-value-x", name: "value", attributes: { datatype: "uri" }, text: "urn:surfing", children: [] },
        ] },
        { id: "query-view", name: "view", attributes: { type: "list", limit: "30" }, children: [] },
      ] },
    ],
  });
  const ids = [old.attributes.id, ...visit(old.children)];
  assert.ok(ids.every(compact), JSON.stringify(ids));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(old.attributes.id, "a");
  assert.equal(old.attributes.ctr, "16");
  assert.equal(old.children[0].uiKey, "role-filter-0-geo");
  const roundTrip = ensureFctQueryIds(old);
  assert.deepEqual([roundTrip.attributes.id, ...visit(roundTrip.children)], ids);
  assert.equal(roundTrip.attributes.ctr, "16");
});

test("live query edits keep compact IDs and preserve existing value identity", () => {
  let tree = fctQueryTreeApi.getTree();
  assert.ok(compact(tree.attributes.id));
  const view = tree.children.find((node) => node.name === "view");
  assert.ok(view);
  const originalId = view.id;
  tree = fctQueryTreeApi.setSearchText(tree, "hello");
  assert.equal(tree.children.find((node) => node.name === "view")?.id, originalId);
  tree = fctQueryTreeApi.addProperty(tree, "urn:sport");
  const property = tree.children.find((node) => node.name === "property" && node.attributes.iri === "urn:sport");
  assert.ok(property);
  assert.ok(compact(property.id));
  tree = fctQueryTreeApi.setPropertyValues(tree, null, "urn:sport", [{ text: "urn:surfing", datatype: "uri" }]);
  const valueId = tree.children.find((node) => node.id === property.id)?.children.find((node) => node.name === "value")?.id;
  assert.ok(valueId && compact(valueId));
  tree = fctQueryTreeApi.setPropertyValues(tree, null, "urn:sport", [{ text: "urn:surfing", datatype: "uri" }]);
  assert.equal(tree.children.find((node) => node.id === property.id)?.children.find((node) => node.name === "value")?.id, valueId);
  const xml = serializeFctQuery(tree);
  assert.doesNotMatch(xml, /id="(?:query-view|property-filter|role-filter|property-value)/);
  const allIds = [...xml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(allIds.every(compact), JSON.stringify(allIds));
});
