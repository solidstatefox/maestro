import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloneFctListStatusView } from "../src/lib/fct-status-projection";
import { navigateFacetHeaderQuery } from "../src/lib/fct-facet-header-navigation";
import type { FctQueryTree } from "../src/lib/fct-query-api";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const STATUS = "gttp://ggg.maestro.ecosys/ns/ui#status";
const MUI = "gttp://ggg.maestro.ecosys/ns/ui#";

test("Status derives from the bookmarked XML without DOM serialization or altered selection", () => {
  const original = `<?xml version="1.0" encoding="UTF-8"?><query xmlns="http://openlinksw.com/services/facets/1.0" addr="urn:policies@http://demo.openlinksw.com/sparql" src="urn:maestro:features:policies" id="a" ctr="15"><class iri="${MUI}ClassPolicy" id="b"/><status type="uri" id="c">${MUI}Approved</status><property iri="${MUI}lastRequestComponent" id="d"><view type="list" limit="30" offset="0" id="e"/></property></query>`;
  const projected = cloneFctListStatusView(original);
  assert.ok(projected.includes(`addr="urn:policies@http://demo.openlinksw.com/sparql"`));
  assert.ok(projected.includes(`src="urn:maestro:features:policies"`));
  assert.ok(projected.includes(`<class iri="${MUI}ClassPolicy" id="b"/>`));
  assert.ok(projected.includes(`<property iri="${MUI}lastRequestComponent" id="d"><view type="list-status"/></property>`));
  assert.equal((projected.match(/<view\b/g) ?? []).length, 1);
  assert.ok(!projected.includes("<status"));
  assert.ok(!projected.includes('limit="30"'));
  assert.equal(cloneFctListStatusView('<query><view type="list"/><status/></query>'), '<query><view type="list-status"/></query>');
  assert.throws(() => cloneFctListStatusView('<query><view/><view/></query>'), /exactly one/);
});

function query(): FctQueryTree {
  return { name: "query", attributes: { xmlns: "http://openlinksw.com/services/facets/1.0", addr: "urn:g@https://example.org/sparql", id: "a", ctr: "13" }, children: [
    { id: "b", name: "class", attributes: { iri: "urn:Class" }, children: [] },
    { id: "c", name: "view", attributes: { type: "list", limit: "30" }, children: [] },
  ] };
}

test("Categories and Status headers descend from the current focus, retaining view ID", () => {
  const original = query();
  const classes = navigateFacetHeaderQuery(original, RDF_TYPE);
  assert.deepEqual(original, query()); // No source mutation.
  const path = classes.children.find(node => node.name === "property");
  assert.equal(path?.attributes.iri, RDF_TYPE);
  assert.equal(path.children[0].id, "c");
  const statuses = navigateFacetHeaderQuery(classes, STATUS);
  const inner = statuses.children.find(node => node.name === "property")?.children.find(node => node.name === "property");
  assert.equal(inner?.attributes.iri, STATUS);
  assert.equal(inner?.children[0].id, "c");
  const repeat = navigateFacetHeaderQuery(statuses, RDF_TYPE);
  const nested = repeat.children.find(node => node.name === "property")?.children.find(node => node.name === "property")?.children.find(node => node.name === "property");
  assert.equal(nested?.attributes.iri, RDF_TYPE, "Do not jump to an ancestor carrying the same predicate");
  assert.equal(nested.children[0].id, "c");
});

test("Existing predicate filter is promoted without removing its value constraints", () => {
  const source = query();
  source.children.push({ id: "d", name: "property", attributes: { iri: RDF_TYPE }, children: [{ id: "e", name: "value", attributes: { datatype: "uri" }, text: "urn:A", children: [] }] });
  const updated = navigateFacetHeaderQuery(source, RDF_TYPE);
  const matches = updated.children.filter(node => node.name === "property" && node.attributes.iri === RDF_TYPE);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].children.some(node => node.name === "value" && node.text === "urn:A"));
  assert.ok(matches[0].children.some(node => node.name === "view" && node.id === "c"));
});

test("Status service uses the server-derived bookmarked selection", () => {
  const route = readFileSync("src/app/proxy/api/fct/route.ts", "utf8");
  assert.match(route, /cloneFctListStatusView\(bookmarkQueryXml\)/);
  assert.match(route, /compileFctXmlToSparql\(statusViewXml, undefined, false, false, false, false,/);
  assert.doesNotMatch(route, /Status projection does not match the bookmarked live query/);
  const client = readFileSync("src/lib/fct-client.ts", "utf8");
  assert.ok(!client.includes("new XMLSerializer().serializeToString(doc)"));
});
