import assert from "node:assert/strict";
import { test } from "node:test";
import { dynamicUiComponentUrn, UI_COMPONENT } from "../src/lib/maestro-ui-component-ids";
import { sparqlBindingsToXml } from "../src/lib/maestro-provider-query-executor";

test("static furniture uses stable URNs, dynamic facets use the serialized FCT ID", () => {
  assert.equal(UI_COMPONENT.appbar, "urn:maestro:component:appbar");
  assert.equal(dynamicUiComponentUrn("property", "a"), "urn:maestro:component:facet:property:a");
  assert.equal(dynamicUiComponentUrn("role", "query-view"), "urn:maestro:component:facet:role:query-view");
  assert.equal(dynamicUiComponentUrn("property", "property-path-http%3A%2F%2Fexample.org-0"),
    "urn:maestro:component:facet:property:property-path-http%3A%2F%2Fexample.org-0");
  assert.throws(() => dynamicUiComponentUrn("property", "bad id"));
});

test("SPARQL query results become standard XML for provider XSLT, preserving RDF terms", () => {
  const xml = sparqlBindingsToXml({
    head: { vars: ["subject", "label", "missing"] },
    results: { bindings: [{
      subject: { type: "uri", value: "http://example.org/a" },
      label: { type: "literal", value: "A & B", "xml:lang": "en" },
    }] },
  });
  assert.match(xml, /xmlns="http:\/\/www\.w3\.org\/2005\/sparql-results#"/);
  assert.match(xml, /<uri>http:\/\/example\.org\/a<\/uri>/);
  assert.match(xml, /<literal xml:lang="en">A &amp; B<\/literal>/);
  assert.doesNotMatch(xml, /<binding name="missing">/);
});

test("SPARQL ASK result is preserved in the same XML protocol", () => {
  assert.match(sparqlBindingsToXml({ boolean: false }), /<boolean>false<\/boolean>/);
});
